import test from "node:test";
import assert from "node:assert/strict";
import { AdminService } from "../src/admin-service.js";
import { BillingService } from "../src/billing-service.js";
import { EntitlementService } from "../src/entitlement-service.js";
import { MockWaffoGateway } from "../fixtures/local-adapters.js";
import { harness } from "./helpers.js";

function billingFixture() {
  const base = harness();
  const entitlements = new EntitlementService(base);
  const gateway = new MockWaffoGateway();
  const billing = new BillingService({ ...base, entitlements, gateway });
  return { ...base, entitlements, gateway, billing };
}

function event(id, type, data, occurredAt = 1_100_000) {
  return { id, type, version: 1, occurredAt, data };
}

test("创建分钟包订单仅调用注入的本地 Waffo gateway", async () => {
  const { billing, gateway } = billingFixture();
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  assert.equal(order.status, "created");
  assert.match(order.checkoutUrl, /^http:\/\/localhost\/mock-checkout/);
  assert.equal(gateway.calls[0].operation, "createOrder");
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

test("退款撤销对应订单尚未使用的权益", async () => {
  const { billing, entitlements } = billingFixture();
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  await billing.processWebhook(event("evt-paid", "order.paid", { orderId: order.id }, 200));
  const hold = entitlements.reserve({ userId: "u1", amount: 8, referenceId: "analysis-1" });
  entitlements.confirm(hold.id);
  await billing.requestRefund({ userId: "u1", orderId: order.id, reason: "requested_by_customer" });
  await billing.processWebhook(event("evt-refund", "order.refunded", { orderId: order.id }, 300));
  assert.equal(order.status, "refunded");
  assert.equal(order.revokedAmount, 22);
  assert.equal(entitlements.balance("u1"), 0);
});

test("订阅激活与续期分别发放，取消保留当前周期权益", async () => {
  const { billing, entitlements, store, gateway } = billingFixture();
  const data = { subscriptionId: "sub-1", externalSubscriptionId: "ext-sub", userId: "u1", productCode: "pro_monthly", currentPeriodEnd: 2_000_000 };
  await billing.processWebhook(event("evt-active", "subscription.activated", data, 200));
  await billing.processWebhook(event("evt-renew", "subscription.renewed", { ...data, currentPeriodEnd: 3_000_000 }, 300));
  assert.equal(entitlements.balance("u1"), 120);
  await billing.cancelSubscription({ userId: "u1", subscriptionId: "sub-1" });
  assert.equal(gateway.calls.at(-1).operation, "cancelSubscription");
  await billing.processWebhook(event("evt-cancel", "subscription.canceled", { subscriptionId: "sub-1" }, 400));
  assert.equal(store.subscriptions.get("sub-1").status, "canceled");
  assert.equal(entitlements.balance("u1"), 120);
});

test("订阅扣款失败进入 past_due 且不发放新周期权益", async () => {
  const { billing, entitlements, store } = billingFixture();
  const data = { subscriptionId: "sub-1", externalSubscriptionId: "ext", userId: "u1", productCode: "pro_monthly", currentPeriodEnd: 2_000_000 };
  await billing.processWebhook(event("evt-active", "subscription.activated", data, 200));
  await billing.processWebhook(event("evt-failed", "payment.failed", { subscriptionId: "sub-1", failureCode: "DECLINED" }, 300));
  assert.equal(store.subscriptions.get("sub-1").status, "past_due");
  assert.equal(entitlements.balance("u1"), 60);
});

test("不同事件 ID 重放同一订阅周期不会重复发放", async () => {
  const { billing, entitlements } = billingFixture();
  const data = { subscriptionId: "sub-1", externalSubscriptionId: "ext", userId: "u1", productCode: "pro_monthly", periodId: "2026-09", currentPeriodEnd: 2_000_000 };
  await billing.processWebhook(event("evt-active", "subscription.activated", data, 200));
  await billing.processWebhook(event("evt-replayed", "subscription.renewed", data, 300));
  assert.equal(entitlements.balance("u1"), 60);
});

test("首次订阅激活会建立乱序游标并拒绝更旧取消事件", async () => {
  const { billing, store } = billingFixture();
  const data = { subscriptionId: "sub-1", externalSubscriptionId: "ext", userId: "u1", productCode: "pro_monthly", currentPeriodEnd: 2_000_000 };
  await billing.processWebhook(event("evt-active", "subscription.activated", data, 300));
  const stale = await billing.processWebhook(event("evt-cancel-old", "subscription.canceled", { subscriptionId: "sub-1" }, 200));
  assert.equal(stale.ignored, true);
  assert.equal(store.subscriptions.get("sub-1").status, "active");
});

test("Webhook 版本和未知事件必须显式拒绝", async () => {
  const { billing } = billingFixture();
  await assert.rejects(() => billing.processWebhook({ id: "e1", type: "order.paid", version: 2, occurredAt: 1, data: {} }), { code: "UNSUPPORTED_WEBHOOK_VERSION" });
  await assert.rejects(() => billing.processWebhook({ id: "e2", type: "unknown", version: 1, occurredAt: 1, data: {} }), { code: "UNSUPPORTED_WEBHOOK_EVENT" });
});

test("商品目录覆盖 Free、Pro、充值包和单次报告权益", async () => {
  const { billing, entitlements } = billingFixture();
  const products = [["free_monthly", 5, "minute"], ["pro_yearly", 60, "minute"], ["minutes_100", 100, "minute"], ["deep_report", 1, "report"]];
  for (const [productCode, amount, unit] of products) {
    const order = await billing.createOrder({ userId: "u1", productCode, amount: 100 });
    await billing.processWebhook(event(`event-${productCode}`, "order.paid", { orderId: order.id }, 300));
    assert.ok(entitlements.balance("u1", unit) >= amount);
  }
});

test("管理查询、禁用和返还分钟同时写入审计记录", () => {
  const base = harness();
  const entitlements = new EntitlementService(base);
  const admin = new AdminService({ ...base, entitlements });
  base.store.users.set("u1", { id: "u1", email: "u@example.com", role: "user", status: "active" });
  base.store.analyses.set("a1", { id: "a1", userId: "u1", status: "failed" });
  admin.returnMinutes({ userId: "u1", minutes: 5, actorId: "admin-1", reason: "failed_analysis" });
  admin.disableAccount({ userId: "u1", actorId: "admin-1", reason: "abuse" });
  const overview = admin.userOverview("u1");
  assert.equal(overview.analyses.length, 1);
  assert.equal(overview.ledger.length, 1);
  assert.equal(overview.user.status, "disabled");
  assert.deepEqual(base.store.audit.map((row) => row.action), ["entitlement.return", "account.disable"]);
});

test("管理员用户概览按订单归属返回 Webhook 和失败任务", async () => {
  const base = harness();
  const entitlements = new EntitlementService(base);
  const billing = new BillingService({ ...base, entitlements, gateway: new MockWaffoGateway() });
  const admin = new AdminService({ ...base, entitlements });
  base.store.users.set("u1", { id: "u1", email: "u@example.com", role: "user", status: "active" });
  const order = await billing.createOrder({ userId: "u1", productCode: "minutes_30", amount: 600 });
  await billing.processWebhook(event("evt-user-paid", "order.paid", { orderId: order.id }, 200));
  base.store.analyses.set("a1", { id: "a1", userId: "u1", status: "failed", error: { code: "STT_FAILED" } });
  const overview = admin.userOverview("u1");
  assert.equal(overview.webhooks.length, 1);
  assert.equal(overview.webhooks[0].orderId, order.id);
  assert.equal(overview.errors[0].error.code, "STT_FAILED");
});
