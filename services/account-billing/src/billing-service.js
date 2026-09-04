import { randomUUID } from "node:crypto";
import { invariant } from "./errors.js";
import { PRODUCT_RULES, isSubscriptionProduct, productRule } from "./billing-policy.js";
import { BillingWebhookProcessor } from "./billing-webhook-processor.js";
import { BillingReconciler } from "./billing-reconciler.js";

const UNKNOWN_STATUS_CODE = "WAFFO_STATUS_UNCONFIRMED";

/**
 * 计费命令只依赖可注入 gateway。所有资金写请求先写入本地快照并持久化，
 * 再调用 Provider；这样超时后可以用原 request ID inquiry，不会猜测重试。
 */
export class BillingService {
  constructor({ store, entitlements, gateway, persist = async () => {}, clock = () => Date.now(),
    id = createRequestId, requestId = createRequestId, logger = console }) {
    this.store = store;
    this.entitlements = entitlements;
    this.gateway = gateway;
    this.persist = persist;
    this.clock = clock;
    this.id = id;
    this.requestId = requestId;
    this.logger = logger;
    this.webhookProcessor = new BillingWebhookProcessor({ store, entitlements, clock, logger });
    // 恢复对账与资金写命令拆开，避免 BillingService 同时承担启动恢复状态机。
    this.reconciler = new BillingReconciler({ store, gateway, persist, clock, logger });
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
    // 取消到期生效：先落本地意图，当前周期权益仍由生效窗口控制。
    subscription.cancelAtPeriodEnd = true;
    await this.persist();
    let result;
    try {
      result = await this.gateway.cancelSubscription({
        externalSubscriptionId: subscription.externalSubscriptionId,
        subscriptionRequest: subscription.subscriptionRequest,
      });
    } catch (error) {
      subscription.cancelFailureCode = error.code ?? "GATEWAY_ERROR";
      subscription.cancelRequestStatus = error.code === UNKNOWN_STATUS_CODE
        ? "pending_confirmation" : "failed";
      // 明确失败或状态未知时都不能把本地意图伪装成 Provider 已接受的到期取消。
      subscription.cancelAtPeriodEnd = false;
      await this.persist();
      this.logger.error?.(`[billing] subscription_cancel_failed subscriptionId=${subscriptionId} code=${subscription.cancelFailureCode}`);
      throw error;
    }
    subscription.cancelRequestStatus = result?.status ?? "requested";
    delete subscription.cancelFailureCode;
    await this.persist();
    this.logger.info?.(`[billing] subscription_cancel_requested subscriptionId=${subscriptionId}`);
    return subscription;
  }

  async requestRefund({ userId, orderId, reason }) {
    const order = this.store.orders.get(orderId);
    invariant(order?.userId === userId, "ORDER_NOT_FOUND", "订单不存在");
    invariant(order.status === "paid", "ORDER_NOT_REFUNDABLE", "仅已支付订单可申请退款");
    invariant(!isSubscriptionProduct(order.productCode), "REFUND_MANUAL_REVIEW_REQUIRED", "订阅退款需要人工审核");
    invariant(![...this.store.refunds.values()].some((refund) => refund.orderId === order.id
      && refund.status !== "failed"),
      "REFUND_ALREADY_REQUESTED", "该订单已有退款请求");
    this.#assertUnusedBenefit(order);
    const refund = this.#newRefund(order, reason);
    this.store.refunds.set(refund.id, refund);
    order.refundRequestId = refund.refundRequestId;
    order.status = "refund_pending";
    await this.persist();
    let external;
    try {
      external = await this.gateway.refundOrder({
        refundRequestId: refund.refundRequestId,
        acquiringOrderId: order.acquiringOrderId,
        amount: order.amount,
        currency: order.currency,
        reason: refund.reason,
      });
    } catch (error) {
      const uncertain = error.code === UNKNOWN_STATUS_CODE;
      refund.status = uncertain ? "pending_confirmation" : "failed";
      refund.failureCode = error.code ?? "GATEWAY_ERROR";
      if (!uncertain) order.status = "paid";
      await this.persist();
      this.logger.error?.(`[billing] refund_failed orderId=${order.id} refundId=${refund.id} code=${refund.failureCode}`);
      throw error;
    }
    refund.status = "requested";
    refund.acquiringRefundOrderId = external?.acquiringRefundOrderId ?? null;
    delete refund.failureCode;
    await this.persist();
    this.logger.info?.(`[billing] refund_requested orderId=${order.id} refundId=${refund.id}`);
    return order;
  }

  async processWebhook(event) {
    return this.webhookProcessor.process(event);
  }

  /**
   * 启动时只对账已有 request ID，绝不重复执行资金写操作。
   * Webhook 仍是付款/退款和权益的事实源，对账只保存 Provider 的状态提示。
   */
  async reconcilePendingBilling() {
    return this.reconciler.reconcile();
  }

  async #createOneTimeOrder(order, input) {
    order.paymentRequestId = this.requestId();
    await this.persist();
    let external;
    try {
      external = await this.gateway.createOrder({
        requestId: order.paymentRequestId,
        merchantOrderId: order.id,
        amount: order.amount,
        currency: order.currency,
        productCode: order.productCode,
        userId: order.userId,
        userEmail: input.userEmail,
        userCreatedAt: input.userCreatedAt,
      });
    } catch (error) {
      this.#markCreateFailure(order, error);
      await this.persist();
      throw error;
    }
    if (!external?.acquiringOrderId || !external.checkoutUrl) {
      const error = new Error("订单网关返回值无效");
      error.code = "INVALID_GATEWAY_RESPONSE";
      this.#markCreateFailure(order, error);
      await this.persist();
      throw error;
    }
    Object.assign(order, {
      status: "created",
      acquiringOrderId: external.acquiringOrderId,
      externalOrderId: external.acquiringOrderId,
      checkoutUrl: external.checkoutUrl,
    });
    await this.persist();
    this.logger.info?.(`[billing] order_created orderId=${order.id} paymentRequestId=${order.paymentRequestId}`);
    return order;
  }

  async #createSubscription(order, input, product) {
    const subscription = {
      id: this.id(),
      orderId: order.id,
      userId: order.userId,
      productCode: order.productCode,
      subscriptionRequest: this.requestId(),
      status: "creating",
      cancelAtPeriodEnd: false,
      createdAt: this.clock(),
      lastEventAt: 0,
    };
    this.store.subscriptions.set(subscription.id, subscription);
    Object.assign(order, { subscriptionId: subscription.id, subscriptionRequest: subscription.subscriptionRequest });
    order.status = "pending";
    await this.persist();
    let external;
    try {
      external = await this.gateway.createSubscription({
        requestId: subscription.subscriptionRequest,
        merchantSubscriptionId: subscription.id,
        amount: order.amount,
        currency: order.currency,
        productCode: order.productCode,
        periodType: product.periodType,
        periodInterval: product.periodInterval,
        userId: order.userId,
        userEmail: input.userEmail,
        userCreatedAt: input.userCreatedAt,
      });
    } catch (error) {
      subscription.status = "failed";
      this.#markCreateFailure(order, error);
      await this.persist();
      throw error;
    }
    if (!external?.externalSubscriptionId || !external.checkoutUrl) {
      const error = new Error("订阅网关返回值无效");
      error.code = "INVALID_GATEWAY_RESPONSE";
      subscription.status = "failed";
      this.#markCreateFailure(order, error);
      await this.persist();
      throw error;
    }
    Object.assign(subscription, { status: "pending", externalSubscriptionId: external.externalSubscriptionId });
    Object.assign(order, {
      status: "created",
      externalOrderId: external.externalSubscriptionId,
      externalSubscriptionId: external.externalSubscriptionId,
      checkoutUrl: external.checkoutUrl,
    });
    await this.persist();
    this.logger.info?.(`[billing] subscription_created subscriptionId=${subscription.id}`);
    return order;
  }

  #newOrder(input) {
    return {
      id: this.id(),
      userId: input.userId,
      productCode: input.productCode,
      amount: input.amount,
      currency: input.currency ?? "USD",
      status: "pending",
      createdAt: this.clock(),
      lastEventAt: 0,
    };
  }

  #newRefund(order, reason) {
    return {
      id: this.id(),
      userId: order.userId,
      orderId: order.id,
      refundRequestId: this.requestId(),
      acquiringOrderId: order.acquiringOrderId,
      acquiringRefundOrderId: null,
      amount: order.amount,
      currency: order.currency,
      reason: reason || "requested_by_customer",
      status: "pending",
      createdAt: this.clock(),
      lastEventAt: 0,
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

}

function createRequestId() {
  return randomUUID().replaceAll("-", "");
}

export { PRODUCT_RULES };
