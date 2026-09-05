import assert from "node:assert/strict";
import test from "node:test";

import { completeAudioUpload, createAnalysis, deleteAccount, requestAudioUpload, retryAnalysis, retryAnalysisAsAdmin } from "../src/analysis.js";
import { recoverUploadedDispatches, shouldDelete } from "../src/cleanup.js";
import { assertFreeTierAdmission, validateTrustedDuration } from "../src/config.js";
import { buildReport } from "../src/report.js";
import { decodeAnalysisCursor, encodeAnalysisCursor } from "../src/pagination.js";
import { assertAudioDeclaration, audioObjectKey } from "../src/storage/common.js";
import { SupabaseAudioStorage } from "../src/storage/supabase.js";
import { dispatchWorkflow } from "../src/workflow-dispatch.js";
import { consumeAnalysisQueue } from "../src/queue-consumer.js";

test("Storage 上传声明只接受 10 MiB 内 WebM/Opus", () => {
  const checksum = "a".repeat(64);
  assert.deepEqual(assertAudioDeclaration({ size: 1024, mime: "audio/webm", sha256: checksum }, { maxAudioBytes: 10 * 1024 * 1024 }),
    { size: 1024, mime: "audio/webm", sha256: checksum });
  assert.throws(() => assertAudioDeclaration({ size: 1024, mime: "audio/mp4", sha256: checksum }, { maxAudioBytes: 10 * 1024 * 1024 }),
    { code: "UNSUPPORTED_MEDIA_TYPE" });
  assert.throws(() => assertAudioDeclaration({ size: 11 * 1024 * 1024, mime: "audio/webm", sha256: checksum }, { maxAudioBytes: 10 * 1024 * 1024 }),
    { code: "AUDIO_TOO_LARGE" });
  assert.throws(() => assertAudioDeclaration({ size: 1024, mime: "audio/webm", sha256: "bad" }, { maxAudioBytes: 10 * 1024 * 1024 }),
    { code: "INVALID_AUDIO_CHECKSUM" });
});

test("Storage 对象 key 固定包含 owner 与 analysisId", () => {
  const key = audioObjectKey({ type: "account", id: "usr_123" }, "ana_456");
  assert.match(key, /^audio\/account-usr_123\/ana_456\/[0-9a-f-]+\.webm$/);
  assert.equal(key.includes(".."), false);
});

test("匿名创建分析必须先提供 Turnstile token", async () => {
  const request = new Request("https://example.test/api/v1/analyses", { method: "POST",
    headers: { "idempotency-key": "anonymous-test-key" } });
  const repository = { async findIdempotentAnalysis() { return null; }, async incrementQuota() {} };
  await assert.rejects(() => createAnalysis(request, { retainAudio: false }, { type: "anonymous", id: "anon_1" },
    { APP_ENV: "preview" }, repository), { code: "TURNSTILE_REQUIRED" });
});

test("匿名幂等重放在 Turnstile 和 IP 限流之前返回已提交任务", async () => {
  const request = new Request("https://example.test/api/v1/analyses", { method: "POST",
    headers: { "idempotency-key": "anonymous-replay-key" } });
  const analysis = { id: "ana_existing", owner: { type: "anonymous", id: "anon_1" }, status: "created", attempt: 0 };
  const repository = {
    async findIdempotentAnalysis() { return { analysis, duplicate: true }; },
    async incrementQuota() { throw new Error("IP 限流不应在重放时执行"); },
  };
  const result = await createAnalysis(request, { retainAudio: false }, analysis.owner, { APP_ENV: "preview" }, repository);
  assert.deepEqual(result, { analysis, duplicate: true });
});

test("分析列表游标保留 created_at 与 id，避免同秒数据跨页遗漏", () => {
  const cursor = encodeAnalysisCursor({ createdAt: "2026-09-05T00:00:00.000Z", id: "ana_150" });
  assert.deepEqual(decodeAnalysisCursor(cursor), { createdAt: "2026-09-05T00:00:00.000Z", id: "ana_150" });
  assert.throws(() => decodeAnalysisCursor("not-a-valid-cursor"), { code: "INVALID_CURSOR" });
});

test("重复 Queue 消息遇到已有 Workflow 实例时确认成功", async () => {
  const payload = { analysisId: "ana_1", attempt: 1 };
  const workflow = { async create() { throw Object.assign(new Error("Workflow instance ana_1 already exists"), { status: 409 }); } };
  assert.equal(await dispatchWorkflow(workflow, payload), "existing");
});

test("Supabase signed upload URL 只授权单对象且不暴露 server secret", async () => {
  const env = {
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_STORAGE_BUCKET: "speechoptimizer-preview-audio",
    SUPABASE_SECRET_KEY: "sb_secret_super-secret-value",
  };
  const checksum = "b".repeat(64);
  const calls = [];
  const storage = new SupabaseAudioStorage(env, async (url, init) => {
    calls.push({ url, init });
    return Response.json({ url: "/object/upload/sign/speechoptimizer-preview-audio/audio/account-u/a/file.webm?token=signed-token" });
  });
  const result = await storage.createUploadUrl("audio/account-u/a/file.webm", "audio/webm", checksum);
  const url = new URL(result.uploadUrl);
  assert.equal(url.pathname, "/storage/v1/object/upload/sign/speechoptimizer-preview-audio/audio/account-u/a/file.webm");
  assert.equal(url.searchParams.get("token"), "signed-token");
  assert.equal(result.expiresInSeconds, 7200);
  assert.equal(result.uploadUrl.includes(env.SUPABASE_SECRET_KEY), false);
  assert.deepEqual(JSON.parse(Buffer.from(result.headers["x-metadata"], "base64").toString()), { sha256: checksum });
  assert.equal(new Headers(calls[0].init.headers).get("apikey"), env.SUPABASE_SECRET_KEY);
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), null);
});

test("同一 analysis 的并发重复 audio-upload 复用唯一对象 key", async () => {
  const owner = { type: "account", id: "usr_1" };
  const checksum = "e".repeat(64);
  let ticket;
  const signPaths = [];
  const repository = {
    async getOwnedAnalysis() { return { id: "ana_1", owner, status: "created" }; },
    async prepareUploadTicket(_analysisId, _owner, requested) {
      // 模拟两个 HTTP 请求同时看到空 ticket 后，由 D1 条件更新裁决唯一赢家。
      await Promise.resolve();
      if (!ticket) ticket = { ...requested };
      assert.equal(ticket.size, requested.size);
      assert.equal(ticket.mime, requested.mime);
      assert.equal(ticket.sha256, requested.sha256);
      return { objectKey: ticket.objectKey, reused: ticket.objectKey !== requested.objectKey };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    signPaths.push(new URL(url).pathname);
    return Response.json({ url: "/object/upload/sign/bucket/signed.webm?token=one" });
  };
  try {
    const input = { size: 123, mime: "audio/webm", sha256: checksum };
    const env = { APP_ENV: "preview", SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_STORAGE_BUCKET: "bucket", SUPABASE_SECRET_KEY: "sb_secret_test" };
    const [first, second] = await Promise.all([
      requestAudioUpload(input, owner, "ana_1", env, repository),
      requestAudioUpload(input, owner, "ana_1", env, repository),
    ]);
    assert.equal(first.objectKey, second.objectKey);
    assert.equal(signPaths.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Supabase 完成确认只读取对象信息和 4 字节 Range", async () => {
  const checksum = "d".repeat(64);
  const calls = [];
  const storage = new SupabaseAudioStorage({ SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_STORAGE_BUCKET: "speechoptimizer-preview-audio", SUPABASE_SERVICE_ROLE_KEY: "legacy-service-jwt" },
  async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/object/info/")) return Response.json({ size: 123, mimetype: "audio/webm", etag: "etag-1",
      user_metadata: { sha256: checksum } });
    return new Response(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), { status: 206,
      headers: { "content-range": "bytes 0-3/123" } });
  });
  const result = await storage.verifyUploadedObject("audio/account-u/a/file.webm",
    { expectedSize: 123, maxBytes: 1024, mime: "audio/webm", sha256: checksum });
  assert.deepEqual(result, { size: 123, etag: "etag-1", mime: "audio/webm" });
  assert.equal(new Headers(calls[1].init.headers).get("range"), "bytes=0-3");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer legacy-service-jwt");
});

test("Supabase 对象读删和递归枚举使用私有 Storage API", async () => {
  const calls = [];
  const storage = new SupabaseAudioStorage({ SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_STORAGE_BUCKET: "speechoptimizer-preview-audio", SUPABASE_SECRET_KEY: "sb_secret_test" },
  async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === "DELETE") return Response.json([]);
    if (url.includes("/object/list/")) {
      const body = JSON.parse(init.body);
      if (body.prefix === "audio") return Response.json([{ id: null, name: "account-u" }]);
      if (body.prefix === "audio/account-u") return Response.json([{ id: null, name: "ana-1" }]);
      return Response.json([{ id: "obj-1", name: "speech.webm", created_at: "2026-09-05T00:00:00.000Z",
        metadata: { size: 321 } }]);
    }
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.deepEqual(new Uint8Array(await storage.getObjectBytes("audio/account-u/ana-1/speech.webm")), new Uint8Array([1, 2, 3]));
  await storage.deleteObject("audio/account-u/ana-1/speech.webm");
  assert.deepEqual(await storage.listObjects("audio/"), [{ key: "audio/account-u/ana-1/speech.webm", size: 321,
    uploaded: "2026-09-05T00:00:00.000Z" }]);
  const deleteCall = calls.find((call) => call.init.method === "DELETE");
  assert.deepEqual(JSON.parse(deleteCall.init.body), { prefixes: ["audio/account-u/ana-1/speech.webm"] });
});

test("Workflow 报告保持现有前端 metrics/feedback 契约", () => {
  const result = buildReport({ text: "hello um world", duration: 4,
    words: [{ word: "hello", start: 0, end: 0.5 }, { word: "um", start: 1, end: 1.2 },
      { word: "world", start: 3.8, end: 4 }] });
  assert.equal(result.report.version, "speech-engine/v1");
  assert.equal(result.report.metrics.wordCount, 3);
  assert.equal(result.report.metrics.fillers.total, 1);
  assert.ok(Array.isArray(result.report.feedback));
});

test("账户删除分页清理失败后保持禁用并可重试完成超过 100 条分析", async () => {
  const createdAt = "2026-09-05T00:00:00.000Z";
  const analyses = Array.from({ length: 150 }, (_, index) => ({
    id: `ana_${String(index).padStart(3, "0")}`,
    createdAt,
    audio: { objectKey: `audio/account-usr_123/ana_${index}/speech.webm`, size: 100 },
  }));
  const deletedObjects = [];
  const account = { status: "active", deletionRequestedAt: null };
  let accountDeleted = false;
  let failedObjectOnce = true;
  const repository = {
    // 这个 mock 按 D1 Repository 的复合游标语义返回固定大小页面，避免测试继续依赖旧的数字偏移游标。
    async listOwned(_owner, { cursor }) {
      const sorted = [...analyses].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const cursorRow = cursor ? decodeAnalysisCursor(cursor) : null;
      const start = cursorRow ? sorted.findIndex((analysis) => analysis.id === cursorRow.id) + 1 : 0;
      const items = sorted.slice(start, start + 100);
      const last = items.at(-1);
      return { items, nextCursor: start + items.length < sorted.length ? encodeAnalysisCursor(last) : null };
    },
    async beginAccountDeletion({ userId, email }) {
      assert.equal(userId, "usr_123");
      assert.equal(email, "person@example.com");
      // 两阶段删除的第一步只撤销账户能力，保留分析事实让对象清理失败时可以从断点重试。
      account.status = "disabled";
      account.deletionRequestedAt = createdAt;
      return { sessions: 1, magicLinks: 2 };
    },
    async clearAudioKey(analysisId) {
      const analysis = analyses.find((item) => item.id === analysisId);
      assert.ok(analysis, `missing analysis ${analysisId}`);
      analysis.audio = null;
    },
    async getPendingUploadObjectKey() { return null; },
    async clearUploadTicket() {},
    async releaseStorage() {},
    async finalizeAccountDeletion(userId) {
      assert.equal(userId, "usr_123");
      assert.equal(account.status, "disabled");
      assert.ok(account.deletionRequestedAt);
      const pendingAudio = analyses.some((analysis) => analysis.audio?.objectKey);
      if (pendingAudio) throw Object.assign(new Error("audio cleanup is incomplete"), { code: "ACCOUNT_DELETION_PENDING_STORAGE" });
      accountDeleted = true;
      account.status = "deleted";
      return { analyses: analyses.length };
    },
  };
  const env = { APP_ENV: "local", AUDIO_BUCKET: { async delete(key) {
    // 在第二页中途模拟 Provider 故障，确认请求失败不会让账户回到 active。
    if (key.endsWith("ana_29/speech.webm") && failedObjectOnce) {
      failedObjectOnce = false;
      throw new Error("temporary storage outage");
    }
    deletedObjects.push(key);
  } } };
  const identity = { actor: { type: "account", id: "usr_123" }, user: { id: "usr_123", email: "person@example.com" } };

  await assert.rejects(() => deleteAccount(identity, env, repository), /temporary storage outage/);

  assert.equal(accountDeleted, false);
  assert.equal(account.status, "disabled");
  assert.equal(account.deletionRequestedAt, createdAt);
  assert.equal(deletedObjects.length, 120);

  const result = await deleteAccount(identity, env, repository);

  assert.equal(result.analysesDeleted, 150);
  assert.equal(deletedObjects.length, 150);
  assert.equal(new Set(deletedObjects).size, 150);
  assert.equal(accountDeleted, true);
  assert.equal(account.status, "deleted");
});

test("存储生命周期会清理孤儿、失败超时和到期保留对象", () => {
  const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(shouldDelete({ uploaded: fresh }, null), true);
  assert.equal(shouldDelete({ uploaded: fresh }, { status: "cancelled" }), true);
  assert.equal(shouldDelete({ uploaded: old }, { status: "failed" }), true);
  assert.equal(shouldDelete({ uploaded: fresh }, { status: "failed" }), false);
  assert.equal(shouldDelete({ uploaded: fresh }, { status: "completed", owner: { type: "anonymous" }, retainAudio: false }), true);
  assert.equal(shouldDelete({ uploaded: old }, { status: "completed", owner: { type: "account" }, retainAudio: true }), true);
});

test("Workflow 仅接受可信且不超过五分钟的 STT 时长", () => {
  const env = { MAX_AUDIO_DURATION_MS: "300000" };
  assert.deepEqual(validateTrustedDuration(env, { duration: 299.5 }), { durationMs: 299500 });
  assert.throws(() => validateTrustedDuration(env, { duration: 301 }), { code: "AUDIO_TOO_LONG" });
  assert.throws(() => validateTrustedDuration(env, { duration: 0 }), { code: "AUDIO_DURATION_UNKNOWN" });
  assert.deepEqual(validateTrustedDuration(env, { duration: 60 }, "anonymous"), { durationMs: 60000 });
  assert.throws(() => validateTrustedDuration(env, { duration: 60.1 }, "anonymous"), { code: "AUDIO_TOO_LONG" });
});

test("80/90/95 免费额度护栏按阶段关闭匿名、新分析和上传", () => {
  const anonymous = { type: "anonymous", id: "anon_1" };
  const account = { type: "account", id: "usr_1" };
  assert.doesNotThrow(() => assertFreeTierAdmission({ FREE_TIER_GUARD_LEVEL: "0" }, anonymous));
  assert.throws(() => assertFreeTierAdmission({ FREE_TIER_GUARD_LEVEL: "80" }, anonymous), { code: "FREE_TIER_ANONYMOUS_PAUSED" });
  assert.doesNotThrow(() => assertFreeTierAdmission({ FREE_TIER_GUARD_LEVEL: "80" }, account));
  assert.throws(() => assertFreeTierAdmission({ FREE_TIER_GUARD_LEVEL: "90" }, account), { code: "FREE_TIER_NEW_ANALYSES_PAUSED" });
  assert.throws(() => assertFreeTierAdmission({ FREE_TIER_GUARD_LEVEL: "95" }, account, "upload"), { code: "FREE_TIER_UPLOADS_PAUSED" });
});

test("重复 audio-complete 只允许与已确认对象完全一致", async () => {
  const owner = { type: "account", id: "usr_1" };
  const current = {
    id: "ana_1", owner, status: "uploaded", attempt: 0,
    audio: { objectKey: "audio/account-usr_1/ana_1/file.webm", size: 123, mime: "audio/webm", sha256: "c".repeat(64) },
  };
  const repository = { async getOwnedAnalysis() { return current; } };
  const input = { objectKey: current.audio.objectKey, size: 123, mime: "audio/webm", sha256: current.audio.sha256 };
  const env = { ANALYSIS_QUEUE: { async send() {} } };
  assert.equal(await completeAudioUpload(input, owner, current.id, env, repository), current);
  await assert.rejects(() => completeAudioUpload({ ...input, objectKey: "audio/account-usr_1/ana_1/other.webm" }, owner, current.id, env, repository),
    { code: "UPLOAD_COMPLETION_CONFLICT" });
});

test("D1 已确认 uploaded 而 Queue.send 失败时，重复 audio-complete 会补投", async () => {
  const owner = { type: "account", id: "usr_1" };
  const checksum = "f".repeat(64);
  const input = { objectKey: "audio/account-usr_1/ana_2/file.webm", size: 123, mime: "audio/webm", sha256: checksum };
  let current = { id: "ana_2", owner, status: "created", attempt: 0, audio: null };
  let sends = 0;
  const repository = {
    async getOwnedAnalysis() { return current; },
    async getUploadTicket() { return { objectKey: input.objectKey, size: input.size, mime: input.mime, sha256: input.sha256 }; },
    async confirmStorageUpload(_analysisId, _owner, patch) {
      current = { ...current, status: "uploaded", audio: { objectKey: patch.audio_key, size: patch.audio_size,
        mime: patch.audio_mime, sha256: patch.audio_sha256 } };
      return current;
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/object/info/")) {
      return Response.json({ size: 123, mimetype: "audio/webm", etag: "etag-1", user_metadata: { sha256: checksum } });
    }
    return new Response(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), { status: 206 });
  };
  const env = { APP_ENV: "preview", SUPABASE_URL: "https://project-ref.supabase.co", SUPABASE_STORAGE_BUCKET: "bucket",
    SUPABASE_SECRET_KEY: "sb_secret_test", ANALYSIS_QUEUE: { async send() {
      sends += 1;
      if (sends === 1) throw new Error("queue temporarily unavailable");
    } } };
  try {
    await assert.rejects(() => completeAudioUpload(input, owner, current.id, env, repository), /queue temporarily unavailable/);
    assert.equal(current.status, "uploaded");
    assert.equal(await completeAudioUpload(input, owner, current.id, env, repository), current);
    assert.equal(sends, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploaded 状态的 retry 与 Cron 恢复都可以安全补投 Queue", async () => {
  const owner = { type: "account", id: "usr_1" };
  const analysis = { id: "ana_3", owner, status: "uploaded", attempt: 1, audio: { objectKey: "audio/a", size: 1 } };
  const sent = [];
  const env = { ANALYSIS_QUEUE: { async send(payload) { sent.push(payload); } } };
  const repository = { async getOwnedAnalysis() { return analysis; } };
  assert.equal(await retryAnalysis(owner, analysis.id, env, repository), analysis);
  const recovered = await recoverUploadedDispatches(env, { async listUploadedForDispatch() { return [analysis]; } });
  assert.deepEqual(recovered, { pending: 1, queued: 1 });
  assert.deepEqual(sent, [
    { analysisId: "ana_3", attempt: 2, version: 1 },
    { analysisId: "ana_3", attempt: 2, version: 1 },
  ]);
});

test("Queue 最后一次可用 delivery 失败时先写入失败事实，再让引用进入 DLQ", async () => {
  let current = { id: "ana_dlq", owner: { type: "account", id: "usr_dlq" }, status: "uploaded", attempt: 0,
    audio: { objectKey: "audio/account-usr_dlq/ana_dlq/speech.webm", size: 1 }, error: null };
  const transitions = [];
  const repository = {
    async getAnalysis() { return current; },
    async transition(id, from, target, patch, eventType) {
      transitions.push({ id, from, target, patch, eventType });
      current = { ...current, status: target, attempt: patch.attempt,
        error: { code: patch.error_code, retryable: Boolean(patch.error_retryable), stage: patch.failure_stage, at: patch.failed_at } };
      return current;
    },
  };
  const calls = { ack: 0, retry: 0 };
  const payload = { analysisId: current.id, attempt: 1, version: 1 };
  const message = { body: payload, attempts: 3, ack() { calls.ack += 1; }, retry() { calls.retry += 1; } };
  const env = { ANALYSIS_WORKFLOW: { async create() { throw Object.assign(new Error("workflow service unavailable"), { code: "WORKFLOW_UNAVAILABLE" }); } } };

  await consumeAnalysisQueue({ messages: [message] }, env, repository);

  assert.equal(calls.ack, 0);
  assert.equal(calls.retry, 1);
  assert.deepEqual(message.body, payload);
  assert.equal(current.status, "failed");
  assert.equal(current.attempt, 1);
  assert.deepEqual(current.error.code, "QUEUE_DISPATCH_FAILED");
  assert.equal(current.error.stage, "queue_dispatch");
  assert.equal(transitions[0].eventType, "analysis.queue_dispatch_failed");
});

test("管理员重试复用失败状态机并只投递下一个 Workflow attempt", async () => {
  let current = { id: "ana_admin_retry", owner: { type: "account", id: "usr_target" }, status: "failed", attempt: 1,
    audio: { objectKey: "audio/account-usr_target/ana_admin_retry/speech.webm", size: 1 },
    error: { code: "QUEUE_DISPATCH_FAILED", retryable: true, stage: "queue_dispatch" } };
  const sent = [];
  const repository = {
    async getAnalysis() { return current; },
    async transition(id, from, target, patch, eventType) {
      assert.equal(id, current.id);
      assert.deepEqual(from, ["failed"]);
      assert.equal(target, "uploaded");
      assert.equal(eventType, "analysis.admin_retry_requested");
      current = { ...current, status: target, error: null, cleared: patch };
      return current;
    },
  };
  const result = await retryAnalysisAsAdmin({ id: "usr_admin" }, current.id,
    { ANALYSIS_QUEUE: { async send(payload) { sent.push(payload); } } }, repository);

  assert.equal(result.status, "uploaded");
  assert.deepEqual(result.cleared, { error_code: null, error_retryable: null, failure_stage: null, failed_at: null });
  assert.deepEqual(sent, [{ analysisId: current.id, attempt: 2, version: 1 }]);
});

test("管理员重试拒绝不可重试和已耗尽任务", async () => {
  const nonRetryable = { id: "ana_non_retryable", status: "failed", attempt: 1,
    audio: { objectKey: "audio/a", size: 1 }, error: { code: "AUDIO_TOO_LONG", retryable: false } };
  const exhausted = { id: "ana_exhausted", status: "failed", attempt: 3,
    audio: { objectKey: "audio/b", size: 1 }, error: { code: "QUEUE_DISPATCH_FAILED", retryable: true } };
  const repository = { async getAnalysis(id) { return id === nonRetryable.id ? nonRetryable : exhausted; } };
  const env = { ANALYSIS_QUEUE: { async send() { throw new Error("不应投递"); } } };

  await assert.rejects(() => retryAnalysisAsAdmin({ id: "usr_admin" }, nonRetryable.id, env, repository), { code: "ANALYSIS_NOT_RETRYABLE" });
  await assert.rejects(() => retryAnalysisAsAdmin({ id: "usr_admin" }, exhausted.id, env, repository), { code: "ANALYSIS_RETRY_EXHAUSTED" });
});
