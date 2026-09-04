import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCorePlatform, CoreError, ServerMediaInspector } from "../src/index.js";
import { createSafeLogger } from "../src/logger.js";
import { MockSpeechProcessor } from "../fixtures/mock-speech-processor.js";
import { createWav } from "../fixtures/create-wav.js";

const ACCOUNT = Object.freeze({ type: "account", id: "account-1" });
const ANONYMOUS = Object.freeze({ type: "anonymous", id: "anon-session-1" });

test("相同创建请求幂等返回原任务，参数变化被拒绝", async (t) => {
  const env = await setup(t);
  const first = await env.service.createAnalysis({ idempotencyKey: "request-001", owner: ACCOUNT });
  const duplicate = await env.service.createAnalysis({ idempotencyKey: "request-001", owner: ACCOUNT });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.analysis.id, first.analysis.id);
  await assert.rejects(
    env.service.createAnalysis({ idempotencyKey: "request-001", owner: ACCOUNT, retainAudio: true }),
    { code: "IDEMPOTENCY_CONFLICT", status: 409 },
  );
  const otherOwner = await env.service.createAnalysis({
    idempotencyKey: "request-001", owner: { type: "account", id: "account-2" },
  });
  assert.equal(otherOwner.duplicate, false);
});

test("服务端按文件内容识别 MIME 并精确校验 WAV 时长", async () => {
  const inspector = new ServerMediaInspector();
  const result = await inspector.inspect(createWav(30_000));
  assert.deepEqual(result, { mime: "audio/wav", extension: "wav", durationMs: 30_000 });
  await assert.rejects(inspector.inspect(Buffer.from("not audio")), { code: "UNSUPPORTED_AUDIO_TYPE" });
});

test("非 WAV 容器通过服务端时长解析端口完成校验", async () => {
  const calls = [];
  const inspector = new ServerMediaInspector({
    durationResolver: async ({ bytes, mime }) => {
      calls.push({ size: bytes.length, mime });
      return 45_000;
    },
  });
  const result = await inspector.inspect(Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]));
  assert.deepEqual(result, { mime: "audio/mpeg", extension: "mp3", durationMs: 45_000 });
  assert.deepEqual(calls, [{ size: 6, mime: "audio/mpeg" }]);
});

test("客户端 MIME 无法绕过大小和时长门禁", async (t) => {
  const env = await setup(t, { maxAudioBytes: 500_000 });
  const analysis = await create(env.service, ACCOUNT, "limits-001");
  await assert.rejects(
    env.service.uploadAudio({ analysisId: analysis.id, actor: ACCOUNT, bytes: createWav(29_999) }),
    { code: "AUDIO_TOO_SHORT" },
  );
  await assert.rejects(
    env.service.uploadAudio({ analysisId: analysis.id, actor: ACCOUNT, bytes: createWav(31_300) }),
    { code: "AUDIO_TOO_LARGE" },
  );
});

test("匿名任务完成完整状态链并默认删除原始音频", async (t) => {
  const env = await setup(t);
  const analysis = await create(env.service, ANONYMOUS, "anonymous-001");
  const uploaded = await upload(env.service, analysis, ANONYMOUS);
  const objectPath = join(env.root, "objects", uploaded.audio.objectKey);
  assert.equal((await readFile(objectPath)).length > 0, true);
  const completed = await env.service.runAnalysis({ analysisId: analysis.id, actor: ANONYMOUS });
  assert.equal(completed.status, "completed");
  assert.equal(completed.attempt, 1);
  assert.equal(completed.audio, null);
  assert.equal(completed.result.report.metrics.wpm, 112);
  await assert.rejects(readFile(objectPath), { code: "ENOENT" });
});

test("注册用户逐次选择保留音频且刷新进程后可恢复", async (t) => {
  const env = await setup(t);
  const created = (await env.service.createAnalysis({
    idempotencyKey: "retention-001", owner: ACCOUNT, retainAudio: true,
  })).analysis;
  const uploaded = await upload(env.service, created, ACCOUNT);
  await env.service.runAnalysis({ analysisId: created.id, actor: ACCOUNT });
  const restarted = createService(env.root, new MockSpeechProcessor());
  const recovered = await restarted.getAnalysis({ analysisId: created.id, actor: ACCOUNT });
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.audio.objectKey, uploaded.audio.objectKey);
  assert.equal((await readFile(join(env.root, "objects", uploaded.audio.objectKey))).length > 0, true);
});

test("失败任务保存安全错误码并可使用原音频重试", async (t) => {
  const processor = new MockSpeechProcessor({ failure: "transcribe" });
  const env = await setup(t, {}, processor);
  const analysis = await create(env.service, ACCOUNT, "retry-001");
  await upload(env.service, analysis, ACCOUNT);
  await assert.rejects(env.service.runAnalysis({ analysisId: analysis.id, actor: ACCOUNT }), /STT/);
  const failed = await env.service.getAnalysis({ analysisId: analysis.id, actor: ACCOUNT });
  assert.deepEqual(failed.error, { code: "STT_TEMPORARY_ERROR", retryable: true });
  processor.failure = null;
  const completed = await env.service.retryAnalysis({ analysisId: analysis.id, actor: ACCOUNT });
  assert.equal(completed.status, "completed");
  assert.equal(completed.attempt, 2);
});

test("处理中取消后任务不会被异步结果复活", async (t) => {
  let release;
  const waitFor = new Promise((resolve) => { release = resolve; });
  const env = await setup(t, {}, new MockSpeechProcessor({ waitFor }));
  const analysis = await create(env.service, ACCOUNT, "cancel-001");
  await upload(env.service, analysis, ACCOUNT);
  const running = env.service.runAnalysis({ analysisId: analysis.id, actor: ACCOUNT });
  await waitForStatus(env.service, analysis.id, ACCOUNT, "transcribing");
  const cancelled = await env.service.cancelAnalysis({ analysisId: analysis.id, actor: ACCOUNT });
  release();
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await running).status, "cancelled");
  assert.equal((await env.service.getAnalysis({ analysisId: analysis.id, actor: ACCOUNT })).status, "cancelled");
});

test("删除单次分析和账户会级联删除对应音频与业务记录", async (t) => {
  const env = await setup(t);
  const first = await retainedUpload(env.service, "delete-one-001");
  const second = await retainedUpload(env.service, "delete-account-001");
  await env.service.deleteAnalysis({ analysisId: first.id, actor: ACCOUNT });
  await assert.rejects(env.service.getAnalysis({ analysisId: first.id, actor: ACCOUNT }), { code: "ANALYSIS_NOT_FOUND" });
  const result = await env.service.deleteAccount({ accountId: ACCOUNT.id, actor: ACCOUNT });
  assert.equal(result.analysesDeleted, 1);
  await assert.rejects(env.service.getAnalysis({ analysisId: second.id, actor: ACCOUNT }), { code: "ANALYSIS_NOT_FOUND" });
  await assert.rejects(readFile(join(env.root, "objects", second.audio.objectKey)), { code: "ENOENT" });
  const database = await readFile(join(env.root, "database.json"), "utf8");
  assert.equal(database.includes(ACCOUNT.id), false);
});

test("安全日志丢弃音频、完整转写和密钥字段", () => {
  const entries = [];
  const logger = createSafeLogger({ info: (line) => entries.push(JSON.parse(line)) });
  logger.info("test.event", {
    analysisId: "analysis-1", transcript: "secret transcript", secret: "api-key", bytes: Buffer.from("audio"),
  });
  assert.deepEqual(entries, [{ event: "test.event", analysisId: "analysis-1" }]);
});

async function setup(t, config = {}, speechProcessor = new MockSpeechProcessor()) {
  const root = await mkdtemp(join(tmpdir(), "speechoptimizer-core-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, service: createService(root, speechProcessor, config) };
}

function createService(root, speechProcessor, config = {}) {
  return createCorePlatform({
    speechProcessor, logger: createSafeLogger({ info() {}, warn() {}, error() {} }),
    config: { rootDirectory: root, minDurationMs: 30_000, maxDurationMs: 120_000, ...config },
  });
}

async function create(service, owner, key) {
  return (await service.createAnalysis({ idempotencyKey: key, owner })).analysis;
}

async function upload(service, analysis, actor) {
  return service.uploadAudio({ analysisId: analysis.id, actor, bytes: createWav(30_000) });
}

async function retainedUpload(service, key) {
  const analysis = (await service.createAnalysis({ idempotencyKey: key, owner: ACCOUNT, retainAudio: true })).analysis;
  return service.uploadAudio({ analysisId: analysis.id, actor: ACCOUNT, bytes: createWav(30_000) });
}

async function waitForStatus(service, analysisId, actor, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await service.getAnalysis({ analysisId, actor })).status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new CoreError(`等待状态超时：${status}`);
}
