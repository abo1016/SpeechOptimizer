import { invariant } from "./errors.js";
import { isSubscriptionProduct, productRule } from "./billing-policy.js";

const KNOWN_EVENTS = new Set([
  "order.paid", "payment.pending", "payment.failed",
  "refund.pending", "refund.failed", "order.refunded",
  "subscription.pending", "subscription.payment", "subscription.activated",
  "subscription.renewed", "subscription.canceled",
]);

/**
 * Webhook 是支付事实源。处理器只接收领域归一事件，不读取 Provider 的原始 payload。
 * 单进程内用队列保持同一账户事件的顺序；持久化适配器仍需提供跨进程唯一约束。
 */
export class BillingWebhookProcessor {
  #queue = Promise.resolve();

  constructor({ store, entitlements, clock = () => Date.now(), logger = console }) {
    this.store = store;
    this.entitlements = entitlements;
    this.clock = clock;
    this.logger = logger;
  }

  process(event) {
    this.#validateEvent(event);
    const operation = this.#queue.then(() => this.#process(event), () => this.#process(event));
    this.#queue = operation.catch(() => {});
    return operation;
  }

  #process(event) {
    if (this.store.webhookEvents.has(event.id)) return { duplicate: true };
    const targetBefore = this.#targetFor(event);
    if (targetBefore && event.occurredAt < (targetBefore.lastEventAt ?? 0)) {
      this.#recordEvent(event, "ignored_stale");
      this.logger.warn?.(`[billing] webhook_stale eventId=${event.id} type=${event.type}`);
      return { ignored: true, reason: "stale" };
    }
    this.#applyEvent(event);
    const targetAfter = this.#targetFor(event);
    if (targetAfter) targetAfter.lastEventAt = event.occurredAt;
    this.#recordEvent(event, "processed");
    this.logger.info?.(`[billing] webhook_processed eventId=${event.id} type=${event.type}`);
    return { processed: true };
  }

  #applyEvent(event) {
    if (event.type === "order.paid") return this.#paid(event);
    if (event.type === "payment.pending") return this.#paymentPending(event);
    if (event.type === "payment.failed") return this.#failed(event);
    if (event.type === "refund.pending") return this.#refundState(event, "pending");
    if (event.type === "refund.failed") return this.#refundState(event, "failed");
    if (event.type === "order.refunded") return this.#refunded(event);
    if (event.type === "subscription.pending") return this.#subscriptionPending(event);
    if (event.type === "subscription.payment") return this.#subscriptionPayment(event);
    if (event.type === "subscription.activated" || event.type === "subscription.renewed") {
      return this.#subscriptionGranted(event);
    }
    return this.#subscriptionCanceled(event);
  }

  #paid(event) {
    const order = this.#requireOrder(event.data);
    this.#verifyPaymentFacts(order, event.data);
    if (["refunded", "partially_refunded"].includes(order.status)) return;
    if (order.status === "paid") return;
    order.status = "paid";
    order.paidAt = event.occurredAt;
    // 订阅的初始付款只更新订单事实，权益必须由 subscription.activated/renewed 发放。
    if (isSubscriptionProduct(order.productCode)) return;
    this.#grantProduct(order.userId, order.productCode, `order:${order.id}`);
  }

  #paymentPending(event) {
    if (hasSubscriptionReference(event.data)) {
      const subscription = this.#requireSubscription(event.data);
      if (subscription.status !== "active") subscription.status = "pending";
      return;
    }
    const order = this.#orderFromData(event.data);
    if (order) {
      if (!["paid", "refunded", "partially_refunded"].includes(order.status)) order.status = "payment_pending";
      return;
    }
    this.#requireOrder(event.data);
  }

  #failed(event) {
    if (hasSubscriptionReference(event.data)) {
      const subscription = this.#requireSubscription(event.data);
      subscription.status = "past_due";
      subscription.failureCode = event.data.failureCode ?? "PAYMENT_FAILED";
      return;
    }
    const order = this.#orderFromData(event.data);
    if (order) {
      if (!["paid", "refunded", "partially_refunded"].includes(order.status)) order.status = "payment_failed";
      order.failureCode = event.data.failureCode ?? "PAYMENT_FAILED";
      return;
    }
    this.#requireOrder(event.data);
  }

  #refundState(event, status) {
    const refund = this.#requireRefund(event.data);
    if (["refunded", "partially_refunded"].includes(refund.status)) return;
    refund.status = status;
  }

  #refunded(event) {
    const order = this.#requireOrder(event.data);
    if (!["refunded", "partially_refunded"].includes(order.status)) {
      order.status = event.data.partial === true ? "partially_refunded" : "refunded";
      order.refundedAt = event.occurredAt;
      order.revokedAmount = this.entitlements.revokeSource({ sourceId: `order:${order.id}` });
    }
    const refund = this.#refundFromData(event.data);
    if (refund) {
      refund.status = order.status;
      refund.lastEventAt = event.occurredAt;
    }
  }

  #subscriptionPending(event) {
    const subscription = this.#requireSubscription(event.data);
    if (subscription.status !== "active") subscription.status = "pending";
  }

  #subscriptionPayment(event) {
    const subscription = this.#requireSubscription(event.data);
    // 续费付款只更新付款事实；新周期权益必须由 activated/renewed 事件发放。
    subscription.lastPaymentAt = event.occurredAt;
    subscription.lastPaymentStatus = event.data.orderStatus ?? "PAY_SUCCESS";
  }

  #subscriptionGranted(event) {
    const subscription = this.#requireSubscription(event.data);
    const product = productRule(subscription.productCode);
    invariant(product?.purchaseType === "subscription", "INVALID_SUBSCRIPTION_PRODUCT", "订阅商品配置无效");
    const order = this.store.orders.get(subscription.orderId);
    invariant(order, "ORDER_NOT_FOUND", "订阅订单不存在");
    // 激活/续期是资金事实：先校验本地订单金额和币种，再改变订阅状态或发放权益。
    this.#verifyPaymentFacts(order, event.data);
    invariant(!["refunded", "partially_refunded"].includes(order.status),
      "SUBSCRIPTION_ORDER_REFUNDED", "订阅订单已退款，不能发放权益");
    subscription.status = "active";
    subscription.externalSubscriptionId = event.data.externalSubscriptionId ?? subscription.externalSubscriptionId;
    subscription.currentPeriodEnd = event.data.currentPeriodEnd ?? subscription.currentPeriodEnd;
    order.status = "paid";
    order.paidAt = event.occurredAt;
    const start = event.data.periodStart ?? event.occurredAt;
    const periodKey = event.data.periodId ?? event.data.currentPeriodEnd ?? String(start);
    if (product.benefitMonths === 12) {
      this.#grantYearlyMonthlyBatches(subscription, product, start, periodKey);
    } else {
      this.#grantMonthlyBatch(subscription, product, start, event.data.currentPeriodEnd, periodKey);
    }
  }

  #grantMonthlyBatch(subscription, product, start, end, periodKey) {
    this.entitlements.grant({
      userId: subscription.userId,
      unit: product.unit,
      amount: product.amount,
      source: "billing",
      sourceId: `subscription:${subscription.id}:period:${periodKey}`,
      startsAt: start,
      expiresAt: end ?? addUtcMonths(start, 1),
    });
  }

  #grantYearlyMonthlyBatches(subscription, product, start, periodKey) {
    for (let month = 0; month < 12; month += 1) {
      this.entitlements.grant({
        userId: subscription.userId,
        unit: product.unit,
        amount: product.amount,
        source: "billing",
        sourceId: `subscription:${subscription.id}:cycle:${periodKey}:month:${month + 1}`,
        startsAt: addUtcMonths(start, month),
        expiresAt: addUtcMonths(start, month + 1),
      });
    }
  }

  #subscriptionCanceled(event) {
    const subscription = this.#requireSubscription(event.data);
    subscription.status = "canceled";
    subscription.canceledAt = event.occurredAt;
    subscription.cancelAtPeriodEnd = false;
  }

  #verifyPaymentFacts(order, data) {
    if (Number.isInteger(data.amount)) {
      invariant(data.amount === order.amount, "PAYMENT_AMOUNT_MISMATCH", "支付金额与本地订单不一致");
    }
    if (data.currency) {
      invariant(data.currency === order.currency, "PAYMENT_CURRENCY_MISMATCH", "支付币种与本地订单不一致");
    }
  }

  #grantProduct(userId, productCode, sourceId) {
    const product = productRule(productCode);
    invariant(product, "UNKNOWN_PRODUCT", "未知商品");
    return this.entitlements.grant({ userId, unit: product.unit, amount: product.amount, source: "billing", sourceId });
  }

  #targetFor(event) {
    const data = event.data;
    if (event.type.startsWith("subscription.") || (event.type === "payment.failed" && hasSubscriptionReference(data))) {
      return this.#subscriptionFromData(data);
    }
    if (event.type.startsWith("refund.")) return this.#refundFromData(data);
    if (event.type === "order.refunded") return this.#orderFromData(data) ?? this.#refundFromData(data);
    return this.#orderFromData(data) ?? this.#subscriptionFromData(data);
  }

  #orderFromData(data) {
    if (data.orderId) return this.store.orders.get(data.orderId);
    return [...this.store.orders.values()].find((order) =>
      (data.paymentRequestId && order.paymentRequestId === data.paymentRequestId)
      || (data.acquiringOrderId && order.acquiringOrderId === data.acquiringOrderId));
  }

  #subscriptionFromData(data) {
    if (data.subscriptionId && this.store.subscriptions.has(data.subscriptionId)) return this.store.subscriptions.get(data.subscriptionId);
    return [...this.store.subscriptions.values()].find((subscription) =>
      (data.subscriptionRequest && subscription.subscriptionRequest === data.subscriptionRequest)
      || (data.externalSubscriptionId && subscription.externalSubscriptionId === data.externalSubscriptionId));
  }

  #refundFromData(data) {
    if (data.refundId && this.store.refunds.has(data.refundId)) return this.store.refunds.get(data.refundId);
    return [...this.store.refunds.values()].find((refund) =>
      (data.orderId && refund.orderId === data.orderId)
      || (data.refundRequestId && refund.refundRequestId === data.refundRequestId)
      || (data.acquiringRefundOrderId && refund.acquiringRefundOrderId === data.acquiringRefundOrderId));
  }

  #requireOrder(data) {
    const order = this.#orderFromData(data);
    invariant(order, "ORDER_NOT_FOUND", "订单不存在");
    return order;
  }

  #requireSubscription(data) {
    const subscription = this.#subscriptionFromData(data);
    invariant(subscription, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
    return subscription;
  }

  #requireRefund(data) {
    const refund = this.#refundFromData(data);
    invariant(refund, "REFUND_NOT_FOUND", "退款请求不存在");
    return refund;
  }

  #recordEvent(event, status) {
    const order = this.#orderFromData(event.data);
    const subscription = this.#subscriptionFromData(event.data);
    const refund = this.#refundFromData(event.data);
    this.store.webhookEvents.set(event.id, {
      id: event.id,
      version: event.version,
      type: event.type,
      status,
      occurredAt: event.occurredAt,
      orderId: order?.id ?? null,
      subscriptionId: subscription?.id ?? null,
      refundId: refund?.id ?? null,
      userId: order?.userId ?? subscription?.userId ?? refund?.userId ?? null,
      processedAt: this.clock(),
    });
  }

  #validateEvent(event) {
    invariant(event && typeof event === "object", "INVALID_WEBHOOK", "Webhook 结构无效");
    invariant(event.id && event.type && event.data && typeof event.data === "object", "INVALID_WEBHOOK", "Webhook 结构无效");
    invariant(event.version === 1, "UNSUPPORTED_WEBHOOK_VERSION", "Webhook 版本不受支持");
    invariant(KNOWN_EVENTS.has(event.type), "UNSUPPORTED_WEBHOOK_EVENT", "Webhook 事件不受支持");
    invariant(Number.isFinite(event.occurredAt), "INVALID_WEBHOOK_TIME", "Webhook 时间无效");
  }
}

/** 按 UTC 自然月切换权益窗口，并处理月底日期不存在的情况。 */
function addUtcMonths(timestamp, months) {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

function hasSubscriptionReference(data) {
  return Boolean(data.subscriptionId || data.subscriptionRequest || data.externalSubscriptionId);
}
