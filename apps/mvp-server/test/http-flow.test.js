import assert from "node:assert/strict";
import test from "node:test";
import { createRuntime } from "../src/index.js";
import { signWebhook } from "../src/routes-billing.js";
import { api, startFixture, waitForStatus, wav } from "./helpers.js";

test("匿名用户可完成幂等创建、上传、异步报告、历史、比较与删除", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await api(fixture, "/api/v1/anonymous/session", { method: "POST" });
  const cookie = session.cookie;
  const created = await api(fixture, "/api/v1/analyses", { method: "POST", cookie,
    headers: { "idempotency-key": "anonymous-flow-0001" }, body: {} });
  const id = created.payload.data.analysis.id;
  const duplicate = await api(fixture, "/api/v1/analyses", { method: "POST", cookie,
    headers: { "idempotency-key": "anonymous-flow-0001" }, body: {} });
  assert.equal(duplicate.payload.data.duplicate, true);
  assert.equal((await api(fixture, `/api/v1/analyses/${id}/audio`, { method: "PUT", cookie,
    headers: { "content-type": "application/octet-stream" }, body: wav() })).status, 202);
  await waitForStatus(fixture, cookie, id, "completed");
  const report = await api(fixture, `/api/v1/analyses/${id}/report`, { cookie });
  assert.equal(report.payload.data.report.version, "speech-engine/v1");
  const compared = await api(fixture, "/api/v1/comparisons", { method: "POST", cookie,
    body: { beforeAnalysisId: id, afterAnalysisId: id } });
  assert.equal(compared.status, 200);
  assert.equal((await api(fixture, "/api/v1/analyses", { cookie })).payload.data.items.length, 1);
  assert.equal((await api(fixture, `/api/v1/analyses/${id}`, { method: "DELETE", cookie })).status, 200);
  const second = await api(fixture, "/api/v1/analyses", { method: "POST", cookie,
    headers: { "idempotency-key": "anonymous-flow-0002" }, body: {} });
  const secondId = second.payload.data.analysis.id;
  const exhausted = await api(fixture, `/api/v1/analyses/${secondId}/audio`, { method: "PUT", cookie,
    headers: { "content-type": "application/octet-stream" }, body: wav() });
  assert.equal(exhausted.payload.error.code, "ANONYMOUS_TRIAL_USED");
  assert.equal((await api(fixture, `/api/v1/analyses/${secondId}`, { cookie })).payload.data.status, "cancelled");
});

test("127.0.0.1 本地前端来源通过 CORS 预检和健康请求", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const preflight = await fetch(`${fixture.baseUrl}/api/v1/analyses`, {
    method: "OPTIONS", headers: { origin: "http://127.0.0.1:5173", "access-control-request-method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  const health = await fetch(`${fixture.baseUrl}/health`, { headers: { origin: "http://127.0.0.1:5173" } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
});

test("localhost 本地前端来源与 127.0.0.1 共享 CORS 契约，演示处理路由返回状态", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const preflight = await fetch(`${fixture.baseUrl}/analysis/demo-processing`, {
    method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "GET" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const demo = await fetch(`${fixture.baseUrl}/analysis/demo-processing`, {
    headers: { origin: "http://localhost:5173" },
  });
  const payload = await demo.json();
  assert.equal(demo.status, 200);
  assert.equal(demo.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(payload.data.status, "analyzing");
  assert.deepEqual(payload.data.steps, ["uploaded", "transcribing", "analyzing"]);
});

test("失效账户 Cookie 不会阻塞匿名会话初始化", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const response = await api(fixture, "/api/v1/anonymous/session", {
    method: "POST",
    cookie: "so_session=stale-session-token",
  });
  assert.equal(response.status, 201);
  assert.equal(response.payload.data.identity.type, "anonymous");
  assert.match(response.cookie, /so_session=;.*Max-Age=0/);
});

test("账户身份隔离、免费权益、订单和验签 Webhook 均由服务端约束", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const requested = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email: "owner@example.com", redirectUri: "http://localhost:5173/auth" } });
  const loggedIn = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: requested.payload.data.previewToken } });
  const cookie = loggedIn.cookie;
  assert.equal((await api(fixture, "/api/v1/billing/balance", { cookie })).payload.data.minutes, 5);
  const order = await api(fixture, "/api/v1/billing/orders", { method: "POST", cookie,
    body: { productCode: "minutes_30", amount: 1 } });
  assert.equal(order.payload.data.amount, 600);
  const rejected = await api(fixture, "/api/v1/webhooks/waffo", { method: "POST", body: { id: "evt" } });
  assert.equal(rejected.payload.error.code, "INVALID_SIGNATURE");
  const event = JSON.stringify({ id: "evt-paid", type: "order.paid", version: 1,
    occurredAt: Date.now(), data: { orderId: order.payload.data.id } });
  const signature = signWebhook(event, fixture.config.webhookSecret);
  const paid = await api(fixture, "/api/v1/webhooks/waffo", { method: "POST", body: event,
    headers: { "x-waffo-signature": signature, "content-type": "application/json" } });
  assert.equal(paid.payload.data.processed, true);
  assert.equal((await api(fixture, "/api/v1/billing/balance", { cookie })).payload.data.minutes, 35);
  const stranger = await api(fixture, "/api/v1/anonymous/session", { method: "POST" });
  const created = await api(fixture, "/api/v1/analyses", { method: "POST", cookie,
    headers: { "idempotency-key": "account-flow-0001" }, body: {} });
  const forbidden = await api(fixture, `/api/v1/analyses/${created.payload.data.analysis.id}`, { cookie: stranger.cookie });
  assert.equal(forbidden.status, 403);
  const userId = loggedIn.payload.data.user.id;
  fixture.store.users.get(userId).role = "admin";
  const returned = await api(fixture, `/api/v1/admin/users/${userId}/return-minutes`, {
    method: "POST", cookie, body: { minutes: 2, reason: "test_gate" } });
  assert.equal(returned.status, 200);
  assert.equal((await api(fixture, `/api/v1/admin/users/${userId}`, { cookie })).status, 200);
  const secondRequest = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email: "second@example.com", redirectUri: "http://localhost:5173/auth" } });
  const secondLogin = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: secondRequest.payload.data.previewToken } });
  assert.equal((await api(fixture, "/api/v1/billing/balance", { cookie: secondLogin.cookie })).payload.data.minutes, 5);
  const observation = await api(fixture, "/api/v1/admin/observability", { cookie });
  assert.equal(observation.status, 200);
  assert.equal(observation.payload.data.webhooks[0].status, "processed");
});

test("失败任务可重试，处理中任务可取消并保持终态", async (t) => {
  let calls = 0;
  const sttProvider = { name: "retry-provider", async transcribe() {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("temporary"), { retryable: true });
    return fixtureTranscript();
  } };
  const fixture = await startFixture({ sttProvider });
  t.after(() => fixture.close());
  const session = await api(fixture, "/api/v1/anonymous/session", { method: "POST" });
  const created = await api(fixture, "/api/v1/analyses", { method: "POST", cookie: session.cookie,
    headers: { "idempotency-key": "retry-flow-0001" }, body: {} });
  const id = created.payload.data.analysis.id;
  await api(fixture, `/api/v1/analyses/${id}/audio`, { method: "PUT", cookie: session.cookie,
    headers: { "content-type": "application/octet-stream" }, body: wav() });
  await waitForStatus(fixture, session.cookie, id, "failed");
  await waitForRunnerIdle(fixture.application, id);
  assert.equal((await api(fixture, `/api/v1/analyses/${id}/retry`, { method: "POST", cookie: session.cookie })).status, 202);
  await waitForStatus(fixture, session.cookie, id, "completed");
});

test("管理员重试会追加管理审计记录", async (t) => {
  let calls = 0;
  const sttProvider = { name: "admin-retry-provider", async transcribe() {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("temporary"), { retryable: true });
    return fixtureTranscript();
  } };
  const fixture = await startFixture({ sttProvider });
  t.after(() => fixture.close());
  const requested = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email: "admin-retry@example.com", redirectUri: "http://localhost:5173/auth" } });
  const login = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: requested.payload.data.previewToken } });
  const userId = login.payload.data.user.id;
  fixture.store.users.get(userId).role = "admin";
  const created = await api(fixture, "/api/v1/analyses", { method: "POST", cookie: login.cookie,
    headers: { "idempotency-key": "admin-retry-0001" }, body: { retainAudio: true } });
  const id = created.payload.data.analysis.id;
  await api(fixture, `/api/v1/analyses/${id}/audio`, { method: "PUT", cookie: login.cookie,
    headers: { "content-type": "application/octet-stream" }, body: wav() });
  await waitForStatus(fixture, login.cookie, id, "failed");
  await waitForRunnerIdle(fixture.application, id);
  const retried = await api(fixture, `/api/v1/admin/analyses/${id}/retry`, { method: "POST", cookie: login.cookie });
  assert.equal(retried.status, 202);
  assert.equal(fixture.store.audit.at(-1).action, "analysis.retry");
  await waitForStatus(fixture, login.cookie, id, "completed");
});

test("账户失败重试会按下一核心尝试重新预扣并在完成后确认", async (t) => {
  let calls = 0;
  const sttProvider = { name: "account-retry-provider", async transcribe() {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("temporary"), { retryable: true });
    return fixtureTranscript();
  } };
  const fixture = await startFixture({ sttProvider });
  t.after(() => fixture.close());
  const requested = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email: "account-retry@example.com", redirectUri: "http://localhost:5173/auth" } });
  const login = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: requested.payload.data.previewToken } });
  const id = (await api(fixture, "/api/v1/analyses", { method: "POST", cookie: login.cookie,
    headers: { "idempotency-key": "account-retry-flow-0001" }, body: {} })).payload.data.analysis.id;
  await api(fixture, `/api/v1/analyses/${id}/audio`, { method: "PUT", cookie: login.cookie,
    headers: { "content-type": "application/octet-stream" }, body: wav() });
  await waitForStatus(fixture, login.cookie, id, "failed");
  await waitForRunnerIdle(fixture.application, id);
  assert.equal(fixture.application.entitlements.balance(login.payload.data.user.id), 5);
  assert.equal((await api(fixture, `/api/v1/analyses/${id}/retry`, { method: "POST", cookie: login.cookie })).status, 202);
  await waitForStatus(fixture, login.cookie, id, "completed");
  await waitForRunnerIdle(fixture.application, id);
  const holds = [...fixture.store.holds.values()].filter((hold) => hold.referenceId === id || hold.referenceId.startsWith(`${id}:retry:`));
  const retryHold = holds.find((hold) => hold.referenceId !== id);
  assert.equal(holds.find((hold) => hold.referenceId === id)?.status, "released");
  assert.equal(retryHold?.status, "confirmed");
  assert.equal(retryHold?.referenceId.endsWith(":retry:2:1"), true);
  assert.equal(fixture.application.entitlements.balance(login.payload.data.user.id), 4);
  assert.equal(fixture.store.ledger.filter((row) => row.referenceId === id || row.referenceId === retryHold?.referenceId)
    .filter((row) => row.type === "reserve").length, 2);
});

test("恢复逻辑会把处理中断任务恢复为可重试失败", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const session = await api(fixture, "/api/v1/anonymous/session", { method: "POST" });
  const anonymousId = session.payload.data.identity.id;
  const created = await api(fixture, "/api/v1/analyses", { method: "POST", cookie: session.cookie,
    headers: { "idempotency-key": "recovery-flow-0001" }, body: {} });
  const id = created.payload.data.analysis.id;
  // 直接在核心持久化仓储模拟进程中断，组合层快照只作为恢复索引。
  await fixture.application.core.repository.update(id, (row) => ({ ...row, status: "transcribing" }), "test.interrupted");
  await fixture.store.flush();
  await fixture.application.recoverPendingAnalyses();
  const recovered = fixture.store.analyses.get(id);
  assert.equal(recovered.status, "failed");
  assert.deepEqual(recovered.error, { code: "PROCESS_INTERRUPTED", retryable: true });
  assert.ok((await fixture.application.core.listAudits({ actor: { type: "anonymous", id: anonymousId }, analysisId: id }))
    .some((entry) => entry.action === "analysis.recovered_as_failed"));
});

test("核心库已上传但组合快照未落盘时，启动恢复仍会重新调度任务", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const actor = { type: "anonymous", id: "anonymous-recovery" };
  // 核心服务契约使用 owner 字段；HTTP 组合层才把请求身份命名为 actor。
  // 这里刻意绕过组合层模拟快照未落盘窗口，但仍按核心公共接口传递真实所有者。
  const created = await fixture.application.core.createAnalysis({ owner: actor, idempotencyKey: "core-only-upload-0001" });
  await fixture.application.core.uploadAudio({ actor, analysisId: created.analysis.id, bytes: wav() });
  assert.equal(fixture.store.analyses.has(created.analysis.id), false);
  await fixture.application.recoverPendingAnalyses();
  const restored = fixture.store.analyses.get(created.analysis.id);
  assert.ok(restored);
  // 恢复会立即向异步 runner 投递任务，观察时可能已从 uploaded 进入 transcribing。
  // 两个状态都证明组合索引已重建；最终完成状态才是“重新调度”成功的确定证据。
  assert.ok(["uploaded", "transcribing"].includes(restored.status));
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && fixture.store.analyses.get(created.analysis.id)?.status !== "completed") {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(fixture.store.analyses.get(created.analysis.id)?.status, "completed");
});

test("恢复会重建快照缺失账户任务的预扣且不重复消费", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const requested = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email: "recovery-billing@example.com", redirectUri: "http://localhost:5173/auth" } });
  const login = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: requested.payload.data.previewToken } });
  const actor = { type: "account", id: login.payload.data.user.id };
  // 绕过组合层仅写核心库，进程崩溃后磁盘上会保留同样的“上传成功、快照缺失”状态。
  const analysis = await createCoreUpload(fixture.application, actor, "recovery-billing-upload-0001");
  assert.equal(fixture.store.holds.size, 0);
  assert.equal(fixture.store.analyses.has(analysis.id), false);
  const recovered = await createRuntime({ config: fixture.config, providers: fixture.providers, logger: fixture.logger });
  await recovered.application.recoverPendingAnalyses();
  await waitForCoreStatus(recovered.application, actor, analysis.id, "completed");
  const hold = [...recovered.store.holds.values()].find((row) => row.referenceId === analysis.id);
  assert.equal(hold?.status, "confirmed");
  assert.equal(recovered.application.entitlements.balance(actor.id), 4);
  assert.equal(recovered.store.ledger.filter((row) => row.referenceId === analysis.id && row.type === "reserve").length, 1);
});

test("恢复会补记匿名试用并阻止同一身份再次上传", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const actor = { type: "anonymous", id: "anonymous-crash-recovery" };
  const analysis = await createCoreUpload(fixture.application, actor, "recovery-anonymous-upload-0001");
  const recovered = await createRuntime({ config: fixture.config, providers: fixture.providers, logger: fixture.logger });
  await waitForCoreStatus(recovered.application, actor, analysis.id, "completed");
  assert.equal(recovered.store.anonymousTrials.has(actor.id), true);
  assert.equal(recovered.store.anonymousTrials.size, 1);
  const second = await recovered.application.core.createAnalysis({ owner: actor, idempotencyKey: "recovery-anonymous-upload-0002" });
  await assert.rejects(
    () => recovered.application.uploadAudio(actor, second.analysis.id, wav()),
    { code: "ANONYMOUS_TRIAL_USED" },
  );
  assert.equal((await recovered.application.core.getAnalysis({ actor, analysisId: second.analysis.id })).status, "cancelled");
});

test("恢复不会把旧匿名试用误归属给快照仍为 created 的新任务", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const actor = { type: "anonymous", id: "anonymous-existing-trial" };
  fixture.application.auth.useAnonymousTrial({ anonymousId: actor.id, durationSeconds: 1 });
  await fixture.store.flush();
  const created = await fixture.application.createAnalysis(actor, {}, "recovery-anonymous-existing-0001");
  // 模拟第二次上传刚写入核心库即崩溃；组合快照仍是 created，不能证明旧试用属于该任务。
  await fixture.application.core.uploadAudio({ actor, analysisId: created.analysis.id, bytes: wav() });
  const recovered = await createRuntime({ config: fixture.config, providers: fixture.providers, logger: fixture.logger });
  assert.equal((await recovered.application.core.getAnalysis({ actor, analysisId: created.analysis.id })).status, "cancelled");
  assert.equal(recovered.store.anonymousTrials.size, 1);
});

test("恢复会确认已完成预扣并释放失败任务的遗留预扣", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const requested = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email: "recovery-terminal@example.com", redirectUri: "http://localhost:5173/auth" } });
  const login = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: requested.payload.data.previewToken } });
  const actor = { type: "account", id: login.payload.data.user.id };
  const failed = await createCoreUpload(fixture.application, actor, "recovery-terminal-failed-0001");
  const failedHold = fixture.application.entitlements.reserve({ userId: actor.id, amount: 1, referenceId: failed.id });
  await fixture.store.flush();
  await fixture.application.core.repository.update(failed.id, (row) => ({ ...row, status: "failed" }), "test.failed");
  await fixture.application.recoverPendingAnalyses();
  assert.equal(fixture.store.holds.get(failedHold.id)?.status, "released");
  assert.equal(fixture.application.entitlements.balance(actor.id), 5);
  const completed = await createCoreUpload(fixture.application, actor, "recovery-terminal-completed-0001");
  const completedHold = fixture.application.entitlements.reserve({ userId: actor.id, amount: 1, referenceId: completed.id });
  await fixture.store.flush();
  await fixture.application.core.repository.update(completed.id, (row) => ({ ...row, status: "completed" }), "test.completed");
  await fixture.application.recoverPendingAnalyses();
  assert.equal(fixture.store.holds.get(completedHold.id)?.status, "confirmed");
  assert.equal(fixture.application.entitlements.balance(actor.id), 4);
});

test("处理中取消会删除音频并保持 cancelled 终态", async (t) => {
  const delayed = { name: "delayed-provider", async transcribe() {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { ...fixtureTranscript(), provider: "delayed-provider" };
  } };
  const fixture = await startFixture({ sttProvider: delayed });
  t.after(() => fixture.close());
  const session = await api(fixture, "/api/v1/anonymous/session", { method: "POST" });
  const created = await api(fixture, "/api/v1/analyses", { method: "POST", cookie: session.cookie,
    headers: { "idempotency-key": "cancel-flow-0001" }, body: {} });
  const id = created.payload.data.analysis.id;
  await api(fixture, `/api/v1/analyses/${id}/audio`, { method: "PUT", cookie: session.cookie,
    headers: { "content-type": "application/octet-stream" }, body: wav() });
  const cancelled = await api(fixture, `/api/v1/analyses/${id}/cancel`, { method: "POST", cookie: session.cookie });
  assert.equal(cancelled.payload.data.status, "cancelled");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal((await api(fixture, `/api/v1/analyses/${id}`, { cookie: session.cookie })).payload.data.status, "cancelled");
});

test("隐私偏好生效且账户删除清理身份、任务和计费数据", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const requested = await api(fixture, "/api/v1/auth/magic-link", { method: "POST",
    body: { email: "delete@example.com", redirectUri: "http://localhost:5173/auth" } });
  const login = await api(fixture, "/api/v1/auth/magic-link/consume", { method: "POST",
    body: { token: requested.payload.data.previewToken } });
  const userId = login.payload.data.user.id;
  await api(fixture, "/api/v1/privacy", { method: "PUT", cookie: login.cookie, body: { retainAudio: true } });
  const created = await api(fixture, "/api/v1/analyses", { method: "POST", cookie: login.cookie,
    headers: { "idempotency-key": "delete-flow-0001" }, body: {} });
  assert.equal(created.payload.data.analysis.retainAudio, true);
  const deleted = await api(fixture, "/api/v1/account", { method: "DELETE", cookie: login.cookie });
  assert.equal(deleted.status, 200);
  assert.match(deleted.cookie, /so_session=;.*Max-Age=0/);
  assert.equal(fixture.store.users.has(userId), false);
  assert.equal(fixture.store.analyses.size, 0);
  assert.equal(fixture.store.ledger.some((row) => row.userId === userId), false);
  assert.equal([...fixture.store.magicLinks.values()].some((row) => row.email === "delete@example.com"), false);
  assert.equal([...fixture.store.webhookEvents.values()].some((row) => row.userId === userId), false);
  assert.equal(fixture.store.audit.some((row) => row.actorId === userId || row.targetId === userId), false);
  assert.equal((await api(fixture, "/api/v1/session", { cookie: login.cookie })).status, 401);
});

function fixtureTranscript() {
  return { language: "en-US", durationSeconds: 30, provider: "retry-provider",
    estimatedCostUsd: 0, processingDurationMs: 1,
    words: Array.from({ length: 12 }, (_, index) => ({ text: `word${index}`,
      startSeconds: index, endSeconds: index + 0.5, confidence: 0.95 })) };
}

async function createCoreUpload(application, actor, idempotencyKey) {
  const created = await application.core.createAnalysis({ owner: actor, idempotencyKey });
  await application.core.uploadAudio({ actor, analysisId: created.analysis.id, bytes: wav() });
  return created.analysis;
}

async function waitForCoreStatus(application, actor, analysisId, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const analysis = await application.core.getAnalysis({ actor, analysisId });
    if (analysis.status === expected) return analysis;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待核心状态 ${expected} 超时`);
}

async function waitForRunnerIdle(application, analysisId, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!application.runner.pending.has(analysisId)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待任务 ${analysisId} 结算超时`);
}
