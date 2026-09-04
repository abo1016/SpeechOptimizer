import { randomUUID } from "node:crypto";
import { invariant } from "./errors.js";
import { PRODUCT_RULES, isSubscriptionProduct, productRule } from "./billing-policy.js";

const KNOWN_EVENTS = new Set([
  "order.paid", "payment.pending", "payment.failed",
  "refund.pending", "refund.failed", "order.refunded",
  "subscription.pending", "subscription.payment", "subscription.activated",
  "subscription.renewed", "subscription.canceled",
]);

/**
 * 计费领域只依赖可注入 gateway；所有 Waffo request ID 先写本地快照再发网络请求，
 * 这样网络超时或进程退出后仍能使用同一 ID inquiry，不会制造重复支付操作。
 */
export class BillingService {
  #webhookQueue = Promise.resolve();

  constructor({ store, entitlements, gateway, persist = async () => {}, clock = () => Date.now(),
    id, requestId = createRequestId, logger = console }) {
    this.store = store;
    this.entitlements = entitlements;
    this.gateway = gateway;
    this.persist = persist;
    this.clock = clock;
    this.id = id;
    this.requestId = requestId;
    this.logger = logger;
  }

  async createOrder(input) {
    const product = productRule(input.productCode);
    invariant(product, "UNKNOWN_PRODUCT", "未知商品");
    invariant(product.purchaseType !== "free", "FREE_PRODUCT_NOT_PURCHASABLE", "免费权益不能创建支付订单");
    invariant(Number.isInteger(input.amount) && input.amount > 0, "INVALID_AMOUNT", "订单金额必须使用正整数最小货币单位");
    const order = this.#newOrder(input);
    this.store.orders.set(order.id, order);
    if (isSubscriptionProduct(order.productCode)) return this.#createSubscription(order, input, product);
    return this.#createOneTimeOrder(order, input);
  }

  async cancelSubscription({ userId, subscriptionId }) {
    const subscription = this.store.subscriptions.get(subscriptionId);
    invariant(subscription?.userId === userId, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
    invariant(["active", "past_due"].includes(subscription.status), "SUBSCRIPTION_NOT_ACTIVE", "订阅当前不可取消");
    subscription.cancelRequestedAt = this.clock();
    await this.persist();
    await this.gateway.cancelSubscription({
      externalSubscriptionId: subscription.externalSubscriptionId,
      subscriptionRequest: subscription.subscriptionRequest,
      requestId: `cancel:${subscription.id}`,
    });
    subscription.cancelAtPeriodEnd = true;
    this.logger.info?.(`[billing] subscription_cancel_requested subscriptionId=${subscriptionId}`);
    return subscription;
  }

  async requestRefund({ userId, orderId, reason }) {
    const order = this.store.orders.get(orderId);
    invariant(order?.userId === userId, "ORDER_NOT_FOUND", "订单不存在");
    invariant(order.status === "paid", "ORDER_NOT_REFUNDABLE", "仅已支付订单可申请退款");
    invariant(!isSubscriptionProduct(order.productCode), "REFUND_MANUAL_REVIEW_REQUIRED", "订阅退款需要人工审核");
    this.#assertUnusedBenefit(order);
    const refund = this.#newRefund(order, reason);
    this.store.refunds.set(refund.id, refund);
    order.refundRequestId = refund.refundRequestId;
    await this.persist();
    const external = await this.gateway.refundOrder({
      refundRequestId: refund.refundRequestId,
      acquiringOrderId: order.acquiringOrderId,
      amount: order.amount,
      currency: order.currency,
      reason: refund.reason,
    });
    Object.assign(refund, { status: "requested", acquiringRefundOrderId: external.acquiringRefundOrderId ?? null });
    order.status = "refund_pending";
    this.logger.info?.(`[billing] refund_requested orderId=${order.id} refundId=${refund.id}`);
    return order;
  }

  async processWebhook(event) {
    this.#validateEvent(event);
    return this.#enqueueWebhook(() => this.#processWebhook(event));
  }

  async #createOneTimeOrder(order, input) {
    order.paymentRequestId = this.requestId();
    await this.persist();
    try {
      const external = await this.gateway.createOrder({
        requestId: order.paymentRequestId, merchantOrderId: order.id,
        amount: order.amount, currency: order.currency, productCode: order.productCode,
        userId: order.userId, userEmail: input.userEmail, userCreatedAt: input.userCreatedAt,
      });
      Object.assign(order, { status: "created", acquiringOrderId: external.acquiringOrderId,
        externalOrderId: external.acquiringOrderId, checkoutUrl: external.checkoutUrl });
      this.logger.info?.(`[billing] order_created orderId=${order.id} paymentRequestId=${order.paymentRequestId}`);
      return order;
    } catch (error) {
      this.#markCreateFailure(order, error);
      throw error;
    }
  }

  async #createSubscription(order, input, product) {
    const subscription = {
      id: this.id(), orderId: order.id, userId: order.userId, productCode: order.productCode,
      subscriptionRequest: this.requestId(), status: "creating", cancelAtPeriodEnd: false,
      createdAt: this.clock(), lastEventAt: 0,
    };
    this.store.subscriptions.set(subscription.id, subscription);
    Object.assign(order, { subscriptionId: subscription.id, subscriptionRequest: subscription.subscriptionRequest });
    await this.persist();
    try {
      const external = await this.gateway.createSubscription({
        requestId: subscription.subscriptionRequest, merchantSubscriptionId: subscription.id,
        amount: order.amount, currency: order.currency, productCode: order.productCode,
        periodType: product.periodType, periodInterval: product.periodInterval,
        userId: order.userId, userEmail: input.userEmail, userCreatedAt: input.userCreatedAt,
      });
      Object.assign(subscription, { status: "pending", externalSubscriptionId: external.externalSubscriptionId });
      Object.assign(order, { status: "created", externalOrderId: external.externalSubscriptionId,
        checkoutUrl: external.checkoutUrl });
      this.logger.info?.(`[billing] subscription_created subscriptionId=${subscription.id}`);
      return order;
    } catch (error) {
      subscription.status = "failed";
      this.#markCreateFailure(order, error);
      throw error;
    }
  }

  #newOrder(input) {
    return {
      id: this.id(), userId: input.userId, productCode: input.productCode,
      amount: input.amount, currency: input.currency ?? "USD", status: "pending",
      createdAt: this.clock(), lastEventAt: 0,
    };
  }

  #newRefund(order, reason) {
    return {
      id: this.id(), userId: order.userId, orderId: order.id,
      refundRequestId: this.requestId(), acquiringOrderId: order.acquiringOrderId,
      amount: order.amount, currency: order.currency, reason: reason || "requested_by_customer",
      status: "pending", createdAt: this.clock(),
    };
  }

  #markCreateFailure(order, error) {
    order.status = error.code === "WAFFO_STATUS_UNCONFIRMED" ? "pending_confirmation" : "failed";
    order.failureCode = error.code ?? "GATEWAY_ERROR";
    this.logger.error?.(`[billing] order_create_failed orderId=${order.id} code=${order.failureCode}`);
  }

  #assertUnusedBenefit(order) {
    const summary = this.entitlements.sourceSummary(`order:${order.id}`);
    invariant(summary.granted > 0, "REFUND_MANUAL_REVIEW_REQUIRED", "未找到可自动撤销的订单权益，需要人工审核");
    invariant(summary.remaining === summary.granted, "REFUND_MANUAL_REVIEW_REQUIRED", "订单权益已部分或全部使用，需要人工审核");
  }

  async #processWebhook(event) {
    if (this.store.webhookEvents.has(event.id)) return { duplicate: true };
    const targetBefore = this.#eventTarget(event);
    if (targetBefore && event.occurredAt < targetBefore.lastEventAt) {
      this.#recordEvent(event, "ignored_stale");
      this.logger.warn?.(`[billing] webhook_stale eventId=${event.id} type=${event.type}`);
      return { ignored: true, reason: "stale" };
    }
    await this.#applyEvent(event);
    const targetAfter = this.#eventTarget(event);
    if (targetAfter) targetAfter.lastEventAt = event.occurredAt;
    this.#recordEvent(event, "processed");
    this.logger.info?.(`[billing] webhook_processed eventId=${event.id} type=${event.type}`);
    return { processed: true };
  }

  #enqueueWebhook(operation) {
    const queued = this.#webhookQueue.then(operation, operation);
    this.#webhookQueue = queued.catch(() => {});
    return queued;
  }

  #validateEvent(event) {
    invariant(event?.id && event?.type && event?.data, "INVALID_WEBHOOK", "Webhook 结构无效");
    invariant(event.version === 1, "UNSUPPORTED_WEBHOOK_VERSION", "Webhook 版本不受支持");
    invariant(KNOWN_EVENTS.has(event.type), "UNSUPPORTED_WEBHOOK_EVENT", "Webhook 事件不受支持");
    invariant(Number.isFinite(event.occurredAt), "INVALID_WEBHOOK_TIME", "Webhook 时间无效");
  }

  async #applyEvent(event) {
    if (event.type === "order.paid") return this.#paid(event);
    if (event.type === "payment.pending") return this.#paymentPending(event);
    if (event.type === "payment.failed") return this.#failed(event);
    if (event.type === "refund.pending") return this.#refundState(event, "pending");
    if (event.type === "refund.failed") return this.#refundState(event, "failed");
    if (event.type === "order.refunded") return this.#refunded(event);
    if (event.type === "subscription.pending") return this.#subscriptionPending(event);
    if (event.type === "subscription.payment") return this.#subscriptionPayment(event);
    if (event.type === "subscription.activated" || event.type === "subscription.renewed") return this.#subscriptionGranted(event);
    return this.#subscriptionCanceled(event);
  }

  #paid(event) {
    const order = this.#orderFromData(event.data);
    invariant(order, "ORDER_NOT_FOUND", "订单不存在");
    this.#verifyPaymentFacts(order, event.data);
    if (order.status === "refunded") return;
    order.status = "paid";
    order.paidAt = event.occurredAt;
    this.#grantProduct(order.userId, order.productCode, `order:${order.id}`);
  }

  #paymentPending(event) {
    const order = this.#orderFromData(event.data);
    if (order && !["paid", "refunded"].includes(order.status)) order.status = "payment_pending";
  }

  #failed(event) {
    const order = this.#orderFromData(event.data);
    if (order) {
      if (! ["paid", "refunded"].includes(order.status)) order.status = "payment_failed";
      order.failureCode = event.data.failureCode ?? "PAYMENT_FAILED";
      return;
    }
    const subscription = this.#subscriptionFromData(event.data);
    invariant(subscription, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
    subscription.status = "past_due";
    subscription.failureCode = event.data.failureCode ?? "PAYMENT_FAILED";
  }

  #refundState(event, status) {
    const refund = this.#refundFromData(event.data);
    if (refund) refund.status = status;
  }

  #refunded(event) {
    const order = this.#orderFromData(event.data);
    invariant(order, "ORDER_NOT_FOUND", "订单不存在");
    order.status = event.data.partial === true ? "partially_refunded" : "refunded";
    order.refundedAt = event.occurredAt;
    order.revokedAmount = this.entitlements.revokeSource({ sourceId: `order:${order.id}` });
    const refund = this.#refundFromData(event.data);
    if (refund) refund.status = order.status;
  }

  #subscriptionPending(event) {
    const subscription = this.#subscriptionFromData(event.data);
    if (subscription && subscription.status !== "active") subscription.status = "pending";
  }

  #subscriptionPayment(event) {
    const subscription = this.#subscriptionFromData(event.data);
    invariant(subscription, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
    subscription.lastPaymentAt = event.occurredAt;
    subscription.lastPaymentStatus = event.data.orderStatus ?? "PAY_SUCCESS";
  }

  #subscriptionGranted(event) {
    const subscription = this.#subscriptionFromData(event.data);
    invariant(subscription, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
    const product = productRule(subscription.productCode);
    subscription.status = "active";
    subscription.externalSubscriptionId = event.data.externalSubscriptionId ?? subscription.externalSubscriptionId;
    subscription.currentPeriodEnd = event.data.currentPeriodEnd ?? subscription.currentPeriodEnd;
    subscription.cancelAtPeriodEnd = false;
    const start = event.data.periodStart ?? event.occurredAt;
    const periodKey = event.data.periodId ?? String(start);
    if (product.benefitMonths === 12) this.#grantYearlyMonthlyBatches(subscription, product, start, periodKey);
    else this.#grantMonthlyBatch(subscription, product, start, event.data.currentPeriodEnd, periodKey);
  }

  #grantMonthlyBatch(subscription, product, start, end, periodKey) {
    this.entitlements.grant({
      userId: subscription.userId, unit: product.unit, amount: product.amount, source: "billing",
      sourceId: `subscription:${subscription.id}:period:${periodKey}`, startsAt: start,
      expiresAt: end ?? addUtcMonths(start, 1),
    });
  }

  #grantYearlyMonthlyBatches(subscription, product, start, periodKey) {
    for (let month = 0; month < 12; month += 1) {
      this.entitlements.grant({
        userId: subscription.userId, unit: product.unit, amount: product.amount, source: "billing",
        sourceId: `subscription:${subscription.id}:cycle:${periodKey}:month:${month + 1}`,
        startsAt: addUtcMonths(start, month), expiresAt: addUtcMonths(start, month + 1),
      });
    }
  }

  #subscriptionCanceled(event) {
    const subscription = this.#subscriptionFromData(event.data);
    invariant(subscription, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
    subscription.status = "canceled";
    subscription.canceledAt = event.occurredAt;
    subscription.cancelAtPeriodEnd = false;
  }

  #verifyPaymentFacts(order, data) {
    if (Number.isInteger(data.amount)) invariant(data.amount === order.amount, "PAYMENT_AMOUNT_MISMATCH", "支付金额与本地订单不一致");
    if (data.currency) invariant(data.currency === order.currency, "PAYMENT_CURRENCY_MISMATCH", "支付币种与本地订单不一致");
  }

  #grantProduct(userId, productCode, sourceId) {
    const product = productRule(productCode);
    invariant(product, "UNKNOWN_PRODUCT", "未知商品");
    return this.entitlements.grant({ userId, unit: product.unit, amount: product.amount, source: "billing", sourceId });
  }

  #eventTarget(event) {
    return this.#orderFromData(event.data) ?? this.#subscriptionFromData(event.data) ?? this.#refundFromData(event.data);
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
    return [...this.store.refunds.values()].find((refund) =>
      (data.refundRequestId && refund.refundRequestId === data.refundRequestId)
      || (data.acquiringRefundOrderId && refund.acquiringRefundOrderId === data.acquiringRefundOrderId));
  }

  #recordEvent(event, status) {
    const order = this.#orderFromData(event.data);
    const subscription = this.#subscriptionFromData(event.data);
    const refund = this.#refundFromData(event.data);
    this.store.webhookEvents.set(event.id, {
      id: event.id, type: event.type, status, occurredAt: event.occurredAt,
      orderId: order?.id ?? null, subscriptionId: subscription?.id ?? null,
      refundId: refund?.id ?? null, userId: order?.userId ?? subscription?.userId ?? refund?.userId ?? null,
      processedAt: this.clock(),
    });
  }
}

function createRequestId() {
  return randomUUID().replaceAll("-", "");
}

function addUtcMonths(timestamp, months) {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

export { PRODUCT_RULES };
