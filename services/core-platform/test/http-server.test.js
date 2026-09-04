import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreError, createCorePlatform, createHttpServer } from "../src/index.js";
import { createSafeLogger } from "../src/logger.js";
import { MockSpeechProcessor } from "../fixtures/mock-speech-processor.js";
import { createWav } from "../fixtures/create-wav.js";

test("HTTP 健康检查、幂等创建、刷新恢复与审计查询形成闭环", async (t) => {
  const env = await start(t);
  assert.deepEqual(await json(`${env.url}/health`), { status: "ok", service: "core-platform" });
  const headers = identityHeaders("account", "account-http-1", { "idempotency-key": "http-request-001" });
  const createdResponse = await fetch(`${env.url}/v1/analyses`, { method: "POST", headers, body: "{}" });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).analysis;
  const duplicateResponse = await fetch(`${env.url}/v1/analyses`, { method: "POST", headers, body: "{}" });
  assert.equal(duplicateResponse.status, 200);
  const uploadResponse = await fetch(`${env.url}/v1/analyses/${created.id}/audio`, {
    method: "PUT", headers: identityHeaders("account", "account-http-1"), body: createWav(30_000),
  });
  assert.equal(uploadResponse.status, 200);
  const runResponse = await fetch(`${env.url}/v1/analyses/${created.id}/run`, {
    method: "POST", headers: identityHeaders("account", "account-http-1"),
  });
  assert.equal(runResponse.status, 202);
  const recovered = await json(`${env.url}/v1/analyses/${created.id}`, identityHeaders("account", "account-http-1"));
  assert.equal(recovered.status, "completed");
  const audits = await json(`${env.url}/v1/analyses/${created.id}/audits`, identityHeaders("account", "account-http-1"));
  assert.deepEqual(audits.map((event) => event.action), [
    "analysis.created", "analysis.uploaded", "analysis.transcribing", "analysis.analyzing", "analysis.completed",
  ]);
});

test("HTTP 身份隔离、非法 JSON 和未知路由返回稳定错误码", async (t) => {
  const env = await start(t);
  const unauthenticated = await fetch(`${env.url}/v1/analyses`, { method: "POST", body: "{}" });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).code, "UNAUTHENTICATED");
  const invalidJson = await fetch(`${env.url}/v1/analyses`, {
    method: "POST", headers: identityHeaders("anonymous", "anon-http-1", { "idempotency-key": "http-invalid-1" }),
    body: "{bad-json",
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, "INVALID_JSON");
  const notFound = await fetch(`${env.url}/does-not-exist`, { headers: identityHeaders("anonymous", "anon-http-1") });
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).code, "ROUTE_NOT_FOUND");
});

async function start(t) {
  const root = await mkdtemp(join(tmpdir(), "speechoptimizer-http-"));
  const logger = createSafeLogger({ info() {}, warn() {}, error() {} });
  const service = createCorePlatform({
    speechProcessor: new MockSpeechProcessor(), logger,
    config: { rootDirectory: root, minDurationMs: 30_000, maxDurationMs: 120_000 },
  });
  const server = createHttpServer({ service, logger, identityResolver });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { service, url: `http://127.0.0.1:${server.address().port}` };
}

function identityResolver(request) {
  const type = request.headers["x-owner-type"];
  const id = request.headers["x-owner-id"];
  if (!type || !id) {
    return Promise.reject(new CoreError("缺少测试身份", { code: "UNAUTHENTICATED", status: 401 }));
  }
  return Promise.resolve({ type, id });
}

function identityHeaders(type, id, extra = {}) {
  return { "x-owner-type": type, "x-owner-id": id, "content-type": "application/json", ...extra };
}

async function json(url, headers) {
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  return response.json();
}
