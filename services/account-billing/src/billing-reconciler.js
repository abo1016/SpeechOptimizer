const ORDER_RECONCILE_STATUSES = new Set(["pending", "pending_confirmation"]);
const SUBSCRIPTION_RECONCILE_STATUSES = new Set(["creating", "pending_confirmation"]);
const REFUND_RECONCILE_STATUSES = new Set(["pending", "pending_confirmation"]);

/**
 * 启动恢复只允许 inquiry 既有 request ID，禁止重放任何资金 write。
 * 对账结果仅保存 Provider 状态提示；真实付款、退款与权益仍以 Webhook 为事实源。
 */
export class BillingReconciler {
  constructor({ store, gateway, persist, clock, logger }) {
    this.store = store;
    this.gateway = gateway;
    this.persist = persist;
    this.clock = clock;
    this.logger = logger;
  }

  async reconcile() {
    const summary = { orders: 0, subscriptions: 0, refunds: 0 };
    for (const order of this.store.orders.values()) {
      if (!ORDER_RECONCILE_STATUSES.has(order.status) || !order.paymentRequestId) continue;
      await this.#reconcileOrder(order);
      summary.orders += 1;
    }
    for (const subscription of this.store.subscriptions.values()) {
      if (!SUBSCRIPTION_RECONCILE_STATUSES.has(subscription.status) || !subscription.subscriptionRequest) continue;
      await this.#reconcileSubscription(subscription);
      summary.subscriptions += 1;
    }
    for (const refund of this.store.refunds.values()) {
      if (!REFUND_RECONCILE_STATUSES.has(refund.status) || !refund.refundRequestId) continue;
      await this.#reconcileRefund(refund);
      summary.refunds += 1;
    }
    return summary;
  }

  async #reconcileOrder(order) {
    order.status = "pending_confirmation";
    try {
      const result = await this.gateway.inquiryOrder({ requestId: order.paymentRequestId });
      if (result?.acquiringOrderId) order.acquiringOrderId = result.acquiringOrderId;
      if (result?.status) order.providerStatus = result.status;
      order.reconciledAt = this.clock();
      delete order.reconciliationFailureCode;
      this.logger.info?.(`[billing] order_reconciled orderId=${order.id} requestId=${order.paymentRequestId}`);
    } catch (error) {
      order.reconciliationFailureCode = error.code ?? "GATEWAY_ERROR";
      this.logger.warn?.(`[billing] order_reconcile_pending orderId=${order.id} code=${order.reconciliationFailureCode}`);
    }
    await this.persist();
  }

  async #reconcileSubscription(subscription) {
    subscription.status = "pending_confirmation";
    try {
      const result = await this.gateway.inquirySubscription({ requestId: subscription.subscriptionRequest });
      if (result?.externalSubscriptionId) subscription.externalSubscriptionId = result.externalSubscriptionId;
      if (result?.status) subscription.providerStatus = result.status;
      subscription.reconciledAt = this.clock();
      delete subscription.reconciliationFailureCode;
      this.logger.info?.(`[billing] subscription_reconciled subscriptionId=${subscription.id} requestId=${subscription.subscriptionRequest}`);
    } catch (error) {
      subscription.reconciliationFailureCode = error.code ?? "GATEWAY_ERROR";
      this.logger.warn?.(`[billing] subscription_reconcile_pending subscriptionId=${subscription.id} code=${subscription.reconciliationFailureCode}`);
    }
    await this.persist();
  }

  async #reconcileRefund(refund) {
    refund.status = "pending_confirmation";
    try {
      const result = await this.gateway.inquiryRefund({ refundRequestId: refund.refundRequestId });
      if (result?.acquiringRefundOrderId) refund.acquiringRefundOrderId = result.acquiringRefundOrderId;
      if (result?.status) refund.providerStatus = result.status;
      refund.reconciledAt = this.clock();
      delete refund.reconciliationFailureCode;
      this.logger.info?.(`[billing] refund_reconciled refundId=${refund.id} requestId=${refund.refundRequestId}`);
    } catch (error) {
      refund.reconciliationFailureCode = error.code ?? "GATEWAY_ERROR";
      this.logger.warn?.(`[billing] refund_reconcile_pending refundId=${refund.id} code=${refund.reconciliationFailureCode}`);
    }
    await this.persist();
  }
}
