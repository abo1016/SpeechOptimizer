import test from "node:test";
import assert from "node:assert/strict";
import { createUnavailableWaffoGateway, createWaffoGateway } from "../src/index.js";

test("Waffo gateway 使用官方 checkout.createSession 参数并映射领域返回", async () => {
  let input;
  const client = { checkout: { async createSession(value) { input = value; return { sessionId: "cs_1", checkoutUrl: "https://checkout.example" }; } } };
  const gateway = createWaffoGateway({ client, productIds: { minutes_30: "PROD_1" }, successUrl: "https://app.example/success", logger: { info() {} } });
  const result = await gateway.createOrder({ requestId: "order-1", productCode: "minutes_30", amount: 600, currency: "USD" });
  assert.equal(input.productId, "PROD_1");
  assert.equal(input.productType, "onetime");
  assert.equal(input.priceSnapshot.amount, "6.00");
  assert.deepEqual(result, { externalOrderId: "cs_1", checkoutUrl: "https://checkout.example" });
});

test("Waffo 订阅取消调用官方 orders.cancelSubscription", async () => {
  let input;
  const client = {
    checkout: { createSession() {} },
    orders: { async cancelSubscription(value) { input = value; return { orderId: value.orderId, status: "canceling" }; } },
  };
  const gateway = createWaffoGateway({ client, logger: { info() {} } });
  await gateway.cancelSubscription({ externalSubscriptionId: "ORD_1", requestId: "cancel-1" });
  assert.deepEqual(input, { orderId: "ORD_1" });
});

test("Waffo 退款契约字段不足时明确阻断", async () => {
  const gateway = createWaffoGateway({ client: { checkout: { createSession() {} } } });
  await assert.rejects(() => gateway.refundOrder({ externalOrderId: "ORD_1", reason: "requested" }), { code: "WAFFO_REFUND_CONTRACT_UNAVAILABLE" });
});

test("Waffo unavailable gateway 的所有操作稳定失败", async () => {
  const gateway = createUnavailableWaffoGateway("sandbox credentials missing");
  await assert.rejects(() => gateway.createOrder({}), { code: "WAFFO_UNAVAILABLE" });
  await assert.rejects(() => gateway.cancelSubscription({}), { code: "WAFFO_UNAVAILABLE" });
});

test("Waffo SDK 限流错误映射为可重试 ProviderError", async () => {
  const error = Object.assign(new Error("rate limited"), { status: 429 });
  const client = { checkout: { async createSession() { throw error; } } };
  const gateway = createWaffoGateway({ client, productIds: { minutes_30: "PROD_1" } });
  await assert.rejects(
    () => gateway.createOrder({ requestId: "order-1", productCode: "minutes_30", amount: 600, currency: "USD" }),
    { code: "WAFFO_REQUEST_FAILED", retryable: true },
  );
});
