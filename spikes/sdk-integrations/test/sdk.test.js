import test from "node:test";
import assert from "node:assert/strict";
import { MockTransport } from "../fixtures/mock-transport.js";
import { WaffoClient } from "../src/waffo-client.js";
import { PaymentService } from "../src/payment-service.js";
import { ExternalServiceError, UnknownStatusError } from "../src/errors.js";
import { handleWebhook, verifySignature } from "../src/webhook.js";
import { createHmac } from "node:crypto";

const logger = { info() {} };
function store() { const rows = new Map(); return { rows, async create(v) { const row = { ...v, id: "local-1", requestId: "req-fixed" }; rows.set(row.id, row); return row; }, async update(id, patch) { rows.set(id, { ...rows.get(id), ...patch }); } }; }

test("业务层创建分钟包订单并保存外部订单号", async () => {
  const service = new PaymentService({ client: new WaffoClient({ transport: new MockTransport(), logger }), orderStore: store(), logger });
  const result = await service.purchaseMinutes({ userId: "u1", minutes: 30, amount: 6 });
  assert.equal(result.localOrderId, "local-1");
  assert.match(result.acquiringOrderId, /^mock-/);
});

test("业务层在调用 Waffo 前拒绝零或负金额", async () => {
  let calls = 0;
  const client = { async createOrder() { calls += 1; } };
  const orderStore = store();
  const service = new PaymentService({ client, orderStore, logger });
  await assert.rejects(() => service.purchaseMinutes({ userId: "u1", minutes: 30, amount: 0 }), RangeError);
  await assert.rejects(() => service.purchaseMinutes({ userId: "u1", minutes: 30, amount: -1 }), RangeError);
  assert.equal(calls, 0);
  assert.equal(orderStore.rows.size, 0);
});

test("WaffoClient 缺少 transport 时稳定失败", async () => {
  assert.throws(() => new WaffoClient(), { code: "WAFFO_NOT_CONFIGURED" });
});

test("未知状态使用同一 requestId inquiry 恢复", async () => {
  const transport = new MockTransport();
  transport.failNext = { unknownStatus: true };
  const client = new WaffoClient({ transport, logger });
  const result = await new PaymentService({ client, orderStore: store(), logger }).purchaseMinutes({ userId: "u1", minutes: 30, amount: 6 });
  assert.equal(result.recovered, true);
  assert.equal(result.status, "FAILED");
});

test("未知状态后的 inquiry 失败会结束 pending 并保留可重试错误", async () => {
  const orderStore = store();
  const client = {
    async createOrder() { throw new UnknownStatusError("状态未知", { requestId: "req-fixed" }); },
    async inquiryOrder() { throw new ExternalServiceError("查询暂时失败", { code: "WAFFO_INQUIRY_FAILED", retryable: true }); },
  };
  const service = new PaymentService({ client, orderStore, logger });
  await assert.rejects(
    () => service.purchaseMinutes({ userId: "u1", minutes: 30, amount: 6 }),
    { code: "WAFFO_INQUIRY_FAILED", retryable: true },
  );
  assert.deepEqual(orderStore.rows.get("local-1"), {
    userId: "u1", minutes: 30, amount: 6, currency: "USD", status: "failed", id: "local-1",
    requestId: "req-fixed", errorCode: "WAFFO_INQUIRY_FAILED",
  });
});

test("Webhook 验签与事件幂等", async () => {
  const body = JSON.stringify({ type: "PAYMENT_NOTIFICATION", data: { status: "PAID" } });
  const signature = createHmac("sha256", "secret").update(body).digest("hex");
  assert.equal(verifySignature(body, signature, "secret"), true);
  const seen = new Set(); let calls = 0;
  const args = { rawBody: body, signature, secret: "secret", eventId: "evt-1", seenEvents: seen, onPayment: async () => { calls += 1; }, logger };
  assert.equal((await handleWebhook(args)).status, 200);
  assert.equal((await handleWebhook(args)).body.duplicate, true);
  assert.equal(calls, 1);
});

test("Webhook 并发同一事件只执行一次", async () => {
  const body = JSON.stringify({ type: "PAYMENT_NOTIFICATION", data: { status: "PAID" } });
  const signature = createHmac("sha256", "secret").update(body).digest("hex");
  const seen = new Set(); let calls = 0; let release;
  const entered = new Promise((resolve) => { release = resolve; });
  const args = {
    rawBody: body, signature, secret: "secret", eventId: "evt-concurrent", seenEvents: seen, logger,
    onPayment: async () => { calls += 1; release(); await new Promise((resolve) => setTimeout(resolve, 5)); },
  };
  const first = handleWebhook(args);
  await entered;
  const second = await handleWebhook(args);
  assert.equal(second.body.duplicate, true);
  await first;
  assert.equal(calls, 1);
});

test("Webhook 非法 JSON 返回 400 且不冒泡", async () => {
  const rawBody = "{bad-json";
  const signature = createHmac("sha256", "secret").update(rawBody).digest("hex");
  const result = await handleWebhook({ rawBody, signature, secret: "secret", eventId: "evt-invalid", seenEvents: new Set(), onPayment: async () => {}, logger });
  assert.deepEqual(result, { status: 400, body: { code: "INVALID_PAYLOAD" } });
});

test("Webhook JSON 结构无效返回 400", async () => {
  const rawBody = "null";
  const signature = createHmac("sha256", "secret").update(rawBody).digest("hex");
  const result = await handleWebhook({ rawBody, signature, secret: "secret", eventId: "evt-null", seenEvents: new Set(), onPayment: async () => {}, logger });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "INVALID_PAYLOAD");
});

test("Webhook 回调失败不会提前记账，后续可重试", async () => {
  const body = JSON.stringify({ type: "PAYMENT_NOTIFICATION", data: { status: "PAID" } });
  const signature = createHmac("sha256", "secret").update(body).digest("hex");
  const seen = new Set(); let calls = 0;
  const args = { rawBody: body, signature, secret: "secret", eventId: "evt-retry", seenEvents: seen, onPayment: async () => { calls += 1; if (calls === 1) throw new Error("temporary"); }, logger };
  await assert.rejects(() => handleWebhook(args), /temporary/);
  assert.equal(seen.has("evt-retry"), false);
  assert.equal((await handleWebhook(args)).status, 200);
  assert.equal(calls, 2);
});

test("Webhook 验签失败时业务 sink 不执行", async () => {
  let calls = 0;
  const result = await handleWebhook({
    rawBody: JSON.stringify({ type: "PAYMENT_NOTIFICATION", data: {} }), signature: "bad", secret: "secret",
    eventId: "evt-bad-signature", seenEvents: new Set(), onPayment: async () => { calls += 1; }, logger,
  });
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
});

test("日志不包含 Waffo transport 配置密钥", async () => {
  const entries = [];
  const client = new WaffoClient({ transport: new MockTransport(), logger: { info: (...args) => entries.push(args) } });
  await client.createOrder({ requestId: "req-safe", amount: 6, currency: "USD" });
  assert.equal(entries.some((entry) => JSON.stringify(entry).includes("secret-key")), false);
});

test("未知订阅策略明确阻断，不静默选择", async () => {
  const service = new PaymentService({ client: {}, orderStore: {}, logger });
  await assert.rejects(() => service.subscriptionPreview(), { code: "WAFFO_DECISION_REQUIRED" });
});
