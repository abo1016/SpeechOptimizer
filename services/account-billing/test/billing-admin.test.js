import test from "node:test";
import assert from "node:assert/strict";
import { AdminService } from "../src/admin-service.js";
import { BillingService } from "../src/billing-service.js";
import { EntitlementService } from "../src/entitlement-service.js";
import { MockWaffoGateway } from "../fixtures/local-adapters.js";
import { harness } from "./helpers.js";

function billingFixture({ now = 1_000_000, clock, gateway, persist } = {}) {
  const base = harness(now);
  const currentClock = clock ?? base.clock;
  const entitlements = new EntitlementService({ ...base, clock: currentClock });
  const billing = new BillingService({ ...base, clock: currentClock, entitlements,
    gateway: gateway ?? new MockWaffoGateway(), persist });
  return { ...base, clock: currentClock, entitlements, gateway: billing.gateway, billing };
}

function event(id, type, data, occurredAt = 1_100_000) {
  return { id, type, version: 1, occurredAt, data };
}

async function createSubscription(billing, productCode = "pro_monthly") {
  const amount = productCode === "pro_yearly" ? 9_600 : 1_200;
  const order = await billing.createOrder({ userId: "u1", productCode, amount });
  return { order, subscription: billing.store.subscriptions.get(order.subscriptionId) };
}

function subscriptionData(subscription, extra = {}) {
  return { subscriptionId: subscription.id, externalSubscriptionId: subscription.externalSubscriptionId, ...extra };
}
test("创建分钟包订单使用冻结的 acquiringOrderId 和 checkoutUrl", async () => {
  const { billing, gateway } = billingFixture();
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  assert.equal(order.status, "created");
  assert.equal(order.acquiringOrderId, `mock-${order.paymentRequestId}`);
  assert.match(order.checkoutUrl, /^http:\/\/localhost\/mock-checkout/);
  assert.equal(gateway.calls[0].operation, "createOrder");
  assert.equal(gateway.calls[0].input.requestId, order.paymentRequestId);
});

test("Free 商品不能创建支付订单，也不会写入本地订单", async () => {
  const { billing, gateway, store } = billingFixture();
  await assert.rejects(() => billing.createOrder({ userId: "u1", productCode: "free_monthly", amount: 1 }), {
    code: "FREE_PRODUCT_NOT_PURCHASABLE",
  });
  assert.equal(store.orders.size, 0);
  assert.equal(gateway.calls.length, 0);
});
test("资金写请求的 request ID 和取消状态均在 Provider 调用前持久化", async () => {
  const sequence = [];
  const snapshots = [];
  const gateway = new MockWaffoGateway();
  for (const method of ["createOrder", "createSubscription", "refundOrder", "cancelSubscription"]) {
    const original = gateway[method].bind(gateway);
    gateway[method] = async (input) => {
      sequence.push(`${method}:provider`);
      return original(input);
    };
  }
  const base = harness();
  const persist = async () => {
    sequence.push("persist");
    snapshots.push({
      orders: [...base.store.orders.values()].map((row) => ({ ...row })),
      subscriptions: [...base.store.subscriptions.values()].map((row) => ({ ...row })),
      refunds: [...base.store.refunds.values()].map((row) => ({ ...row })),
    });
  };
  const entitlements = new EntitlementService(base);
  const billing = new BillingService({ ...base, entitlements, gateway, persist });

  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  assert.deepEqual(sequence.slice(0, 2), ["persist", "createOrder:provider"]);
  assert.equal(snapshots[0].orders[0].paymentRequestId, order.paymentRequestId);

  const subscriptionOrder = await billing.createOrder({ userId: "u1", productCode: "pro_monthly", amount: 1_200 });
  assert.deepEqual(sequence.slice(-3), ["persist", "createSubscription:provider", "persist"]);
  assert.equal(snapshots.at(-1).subscriptions[0].subscriptionRequest, subscriptionOrder.subscriptionRequest);
  assert.match(subscriptionOrder.externalSubscriptionId, /^mock-subscription-/);
  assert.match(subscriptionOrder.checkoutUrl, /^http:\/\/localhost\/mock-checkout/);

  await billing.processWebhook(event("evt-order-paid", "order.paid", { orderId: order.id }, 200));
  await billing.requestRefund({ userId: "u1", orderId: order.id });
  assert.deepEqual(sequence.slice(-3), ["persist", "refundOrder:provider", "persist"]);
  assert.equal(snapshots.at(-1).refunds[0].refundRequestId, order.refundRequestId);

  const subscription = billing.store.subscriptions.get(subscriptionOrder.subscriptionId);
  await billing.processWebhook(event("evt-sub-active", "subscription.activated",
    subscriptionData(subscription, { periodId: "month-1", periodStart: 100, currentPeriodEnd: 2_000_000 }), 100));
  await billing.cancelSubscription({ userId: "u1", subscriptionId: subscription.id });
  assert.deepEqual(sequence.slice(-3), ["persist", "cancelSubscription:provider", "persist"]);
  assert.equal(snapshots.at(-1).subscriptions[0].cancelAtPeriodEnd, true);
  assert.equal(subscription.cancelRequestStatus, "canceling");
  assert.deepEqual(gateway.calls.at(-1).input, {
    externalSubscriptionId: subscription.externalSubscriptionId,
    subscriptionRequest: subscription.subscriptionRequest,
  });
});

test("Provider 明确失败后先持久化本地失败状态，退款失败可安全重新申请", async () => {
  const snapshots = [];
  const gateway = new MockWaffoGateway();
  gateway.createOrder = async (input) => {
    gateway.calls.push({ operation: "createOrder", input });
    return { acquiringOrderId: `mock-${input.requestId}`, checkoutUrl: "http://localhost/mock-checkout" };
  };
  gateway.refundOrder = async (input) => {
    gateway.calls.push({ operation: "refundOrder", input });
    throw Object.assign(new Error("refund rejected"), { code: "WAFFO_API_ERROR" });
  };
  const base = harness();
  const entitlements = new EntitlementService(base);
  const persist = async () => snapshots.push({
    orders: [...base.store.orders.values()].map((row) => ({ ...row })),
    refunds: [...base.store.refunds.values()].map((row) => ({ ...row })),
  });
  const billing = new BillingService({ ...base, entitlements, gateway, persist });
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  await billing.processWebhook(event("evt-failed-refund-paid", "order.paid", { orderId: order.id }, 200));

  await assert.rejects(() => billing.requestRefund({ userId: "u1", orderId: order.id }), { code: "WAFFO_API_ERROR" });
  const refund = [...base.store.refunds.values()][0];
  assert.equal(order.status, "paid");
  assert.equal(refund.status, "failed");
  assert.equal(snapshots.at(-1).refunds[0].status, "failed");
  assert.equal(snapshots.at(-1).orders[0].status, "paid");
  assert.equal(base.store.refunds.size, 1);
});

test("取消订阅明确失败时撤销本地到期取消意图并持久化失败状态", async () => {
  const snapshots = [];
  const gateway = new MockWaffoGateway();
  gateway.cancelSubscription = async (input) => {
    gateway.calls.push({ operation: "cancelSubscription", input });
    throw Object.assign(new Error("cancel rejected"), { code: "WAFFO_API_ERROR" });
  };
  const base = harness();
  const entitlements = new EntitlementService(base);
  const billing = new BillingService({ ...base, entitlements, gateway,
    persist: async () => snapshots.push([...base.store.subscriptions.values()].map((row) => ({ ...row }))) });
  const order = await billing.createOrder({ userId: "u1", productCode: "pro_monthly", amount: 1_200 });
  const subscription = base.store.subscriptions.get(order.subscriptionId);
  subscription.status = "active";

  await assert.rejects(() => billing.cancelSubscription({ userId: "u1", subscriptionId: subscription.id }), { code: "WAFFO_API_ERROR" });
  assert.equal(subscription.cancelAtPeriodEnd, false);
  assert.equal(subscription.cancelRequestStatus, "failed");
  assert.equal(snapshots.at(-1)[0].cancelAtPeriodEnd, false);
  assert.equal(snapshots.at(-1)[0].cancelRequestStatus, "failed");
});

test("启动资金对账只 inquiry 已有 request ID，不执行任何 Provider write", async () => {
  const base = harness();
  const entitlements = new EntitlementService(base);
  const calls = [];
  const gateway = {
    async inquiryOrder(input) { calls.push(["inquiryOrder", input]); return { acquiringOrderId: "AO_RECONCILED", status: "PAY_IN_PROGRESS" }; },
    async inquirySubscription(input) { calls.push(["inquirySubscription", input]); return { externalSubscriptionId: "SUB_RECONCILED", status: "IN_PROGRESS" }; },
    async inquiryRefund(input) { calls.push(["inquiryRefund", input]); return { acquiringRefundOrderId: "AR_RECONCILED", status: "REFUND_IN_PROGRESS" }; },
    async createOrder() { throw new Error("unexpected createOrder"); },
    async createSubscription() { throw new Error("unexpected createSubscription"); },
    async refundOrder() { throw new Error("unexpected refundOrder"); },
    async cancelSubscription() { throw new Error("unexpected cancelSubscription"); },
  };
  base.store.orders.set("order-1", { id: "order-1", userId: "u1", status: "pending", paymentRequestId: "payment-request-1" });
  base.store.orders.set("order-2", { id: "order-2", userId: "u1", status: "created" });
  base.store.subscriptions.set("subscription-1", {
    id: "subscription-1", orderId: "order-2", userId: "u1", status: "creating", subscriptionRequest: "subscription-request-1",
  });
  base.store.refunds.set("refund-1", {
    id: "refund-1", orderId: "order-1", userId: "u1", status: "pending", refundRequestId: "refund-request-1",
  });
  const billing = new BillingService({ ...base, entitlements, gateway });

  assert.deepEqual(await billing.reconcilePendingBilling(), { orders: 1, subscriptions: 1, refunds: 1 });
  assert.deepEqual(calls.map(([operation]) => operation), ["inquiryOrder", "inquirySubscription", "inquiryRefund"]);
  assert.equal(base.store.orders.get("order-1").status, "pending_confirmation");
  assert.equal(base.store.subscriptions.get("subscription-1").externalSubscriptionId, "SUB_RECONCILED");
  assert.equal(base.store.refunds.get("refund-1").acquiringRefundOrderId, "AR_RECONCILED");
});
test("支付成功只发放一次权益，重复 Webhook 保持幂等", async () => {
  const { billing, entitlements } = billingFixture();
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  const paid = event("evt-paid", "order.paid", { orderId: order.id });
  assert.deepEqual(await billing.processWebhook(paid), { processed: true });
  assert.deepEqual(await billing.processWebhook(paid), { duplicate: true });
  assert.equal(entitlements.balance("u1"), 30);
});
test("并发 Webhook 按 occurredAt 串行处理并忽略旧事件", async () => {
  const { billing, entitlements } = billingFixture();
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  const newer = billing.processWebhook(event("evt-newer", "order.paid", { orderId: order.id }, 200));
  const older = billing.processWebhook(event("evt-older", "order.paid", { orderId: order.id }, 100));
  const [newerResult, olderResult] = await Promise.all([newer, older]);
  assert.deepEqual(newerResult, { processed: true });
  assert.deepEqual(olderResult, { ignored: true, reason: "stale" });
  assert.equal(order.lastEventAt, 200);
  assert.equal(entitlements.balance("u1"), 30);
  assert.equal(billing.store.webhookEvents.get("evt-older").status, "ignored_stale");
});
test("失败支付不发权益且更旧事件不会覆盖新状态", async () => {
  const { billing, entitlements } = billingFixture();
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  await billing.processWebhook(event("evt-failed", "payment.failed", { orderId: order.id, failureCode: "DECLINED" }, 300));
  const stale = await billing.processWebhook(event("evt-old-paid", "order.paid", { orderId: order.id }, 200));
  assert.deepEqual(stale, { ignored: true, reason: "stale" });
  assert.equal(order.status, "payment_failed");
  assert.equal(entitlements.balance("u1"), 0);
});
test("未消费订单退款先持久化 request ID，Webhook 确认后撤销权益", async () => {
  const { billing, entitlements, store } = billingFixture();
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  await billing.processWebhook(event("evt-paid", "order.paid", { orderId: order.id }, 200));
  const result = await billing.requestRefund({ userId: "u1", orderId: order.id, reason: "requested_by_customer" });
  const refund = [...store.refunds.values()][0];
  assert.equal(result.status, "refund_pending");
  assert.equal(refund.status, "requested");
  assert.match(refund.acquiringRefundOrderId, /^mock-refund-/);
  await billing.processWebhook(event("evt-refund-pending", "refund.pending",
    { refundRequestId: refund.refundRequestId }, 250));
  assert.equal(refund.status, "pending");
  await billing.processWebhook(event("evt-refund", "order.refunded",
    { orderId: order.id, refundRequestId: refund.refundRequestId }, 300));
  assert.equal(order.status, "refunded");
  assert.equal(order.revokedAmount, 30);
  assert.equal(refund.status, "refunded");
  assert.equal(entitlements.balance("u1"), 0);
});
test("已消费、订阅和已生成 Deep Report 的退款都转人工", async () => {
  const consumed = billingFixture();
  const order = await consumed.billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  await consumed.billing.processWebhook(event("evt-consumed-paid", "order.paid", { orderId: order.id }, 200));
  const hold = consumed.entitlements.reserve({ userId: "u1", amount: 8, referenceId: "analysis-1" });
  consumed.entitlements.confirm(hold.id);
  await assert.rejects(() => consumed.billing.requestRefund({ userId: "u1", orderId: order.id }), {
    code: "REFUND_MANUAL_REVIEW_REQUIRED",
  });
  assert.equal(consumed.store.refunds.size, 0);

  const subscription = billingFixture();
  const { order: subscriptionOrder, subscription: localSubscription } = await createSubscription(subscription.billing);
  await subscription.billing.processWebhook(event("evt-sub-refund-active", "subscription.activated",
    subscriptionData(localSubscription, { periodId: "sub-refund-1", periodStart: 100, currentPeriodEnd: 2_000_000 }), 200));
  await assert.rejects(() => subscription.billing.requestRefund({ userId: "u1", orderId: subscriptionOrder.id }), {
    code: "REFUND_MANUAL_REVIEW_REQUIRED",
  });

  const report = billingFixture();
  const reportOrder = await report.billing.createOrder({ userId: "u1", productCode: "deep_report", amount: 499 });
  await report.billing.processWebhook(event("evt-report-paid", "order.paid", { orderId: reportOrder.id }, 200));
  const reportHold = report.entitlements.reserve({ userId: "u1", unit: "report", amount: 1, referenceId: "report-1" });
  report.entitlements.confirm(reportHold.id);
  await assert.rejects(() => report.billing.requestRefund({ userId: "u1", orderId: reportOrder.id }), {
    code: "REFUND_MANUAL_REVIEW_REQUIRED",
  });
});
test("订阅激活、付款、重复续期和取消按冻结生命周期处理", async () => {
  const { billing, entitlements, store, gateway } = billingFixture();
  const { order, subscription } = await createSubscription(billing);
  const data = subscriptionData(subscription, { periodId: "2026-09", periodStart: 100, currentPeriodEnd: 2_000_000 });
  await billing.processWebhook(event("evt-active", "subscription.activated", data, 200));
  assert.equal(order.status, "paid");
  assert.equal(entitlements.balance("u1"), 60);
  const grantCount = store.grants.size;

  await billing.processWebhook(event("evt-payment", "subscription.payment",
    { ...data, orderStatus: "PAY_SUCCESS" }, 250));
  assert.equal(entitlements.balance("u1"), 60);
  assert.equal(store.grants.size, grantCount);

  await billing.processWebhook(event("evt-renew-replay", "subscription.renewed", data, 300));
  assert.equal(entitlements.balance("u1"), 60);
  assert.equal(store.grants.size, grantCount);

  await billing.cancelSubscription({ userId: "u1", subscriptionId: subscription.id });
  assert.equal(subscription.cancelAtPeriodEnd, true);
  assert.equal(gateway.calls.at(-1).operation, "cancelSubscription");
  await billing.processWebhook(event("evt-cancel", "subscription.canceled", { subscriptionId: subscription.id }, 400));
  assert.equal(store.subscriptions.get(subscription.id).status, "canceled");
  assert.equal(entitlements.balance("u1"), 60);
});
test("新周期扣款失败进入 past_due，不发新周期权益", async () => {
  const { billing, entitlements, store } = billingFixture();
  const { subscription } = await createSubscription(billing);
  const firstPeriod = subscriptionData(subscription, { periodId: "period-1", periodStart: 100, currentPeriodEnd: 2_000_000 });
  await billing.processWebhook(event("evt-active", "subscription.activated", firstPeriod, 200));
  await billing.processWebhook(event("evt-failed", "payment.failed",
    { externalSubscriptionId: subscription.externalSubscriptionId, failureCode: "DECLINED" }, 300));
  assert.equal(store.subscriptions.get(subscription.id).status, "past_due");
  assert.equal(entitlements.balance("u1"), 60);
  assert.equal(store.grants.size, 1);
});
test("订阅 order.paid 和 subscription.payment 都不走一次性权益发放", async () => {
  const { billing, entitlements, store } = billingFixture();
  const { order, subscription } = await createSubscription(billing);
  await billing.processWebhook(event("evt-sub-order-paid", "order.paid",
    { orderId: order.id, amount: order.amount, currency: order.currency }, 200));
  await billing.processWebhook(event("evt-sub-payment", "subscription.payment",
    subscriptionData(subscription, { orderStatus: "PAY_SUCCESS" }), 300));
  assert.equal(entitlements.balance("u1"), 0);
  assert.equal(store.grants.size, 0);
  await billing.processWebhook(event("evt-sub-activated", "subscription.activated",
    subscriptionData(subscription, { periodId: "period-1", periodStart: 100, currentPeriodEnd: 2_000_000 }), 400));
  assert.equal(entitlements.balance("u1"), 60);
});

test("订阅激活金额或币种与本地订单不一致时失败且不发放权益", async () => {
  const { billing, entitlements, store } = billingFixture();
  const { subscription } = await createSubscription(billing);
  const baseData = subscriptionData(subscription, { periodId: "mismatch-1", periodStart: 100, currentPeriodEnd: 2_000_000 });

  await assert.rejects(() => billing.processWebhook(event("evt-sub-amount-mismatch", "subscription.activated",
    { ...baseData, amount: 1_199, currency: "USD" }, 200)), { code: "PAYMENT_AMOUNT_MISMATCH" });
  await assert.rejects(() => billing.processWebhook(event("evt-sub-currency-mismatch", "subscription.activated",
    { ...baseData, amount: 1_200, currency: "EUR" }, 201)), { code: "PAYMENT_CURRENCY_MISMATCH" });
  assert.equal(subscription.status, "pending");
  assert.equal(store.grants.size, 0);
  assert.equal(entitlements.balance("u1"), 0);
  assert.equal(store.webhookEvents.size, 0);
});
test("年付订阅建立 12 个独立的 60 分钟自然月窗口", async () => {
  let now = Date.UTC(2026, 0, 15);
  const fixture = billingFixture({ clock: () => now });
  const { billing, entitlements, store } = fixture;
  const { subscription } = await createSubscription(billing, "pro_yearly");
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2027, 0, 1);
  const data = subscriptionData(subscription, { periodId: "year-1", periodStart: start, currentPeriodEnd: end });
  await billing.processWebhook(event("evt-year-active", "subscription.activated", data, start));
  assert.equal(store.grants.size, 12);
  assert.deepEqual([...store.grants.values()].map((grant) => grant.amount), Array(12).fill(60));
  assert.equal(entitlements.balance("u1"), 60);

  await billing.processWebhook(event("evt-year-replay", "subscription.renewed", data, start + 1));
  assert.equal(store.grants.size, 12);
  now = Date.UTC(2026, 1, 1);
  assert.equal(entitlements.balance("u1"), 60);
  now = end;
  assert.equal(entitlements.balance("u1"), 0);
});
test("首次订阅激活建立乱序游标并拒绝更旧取消事件", async () => {
  const { billing, store } = billingFixture();
  const { subscription } = await createSubscription(billing);
  const data = subscriptionData(subscription, { periodId: "period-1", periodStart: 100, currentPeriodEnd: 2_000_000 });
  await billing.processWebhook(event("evt-active", "subscription.activated", data, 300));
  const stale = await billing.processWebhook(event("evt-cancel-old", "subscription.canceled",
    { subscriptionId: subscription.id }, 200));
  assert.deepEqual(stale, { ignored: true, reason: "stale" });
  assert.equal(store.subscriptions.get(subscription.id).status, "active");
});
test("Webhook 版本、事件和归一结构必须显式校验", async () => {
  const { billing } = billingFixture();
  await assert.rejects(() => billing.processWebhook({ id: "e1", type: "order.paid", version: 2, occurredAt: 1, data: {} }), {
    code: "UNSUPPORTED_WEBHOOK_VERSION",
  });
  await assert.rejects(() => billing.processWebhook({ id: "e2", type: "unknown", version: 1, occurredAt: 1, data: {} }), {
    code: "UNSUPPORTED_WEBHOOK_EVENT",
  });
  await assert.rejects(() => billing.processWebhook({ id: "e3", type: "order.paid", version: 1, occurredAt: 1 }), {
    code: "INVALID_WEBHOOK",
  });
});
test("商品目录覆盖免费、充值包和单次报告权益", async () => {
  const { billing, entitlements } = billingFixture();
  entitlements.grant({ userId: "u1", amount: 5, source: "free", sourceId: "free-2026-09" });
  assert.equal(entitlements.balance("u1"), 5);
  const minutes = await billing.createOrder({ userId: "u1", productCode: "minutes_100", amount: 1_500 });
  await billing.processWebhook(event("event-minutes", "order.paid", { orderId: minutes.id }, 300));
  const report = await billing.createOrder({ userId: "u1", productCode: "deep_report", amount: 499 });
  await billing.processWebhook(event("event-report", "order.paid", { orderId: report.id }, 301));
  assert.equal(entitlements.balance("u1", "minute"), 105);
  assert.equal(entitlements.balance("u1", "report"), 1);
});
test("管理员概览返回订单、退款及其 Webhook 归属引用", async () => {
  const base = harness();
  const entitlements = new EntitlementService(base);
  const billing = new BillingService({ ...base, entitlements, gateway: new MockWaffoGateway() });
  const admin = new AdminService({ ...base, entitlements });
  base.store.users.set("u1", { id: "u1", email: "u@example.com", role: "user", status: "active" });
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  await billing.processWebhook(event("evt-user-paid", "order.paid", { orderId: order.id }, 200));
  await billing.requestRefund({ userId: "u1", orderId: order.id });
  const refund = [...base.store.refunds.values()][0];
  await billing.processWebhook(event("evt-refund-pending", "refund.pending",
    { refundId: refund.id, refundRequestId: refund.refundRequestId }, 300));
  base.store.analyses.set("a1", { id: "a1", userId: "u1", status: "failed", error: { code: "STT_FAILED" } });
  admin.returnMinutes({ userId: "u1", minutes: 2, actorId: "admin-1", reason: "support" });
  admin.disableAccount({ userId: "u1", actorId: "admin-1", reason: "abuse" });
  const overview = admin.userOverview("u1");
  assert.equal(overview.orders.length, 1);
  assert.equal(overview.refunds.length, 1);
  assert.equal(overview.webhooks.length, 2);
  assert.equal(overview.webhooks.at(-1).refundId, refund.id);
  assert.equal(overview.user.status, "disabled");
  assert.deepEqual(base.store.audit.map((row) => row.action), ["entitlement.return", "account.disable"]);
  assert.equal(overview.errors[0].error.code, "STT_FAILED");
});
