import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRuntime } from "../src/index.js";
import { api, startFixture } from "./helpers.js";

test("Waffo SDK 缺失或非法 X-SIGNATURE 时返回签名失败响应且不处理业务", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const notification = { id: "invalid-signature-event", eventType: "PAYMENT_NOTIFICATION", result: {} };
  const missing = await postWebhook(fixture, notification, undefined);
  const invalid = await postWebhook(fixture, notification, "not-a-valid-rsa-signature");
  for (const response of [missing, invalid]) {
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload, { message: "failed" });
    assert.ok(response.headers.get("x-signature"));
  }
  assert.equal(fixture.store.webhookEvents.size, 0);
});

test("BillingService 在 Waffo provider write 前已把 paymentRequestId 落盘", async (t) => {
  let observation;
  const fixture = await startFixture({ waffoGateway: {
    async createOrder(input) {
      const snapshot = JSON.parse(await readFile(fixture.config.appStateFile, "utf8"));
      const row = snapshot.orders.find(([id]) => id === input.merchantOrderId)?.[1];
      observation = { input, row };
      return { acquiringOrderId: `acquiring-${input.requestId}`, checkoutUrl: "https://checkout.example.test/order" };
    },
  } });
  t.after(() => fixture.close());
  const session = await login(fixture, "persist-before-write@example.com");
  const order = await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "minutes_30" } });
  assert.equal(order.status, 201);
  assert.equal(observation.row.paymentRequestId, observation.input.requestId);
  assert.equal(observation.row.status, "pending");
});

test("一次性成功、重复和过期 Webhook 均经 SDK 验签并保持幂等", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await login(fixture, "one-time-webhook@example.com");
  const order = (await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "minutes_30" } })).payload.data;
  const event = oneTimePayment(order, "one-time-success", Date.now());
  const first = await postWebhook(fixture, event);
  assert.deepEqual(first.payload, { message: "success" });
  assert.equal(first.body, '{"message":"success"}');
  assert.equal(fixture.providers.waffoClient.webhook().verifySignature(first.body, first.headers.get("x-signature")), true);
  assert.equal(fixture.application.entitlements.balance(session.user.id), 35);

  const duplicate = await postWebhook(fixture, event);
  assert.deepEqual(duplicate.payload, { message: "success" });
  assert.equal(fixture.store.webhookEvents.size, 1);
  const stale = oneTimePayment(order, "one-time-stale", event.occurredAt - 1);
  const staleResponse = await postWebhook(fixture, stale);
  assert.deepEqual(staleResponse.payload, { message: "success" });
  assert.equal(fixture.store.webhookEvents.get("one-time-stale").status, "ignored_stale");
  assert.equal(fixture.application.entitlements.balance(session.user.id), 35);
});

test("合法签名但未知 Waffo 状态 fail closed，不写入 Webhook 或权益", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await login(fixture, "unknown-waffo-status@example.com");
  const order = (await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "minutes_30" } })).payload.data;
  const notification = oneTimePayment(order, "unknown-waffo-status", Date.now());
  notification.result.orderStatus = "FUTURE_PROVIDER_STATUS";
  const beforeBalance = fixture.application.entitlements.balance(session.user.id);

  const response = await postWebhook(fixture, notification);
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { message: "failed" });
  assert.equal(fixture.store.webhookEvents.size, 0);
  assert.equal(fixture.store.orders.get(order.id).status, "created");
  assert.equal(fixture.application.entitlements.balance(session.user.id), beforeBalance);
});

test("订阅 ACTIVE、renewed、canceled 生命周期只处理已有本地订阅", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await login(fixture, "subscription-lifecycle@example.com");
  const order = (await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "pro_monthly" } })).payload.data;
  const subscription = subscriptionResult(order, "subscription-active", "ACTIVE", 1, Date.now() - 10_000);
  assert.deepEqual((await postWebhook(fixture, {
    id: "subscription-active", eventType: "SUBSCRIPTION_STATUS_NOTIFICATION", result: subscription,
    occurredAt: subscription.occurredAt,
  })).payload, { message: "success" });
  assert.equal(fixture.store.subscriptions.get(order.subscriptionId).status, "active");
  assert.ok([...fixture.store.grants.values()].some((grant) => grant.sourceId === `subscription:${order.subscriptionId}:period:1`));

  const renewal = subscriptionResult(order, "subscription-renewed", "ACTIVE", 2, Date.now() - 5_000);
  renewal.paymentDetails = [{ period: "2", acquiringOrderId: "renewal-acquiring-order",
    orderAmount: "12.00", orderCurrency: "USD", orderStatus: "PAY_SUCCESS", orderUpdatedAt: iso(renewal.occurredAt) }];
  assert.deepEqual((await postWebhook(fixture, {
    id: "subscription-renewed", eventType: "SUBSCRIPTION_PERIOD_CHANGED_NOTIFICATION", result: renewal,
    occurredAt: renewal.occurredAt,
  })).payload, { message: "success" });
  assert.ok([...fixture.store.grants.values()].some((grant) => grant.sourceId === `subscription:${order.subscriptionId}:period:2`));

  const canceled = subscriptionResult(order, "subscription-canceled", "USER_CANCELLED", 2, Date.now());
  assert.deepEqual((await postWebhook(fixture, {
    id: "subscription-canceled", eventType: "SUBSCRIPTION_STATUS_NOTIFICATION", result: canceled,
    occurredAt: canceled.occurredAt,
  })).payload, { message: "success" });
  assert.equal(fixture.store.subscriptions.get(order.subscriptionId).status, "canceled");
});

test("订阅激活金额与本地订单不一致时返回签名失败且不发放权益", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await login(fixture, "subscription-amount-mismatch@example.com");
  const order = (await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "pro_monthly" } })).payload.data;
  const beforeGrantCount = fixture.store.grants.size;
  const notification = subscriptionResult(order, "subscription-amount-mismatch", "ACTIVE", 1, Date.now());
  notification.amount = "99.00";

  const response = await postWebhook(fixture, {
    id: notification.id, eventType: "SUBSCRIPTION_STATUS_NOTIFICATION", result: notification,
    occurredAt: notification.occurredAt,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { message: "failed" });
  assert.equal(fixture.store.subscriptions.get(order.subscriptionId).status, "pending");
  assert.equal(fixture.store.grants.size, beforeGrantCount);
  assert.equal([...fixture.store.grants.values()].some((grant) => grant.sourceId.startsWith(`subscription:${order.subscriptionId}:`)), false);
  assert.equal(fixture.store.webhookEvents.size, 0);
});

test("订阅 PAYMENT_NOTIFICATION 只记录付款事实，不发放一次性订单权益", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await login(fixture, "subscription-payment@example.com");
  const order = (await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "pro_monthly" } })).payload.data;
  const grantCount = fixture.store.grants.size;
  const event = { id: "subscription-payment", eventType: "PAYMENT_NOTIFICATION", occurredAt: Date.now(), result: {
    paymentRequestId: order.subscriptionRequest, acquiringOrderId: "subscription-payment-order",
    orderStatus: "PAY_SUCCESS", orderCurrency: "USD", orderAmount: "12.00",
    orderCompletedAt: new Date().toISOString(), paymentInfo: { productName: "SUBSCRIPTION" },
    subscriptionInfo: { subscriptionId: order.externalSubscriptionId,
      subscriptionRequest: order.subscriptionRequest, period: "1" },
  } };
  assert.deepEqual((await postWebhook(fixture, event)).payload, { message: "success" });
  assert.equal(fixture.store.grants.size, grantCount);
  assert.equal(fixture.store.subscriptions.get(order.subscriptionId).lastPaymentStatus, "PAY_SUCCESS");
  assert.equal([...fixture.store.grants.values()].filter((grant) => grant.sourceId === `order:${order.id}`).length, 0);
  assert.equal(fixture.application.entitlements.balance(session.user.id), 5);
});

test("合法签名但不存在本地订阅的通知不会凭空创建订阅", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const response = await postWebhook(fixture, { id: "unknown-subscription", eventType: "SUBSCRIPTION_STATUS_NOTIFICATION",
    occurredAt: Date.now(), result: { subscriptionId: "missing-external-subscription",
      subscriptionRequest: "missing-subscription-request", subscriptionStatus: "ACTIVE" } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { message: "failed" });
  assert.equal(fixture.store.subscriptions.size, 0);
  assert.equal(fixture.store.webhookEvents.size, 0);
});

test("退款通知经 onRefund 归一并撤销未使用的一次性权益", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await login(fixture, "refund-webhook@example.com");
  const order = (await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "minutes_30" } })).payload.data;
  await postWebhook(fixture, oneTimePayment(order, "refund-order-paid", Date.now()));
  const requested = await api(fixture, `/api/v1/billing/orders/${order.id}/refund`, { method: "POST",
    cookie: session.cookie, body: { reason: "customer_request" } });
  assert.equal(requested.status, 200);
  const refundRequestId = requested.payload.data.refundRequestId;
  const refund = { id: "refund-completed", eventType: "REFUND_NOTIFICATION", result: {
    refundRequestId, origPaymentRequestId: order.paymentRequestId,
    acquiringOrderId: order.acquiringOrderId, acquiringRefundOrderId: "refund-acquiring-order",
    refundAmount: "6.00", refundStatus: "ORDER_FULLY_REFUNDED", refundCompletedAt: new Date().toISOString(),
  } };
  assert.deepEqual((await postWebhook(fixture, refund)).payload, { message: "success" });
  assert.equal(fixture.store.orders.get(order.id).status, "refunded");
  assert.equal([...fixture.store.refunds.values()].find((row) => row.refundRequestId === refundRequestId).status, "refunded");
  assert.equal(fixture.application.entitlements.balance(session.user.id), 5);
});

test("应用重启后恢复订单、request ID 和 refunds 快照", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await login(fixture, "restart-persistence@example.com");
  const order = (await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie: session.cookie,
    body: { productCode: "minutes_30" } })).payload.data;
  const refund = { id: "restart-refund", orderId: order.id, refundRequestId: "restart-refund-request",
    acquiringOrderId: order.acquiringOrderId, amount: order.amount, currency: order.currency, status: "pending" };
  fixture.store.refunds.set(refund.id, refund);
  await fixture.store.flush();
  const restarted = await createRuntime({ config: fixture.config, providers: fixture.providers, logger: fixture.logger });
  assert.equal(restarted.store.orders.get(order.id).paymentRequestId, order.paymentRequestId);
  assert.equal(restarted.store.refunds.get(refund.id).status, "pending_confirmation");
  assert.equal(restarted.store.refunds.get(refund.id).providerStatus, "REFUND_IN_PROGRESS");
});

test("应用启动时只对账 pending 资金记录，不重放 Provider write", async (t) => {
  const calls = [];
  const gateway = {
    async inquiryOrder(input) { calls.push(["inquiryOrder", input]); return { acquiringOrderId: "AO_RECOVERED", status: "PAY_IN_PROGRESS" }; },
    async inquirySubscription(input) { calls.push(["inquirySubscription", input]); return { externalSubscriptionId: "SUB_RECOVERED", status: "IN_PROGRESS" }; },
    async inquiryRefund(input) { calls.push(["inquiryRefund", input]); return { acquiringRefundOrderId: "AR_RECOVERED", status: "REFUND_IN_PROGRESS" }; },
    async createOrder() { throw new Error("unexpected createOrder"); },
    async createSubscription() { throw new Error("unexpected createSubscription"); },
    async refundOrder() { throw new Error("unexpected refundOrder"); },
    async cancelSubscription() { throw new Error("unexpected cancelSubscription"); },
  };
  const fixture = await startFixture({ waffoGateway: gateway });
  t.after(() => fixture.close());
  fixture.store.orders.set("recover-order", { id: "recover-order", userId: "u1", status: "pending", paymentRequestId: "recover-payment" });
  fixture.store.subscriptions.set("recover-subscription", {
    id: "recover-subscription", orderId: "recover-order", userId: "u1", status: "creating", subscriptionRequest: "recover-subscription-request",
  });
  fixture.store.refunds.set("recover-refund", {
    id: "recover-refund", orderId: "recover-order", userId: "u1", status: "pending", refundRequestId: "recover-refund-request",
  });
  await fixture.store.flush();

  const restarted = await createRuntime({ config: fixture.config, providers: fixture.providers, logger: fixture.logger });
  assert.deepEqual(calls.map(([operation]) => operation), ["inquiryOrder", "inquirySubscription", "inquiryRefund"]);
  assert.deepEqual(calls.map(([, input]) => input), [
    { requestId: "recover-payment" },
    { requestId: "recover-subscription-request" },
    { refundRequestId: "recover-refund-request" },
  ]);
  assert.equal(restarted.store.orders.get("recover-order").status, "pending_confirmation");
  assert.equal(restarted.store.subscriptions.get("recover-subscription").externalSubscriptionId, "SUB_RECOVERED");
  assert.equal(restarted.store.refunds.get("recover-refund").acquiringRefundOrderId, "AR_RECOVERED");
});

async function login(fixture, email) {
  const requested = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email, redirectUri: "http://localhost:5173/auth" } });
  const consumed = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: requested.payload.data.previewToken } });
  return { cookie: consumed.cookie, user: consumed.payload.data.user };
}

async function postWebhook(fixture, notification, signature) {
  const body = JSON.stringify(notification);
  const headers = { "content-type": "application/json" };
  if (signature === undefined) signature = fixture.providers.waffoWebhookSigner(body);
  if (signature !== null) headers["x-signature"] = signature;
  return api(fixture, "/api/v1/webhooks/waffo", { method: "POST", body, headers });
}

function oneTimePayment(order, id, occurredAt) {
  return { id, eventType: "PAYMENT_NOTIFICATION", occurredAt, result: {
    merchantOrderId: order.id, paymentRequestId: order.paymentRequestId,
    acquiringOrderId: order.acquiringOrderId, orderStatus: "PAY_SUCCESS", orderCurrency: "USD",
    orderAmount: "6.00", orderCompletedAt: iso(occurredAt), paymentInfo: { productName: "ONE_TIME_PAYMENT" },
  } };
}

function subscriptionResult(order, id, status, period, occurredAt) {
  return { id, subscriptionId: order.externalSubscriptionId,
    subscriptionRequest: order.subscriptionRequest, merchantSubscriptionId: order.subscriptionId,
    subscriptionStatus: status, currency: "USD", amount: "12.00", occurredAt,
    productInfo: { periodType: "MONTHLY", periodInterval: "1", currentPeriod: String(period),
      startDateTime: iso(occurredAt), nextPaymentDateTime: iso(occurredAt + 30 * 24 * 60 * 60 * 1000) },
    paymentInfo: { productName: "SUBSCRIPTION" } };
}

function iso(timestamp) { return new Date(timestamp).toISOString(); }
