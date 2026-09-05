import assert from "node:assert/strict";
import test from "node:test";

import { logEvent } from "../src/logger.js";
import { requestOpenAiTranscription } from "../src/provider.js";
import { SupabaseAudioStorage } from "../src/storage/supabase.js";
import { dispatchWorkflow } from "../src/workflow-dispatch.js";

test("Cloudflare 明确的已有实例冲突可以确认 Queue 消息", async () => {
  const workflow = { async create() { throw Object.assign(new Error("Workflow instance ana_1 already exists"), { status: 409 }); } };
  assert.equal(await dispatchWorkflow(workflow, { analysisId: "ana_1", attempt: 1 }), "existing");
});

test("无关 409 不能被误判为已有 Workflow 实例", async () => {
  const workflow = { async create() { throw Object.assign(new Error("analysis state conflict"), { status: 409 }); } };
  await assert.rejects(() => dispatchWorkflow(workflow, { analysisId: "ana_1", attempt: 1 }), /analysis state conflict/);
});

test("STT 请求传递稳定幂等键并映射可重试 Provider 故障", async () => {
  const calls = [];
  await assert.rejects(() => requestOpenAiTranscription({ OPENAI_API_KEY: "sk-test-secret" },
    analysis("ana_1", 3), audioStream([new Uint8Array([1, 2, 3])]),
    async (_url, init) => { calls.push(init); await consume(init.body); return new Response("provider body must not be logged", { status: 503 }); }),
  { code: "STT_UNAVAILABLE", retryable: true });
  assert.equal(new Headers(calls[0].headers).get("idempotency-key"), "speechoptimizer-stt-ana_1");
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test("STT Abort timeout 映射为稳定可重试错误", async () => {
  await assert.rejects(() => requestOpenAiTranscription({ OPENAI_API_KEY: "sk-test-secret" },
    analysis("ana_1", 3), audioStream([new Uint8Array([1, 2, 3])]),
    async () => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), 1),
  { code: "STT_TIMEOUT", retryable: true });
});

test("STT multipart 逐块透传对象流且显式携带已知长度", async () => {
  const first = new Uint8Array([0x1a, 0x45]);
  const second = new Uint8Array([0xdf, 0xa3]);
  let sourcePulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      sourcePulls += 1;
      if (sourcePulls === 1) controller.enqueue(first);
      else if (sourcePulls === 2) controller.enqueue(second);
      else controller.close();
    },
  }, { highWaterMark: 0 });
  const result = await requestOpenAiTranscription({ OPENAI_API_KEY: "sk-test-secret" }, analysis("ana_2", 4),
    { stream, size: 4 }, async (_url, init) => {
      const reader = init.body.getReader();
      const prefix = await reader.read();
      assert.match(new TextDecoder().decode(prefix.value), /name="file"/);
      const firstAudioChunk = await reader.read();
      assert.strictEqual(firstAudioChunk.value, first);
      assert.equal(sourcePulls, 1);
      const secondAudioChunk = await reader.read();
      assert.strictEqual(secondAudioChunk.value, second);
      while (!(await reader.read()).done) { /* 消费末尾 boundary，确保 provider 等待流完成。 */ }
      assert.ok(Number(new Headers(init.headers).get("content-length")) > 4);
      return Response.json({ text: "streamed" });
    });
  assert.deepEqual(result, { text: "streamed" });
});

test("STT 会拒绝对象流长度与确认大小不一致", async () => {
  await assert.rejects(() => requestOpenAiTranscription({ OPENAI_API_KEY: "sk-test-secret" }, analysis("ana_3", 3),
    audioStream([new Uint8Array([1, 2]), new Uint8Array([3, 4])]), async (_url, init) => {
      await consume(init.body);
      return Response.json({ text: "unexpected" });
    }), { code: "AUDIO_SIZE_MISMATCH", retryable: false });
});

test("日志会删除 Provider 响应正文和凭证字段", () => {
  const originalWarn = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(line);
  try {
    logEvent("warn", "provider.test", { responseBody: "token=secret-value", apiKey: "sk-secret", status: 503 });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("secret-value"), false);
  assert.equal(lines[0].includes("sk-secret"), false);
  assert.match(lines[0], /\[REDACTED\]/);
});

test("Supabase 错误日志不读取或输出响应正文", async () => {
  const originalWarn = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(line);
  try {
    const storage = new SupabaseAudioStorage({ SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_STORAGE_BUCKET: "speechoptimizer-preview-audio", SUPABASE_SECRET_KEY: "sb_secret_test" },
    async () => new Response('{"token":"provider-secret","name":"sensitive-object"}', { status: 500 }));
    await assert.rejects(() => storage.getObjectBytes("audio/account-u/a/file.webm"), { code: "STORAGE_PROVIDER_ERROR" });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("provider-secret"), false);
  assert.equal(lines[0].includes("sensitive-object"), false);
  assert.equal(lines[0].includes("audio/account-u"), false);
});

test("Supabase 对象流直通 Response.body，不调用完整 arrayBuffer", async () => {
  const source = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
  const response = new Response(source, { headers: { "content-length": "3" } });
  response.arrayBuffer = () => { throw new Error("完整缓冲不应被调用"); };
  const storage = new SupabaseAudioStorage({ SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_STORAGE_BUCKET: "speechoptimizer-preview-audio", SUPABASE_SECRET_KEY: "sb_secret_test" }, async () => response);
  const object = await storage.getObjectStream("audio/account-u/a/file.webm", 3);
  assert.equal(object.size, 3);
  assert.deepEqual(await readChunks(object.stream), [1, 2, 3]);
});

function analysis(id, size) { return { id, audio: { mime: "audio/webm", size } }; }

function audioStream(chunks) {
  return { size: chunks.reduce((total, chunk) => total + chunk.byteLength, 0), stream: new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  }) };
}

async function consume(stream) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) { /* 测试刻意不收集 chunk，验证消费不依赖聚合缓冲。 */ }
}

async function readChunks(stream) {
  const bytes = [];
  const reader = stream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return bytes;
    bytes.push(...chunk.value);
  }
}
