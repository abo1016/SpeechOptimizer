import test from "node:test";
import assert from "node:assert/strict";
import { createUnavailableWaffoGateway, createWaffoGateway } from "../src/index.js";
import {
  action,
  baseOptions,
  createFakeClient,
  failure,
  orderInput,
  subscriptionInput,
  success,
  unknownStatus,
} from "./waffo-fixtures.js";

const ACTION = "https://checkout.example/action";

test("order create 映射官方 3.0.1 参数并返回 acquiringOrderId/checkoutUrl", async () => {
  const fake = createFakeClient({ orderCreate: success({ acquiringOrderId: "AO_1", orderAction: action(ACTION) }) });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.createOrder(orderInput({ amount: 605 }));

  assert.deepEqual(result, { acquiringOrderId: "AO_1", checkoutUrl: ACTION });
  assert.deepEqual(fake.calls[0], {
    operation: "order.create",
    params: {
      paymentRequestId: "order-request-1",
      merchantOrderId: "merchant-order-1",
      orderCurrency: "USD",
      orderAmount: "6.05",
      orderDescription: "30 Minutes",
      userInfo: {
        userId: "user-1", userEmail: "user@example.com", userCreatedAt: "2026-09-04T00:00:00.000Z", userTerminal: "WEB",
      },
      paymentInfo: { productName: "ONE_TIME_PAYMENT" },
      goodsInfo: { goodsId: "PROD_MINUTES", goodsName: "30 Minutes", goodsUrl: "https://merchant.example/minutes" },
      notifyUrl: "https://merchant.example/webhook",
      successRedirectUrl: "https://merchant.example/success",
      failedRedirectUrl: "https://merchant.example/failed",
      cancelRedirectUrl: "https://merchant.example/cancel",
    },
  });
});

test("subscription create 使用 currency/amount、SUBSCRIPTION 和 subscriptionAction", async () => {
  const fake = createFakeClient({ subscriptionCreate: success({ subscriptionId: "SUB_1", subscriptionAction: action(ACTION) }) });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.createSubscription(subscriptionInput({ amount: 1299, periodInterval: 1 }));

  assert.deepEqual(result, { externalSubscriptionId: "SUB_1", checkoutUrl: ACTION });
  assert.deepEqual(fake.calls[0], {
    operation: "subscription.create",
    params: {
      subscriptionRequest: "subscription-request-1",
      merchantSubscriptionId: "merchant-subscription-1",
      currency: "USD",
      amount: "12.99",
      productInfo: { description: "Pro Monthly", periodType: "MONTHLY", periodInterval: "1" },
      userInfo: {
        userId: "user-1", userEmail: "user@example.com", userCreatedAt: "2026-09-04T00:00:00.000Z", userTerminal: "WEB",
      },
      paymentInfo: { productName: "SUBSCRIPTION", payMethodType: "CREDITCARD,DEBITCARD" },
      goodsInfo: { goodsId: "PROD_PRO", goodsName: "Pro Monthly", goodsUrl: "https://merchant.example/pro" },
      notifyUrl: "https://merchant.example/webhook",
      successRedirectUrl: "https://merchant.example/success",
      failedRedirectUrl: "https://merchant.example/failed",
      cancelRedirectUrl: "https://merchant.example/cancel",
      subscriptionManagementUrl: "https://merchant.example/manage",
    },
  });
});

test("order refund 映射 refundAmount 并只返回 acquiringRefundOrderId", async () => {
  const fake = createFakeClient({ orderRefund: success({ acquiringRefundOrderId: "AR_1" }) });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.refundOrder({
    refundRequestId: "refund-request-1", acquiringOrderId: "AO_1", amount: 605, currency: "USD", reason: "requested",
  });

  assert.deepEqual(result, { acquiringRefundOrderId: "AR_1" });
  assert.deepEqual(fake.calls[0], {
    operation: "order.refund",
    params: {
      refundRequestId: "refund-request-1", acquiringOrderId: "AO_1", refundAmount: "6.05",
      refundReason: "requested", refundNotifyUrl: "https://merchant.example/refund-webhook",
    },
  });
  assert.equal("currency" in fake.calls[0].params, false);
});

test("order/subscription/refund inquiry 仅暴露归一化字段", async () => {
  const fake = createFakeClient({
    orderInquiry: success({ acquiringOrderId: "AO_1", orderStatus: "PAY_SUCCESS" }),
    subscriptionInquiry: success({ subscriptionId: "SUB_1", subscriptionStatus: "ACTIVE" }),
    refundInquiry: success({ acquiringRefundOrderId: "AR_1", refundStatus: "ORDER_FULLY_REFUNDED" }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));

  assert.deepEqual(await gateway.inquiryOrder({ requestId: "order-request-1" }), { acquiringOrderId: "AO_1", status: "PAY_SUCCESS" });
  assert.deepEqual(await gateway.inquirySubscription({ requestId: "subscription-request-1" }), { externalSubscriptionId: "SUB_1", status: "ACTIVE" });
  assert.deepEqual(await gateway.inquiryRefund({ refundRequestId: "refund-request-1" }), { acquiringRefundOrderId: "AR_1", status: "ORDER_FULLY_REFUNDED" });
  assert.deepEqual(fake.calls.map(({ operation, params }) => ({ operation, params })), [
    { operation: "order.inquiry", params: { paymentRequestId: "order-request-1" } },
    { operation: "subscription.inquiry", params: { subscriptionRequest: "subscription-request-1" } },
    { operation: "refund.inquiry", params: { refundRequestId: "refund-request-1" } },
  ]);
});

test("subscription cancel 使用 subscriptionId 并返回归一化结果", async () => {
  const fake = createFakeClient({ subscriptionCancel: success({ subscriptionId: "SUB_1", orderStatus: "MERCHANT_CANCELLED" }) });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.cancelSubscription({ externalSubscriptionId: "SUB_1", subscriptionRequest: "subscription-request-1" });

  assert.deepEqual(result, { externalSubscriptionId: "SUB_1", status: "MERCHANT_CANCELLED" });
  assert.deepEqual(fake.calls[0], { operation: "subscription.cancel", params: { subscriptionId: "SUB_1" } });
});

test("order create UnknownStatus 使用同一 paymentRequestId inquiry，绝不二次 create", async () => {
  const unknown = unknownStatus();
  const fake = createFakeClient({
    orderCreate: unknown,
    orderInquiry: success({ acquiringOrderId: "AO_RECOVERED", orderStatus: "PAY_IN_PROGRESS", orderAction: action(ACTION) }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.createOrder(orderInput());

  assert.deepEqual(result, { acquiringOrderId: "AO_RECOVERED", checkoutUrl: ACTION });
  assert.deepEqual(fake.calls.map(({ operation, params }) => ({ operation, params })), [
    { operation: "order.create", params: fake.calls[0].params },
    { operation: "order.inquiry", params: { paymentRequestId: "order-request-1" } },
  ]);
  assert.equal(fake.calls.filter((call) => call.operation === "order.create").length, 1);
});

test("subscription create UnknownStatus 使用同一 subscriptionRequest inquiry", async () => {
  const fake = createFakeClient({
    subscriptionCreate: unknownStatus(),
    subscriptionInquiry: success({ subscriptionId: "SUB_RECOVERED", subscriptionStatus: "IN_PROGRESS", subscriptionAction: action(ACTION) }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.createSubscription(subscriptionInput());

  assert.deepEqual(result, { externalSubscriptionId: "SUB_RECOVERED", checkoutUrl: ACTION });
  assert.deepEqual(fake.calls[1], { operation: "subscription.inquiry", params: { subscriptionRequest: "subscription-request-1" } });
  assert.equal(fake.calls.filter((call) => call.operation === "subscription.create").length, 1);
});

test("refund UnknownStatus 使用同一 refundRequestId inquiry", async () => {
  const fake = createFakeClient({
    orderRefund: unknownStatus(),
    refundInquiry: success({ acquiringRefundOrderId: "AR_RECOVERED", refundStatus: "REFUND_IN_PROGRESS" }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.refundOrder({
    refundRequestId: "refund-request-1", acquiringOrderId: "AO_1", amount: 605, currency: "USD", reason: "requested",
  });

  assert.deepEqual(result, { acquiringRefundOrderId: "AR_RECOVERED" });
  assert.deepEqual(fake.calls[1], { operation: "refund.inquiry", params: { refundRequestId: "refund-request-1" } });
  assert.equal(fake.calls.filter((call) => call.operation === "order.refund").length, 1);
});

test("refund inquiry 明确失败时返回 WAFFO_OPERATION_FAILED 且不二次退款", async () => {
  const fake = createFakeClient({
    orderRefund: unknownStatus(),
    refundInquiry: success({ acquiringRefundOrderId: "AR_FAILED", refundStatus: "ORDER_REFUND_FAILED" }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));

  await assert.rejects(
    () => gateway.refundOrder({
      refundRequestId: "refund-request-1", acquiringOrderId: "AO_1", amount: 605, currency: "USD", reason: "requested",
    }),
    { code: "WAFFO_OPERATION_FAILED" },
  );
  assert.deepEqual(fake.calls.map(({ operation }) => operation), ["order.refund", "refund.inquiry"]);
});

test("subscription cancel UnknownStatus 用同一 subscriptionRequest inquiry", async () => {
  const fake = createFakeClient({
    subscriptionCancel: unknownStatus(),
    subscriptionInquiry: success({ subscriptionId: "SUB_1", subscriptionStatus: "MERCHANT_CANCELLED" }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  const result = await gateway.cancelSubscription({ externalSubscriptionId: "SUB_1", subscriptionRequest: "subscription-request-1" });

  assert.deepEqual(result, { externalSubscriptionId: "SUB_1", status: "MERCHANT_CANCELLED" });
  assert.deepEqual(fake.calls[1], { operation: "subscription.inquiry", params: { subscriptionRequest: "subscription-request-1" } });
  assert.equal(fake.calls.filter((call) => call.operation === "subscription.cancel").length, 1);
});

test("subscription cancel inquiry 仍为 ACTIVE 时返回 WAFFO_STATUS_UNCONFIRMED", async () => {
  const fake = createFakeClient({
    subscriptionCancel: unknownStatus(),
    subscriptionInquiry: success({ subscriptionId: "SUB_1", subscriptionStatus: "ACTIVE" }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));

  await assert.rejects(
    () => gateway.cancelSubscription({ externalSubscriptionId: "SUB_1", subscriptionRequest: "subscription-request-1" }),
    { code: "WAFFO_STATUS_UNCONFIRMED", retryable: true },
  );
  assert.deepEqual(fake.calls.map(({ operation }) => operation), ["subscription.cancel", "subscription.inquiry"]);
});

test("create inquiry 缺少冻结结果字段时保持不确定态", async () => {
  const fake = createFakeClient({
    orderCreate: unknownStatus(),
    orderInquiry: success({ orderStatus: "PAY_SUCCESS", acquiringOrderId: "AO_RECOVERED" }),
  });
  const gateway = createWaffoGateway(baseOptions(fake.client));

  await assert.rejects(() => gateway.createOrder(orderInput()), { code: "WAFFO_STATUS_UNCONFIRMED", retryable: true });
  assert.deepEqual(fake.calls.map(({ operation }) => operation), ["order.create", "order.inquiry"]);
});

test("AuthService 的 epoch milliseconds 被转换为 SDK 要求的 ISO 字符串", async () => {
  const fake = createFakeClient({ orderCreate: success({ acquiringOrderId: "AO_1", orderAction: action(ACTION) }) });
  const gateway = createWaffoGateway(baseOptions(fake.client));
  await gateway.createOrder(orderInput({ userCreatedAt: Date.parse("2025-01-02T03:04:05.000Z") }));

  assert.equal(fake.calls[0].params.userInfo.userCreatedAt, "2025-01-02T03:04:05.000Z");
});

test("同键 inquiry 失败时统一返回 WAFFO_STATUS_UNCONFIRMED 且不二次 write", async () => {
  const fake = createFakeClient({ orderCreate: unknownStatus(), orderInquiry: failure("A0003", "暂时不可用") });
  const gateway = createWaffoGateway(baseOptions(fake.client));

  await assert.rejects(() => gateway.createOrder(orderInput()), { code: "WAFFO_STATUS_UNCONFIRMED", retryable: true });
  assert.equal(fake.calls.filter((call) => call.operation === "order.create").length, 1);
  assert.equal(fake.calls.filter((call) => call.operation === "order.inquiry").length, 1);
});

test("ApiResponse 非 success 映射为稳定 WAFFO_API_ERROR 并保留 provider code/message", async () => {
  const fake = createFakeClient({ orderCreate: failure("A0003", "invalid order") });
  const gateway = createWaffoGateway(baseOptions(fake.client));

  await assert.rejects(
    () => gateway.createOrder(orderInput()),
    (error) => error.code === "WAFFO_API_ERROR"
      && error.details.providerCode === "A0003"
      && error.details.providerMessage === "invalid order",
  );
});

test("orderAction 和 subscriptionAction 缺少可解析 webUrl 时 fail closed", async () => {
  const orderFake = createFakeClient({ orderCreate: success({ acquiringOrderId: "AO_1", orderAction: JSON.stringify({ actionType: "REDIRECT" }) }) });
  const orderGateway = createWaffoGateway(baseOptions(orderFake.client));
  await assert.rejects(() => orderGateway.createOrder(orderInput()), { code: "WAFFO_INVALID_RESPONSE" });

  const subscriptionFake = createFakeClient({ subscriptionCreate: success({ subscriptionId: "SUB_1", subscriptionAction: "not-json" }) });
  const subscriptionGateway = createWaffoGateway(baseOptions(subscriptionFake.client));
  await assert.rejects(() => subscriptionGateway.createSubscription(subscriptionInput()), { code: "WAFFO_INVALID_RESPONSE" });
});

test("不支持币种与非法金额在任何 write 前被拒绝", async () => {
  const fake = createFakeClient();
  const gateway = createWaffoGateway(baseOptions(fake.client));

  await assert.rejects(() => gateway.createOrder(orderInput({ currency: "EUR" })), { code: "WAFFO_UNSUPPORTED_CURRENCY" });
  await assert.rejects(() => gateway.createSubscription(subscriptionInput({ amount: 0 })), { code: "WAFFO_INVALID_AMOUNT" });
  await assert.rejects(() => gateway.refundOrder({
    refundRequestId: "refund-request-1", acquiringOrderId: "AO_1", amount: 1.5, currency: "USD", reason: "requested",
  }), { code: "WAFFO_INVALID_AMOUNT" });
  assert.equal(fake.calls.length, 0);
});

test("unavailable gateway 覆盖全部新 port 且稳定失败", async () => {
  const gateway = createUnavailableWaffoGateway("sandbox credentials missing");
  const methods = ["createOrder", "inquiryOrder", "refundOrder", "createSubscription", "inquirySubscription", "cancelSubscription", "inquiryRefund"];

  for (const method of methods) await assert.rejects(() => gateway[method]({}), { code: "WAFFO_UNAVAILABLE" });
});

test("注入 predicate 与 logger 不会记录 private key 或 SDK 配置", async () => {
  const entries = [];
  const fake = createFakeClient({ orderCreate: success({ acquiringOrderId: "AO_1", orderAction: action(ACTION) }) });
  const gateway = createWaffoGateway({
    ...baseOptions(fake.client),
    privateKey: "private-key-secret",
    logger: { info: (...args) => entries.push(args), warn: (...args) => entries.push(args) },
  });
  await gateway.createOrder(orderInput());

  assert.equal(JSON.stringify(entries).includes("private-key-secret"), false);
});
