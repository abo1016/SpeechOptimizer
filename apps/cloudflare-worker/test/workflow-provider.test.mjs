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

test("STT 默认使用官方 endpoint 与 whisper-1，API key 只进入 Bearer", async () => {
  const apiKey = "sk-test-default-secret";
  const calls = [];
  const result = await requestOpenAiTranscription({ OPENAI_API_KEY: apiKey }, analysis("ana_default", 3),
    audioStream([new Uint8Array([1, 2, 3])]), async (url, init) => {
      const body = await readBodyText(init.body);
      calls.push({ url, init, body });
      return Response.json({ text: "default" });
  });

  assert.deepEqual(result, { text: "default" });
  assert.equal(calls[0].url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${apiKey}`);
  assert.match(headers.get("content-type"), /^multipart\/form-data; boundary=/);
  for (const [name, value] of headers) {
    if (name !== "authorization") assert.equal(value.includes(apiKey), false, `${name} 不应携带 API key`);
  }
  assert.match(calls[0].body, /name="model"\r\n\r\nwhisper-1\r\n/);
  assert.equal(calls[0].url.includes(apiKey), false);
  assert.equal(calls[0].body.includes(apiKey), false);
});

test("STT relay 使用显式完整 endpoint 与 model，并保留 multipart 字段契约", async () => {
  const apiKey = "sk-test-relay-secret";
  const relayUrl = "https://stt-relay.example.test/openai/v1/audio/transcriptions";
  const model = "relay-transcribe-model";
  const calls = [];
  await requestOpenAiTranscription({ OPENAI_API_KEY: apiKey, OPENAI_STT_URL: relayUrl, OPENAI_STT_MODEL: model },
    analysis("ana_relay", 4), audioStream([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]), async (url, init) => {
      calls.push({ url, init, body: await readBodyText(init.body) });
      return Response.json({ text: "relay" });
    });

  assert.equal(calls[0].url, relayUrl);
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${apiKey}`);
  assert.match(headers.get("content-type"), /^multipart\/form-data; boundary=/);
  assert.match(calls[0].body, new RegExp(`name="model"\\r\\n\\r\\n${model}\\r\\n`));
  assert.match(calls[0].body, /name="response_format"\r\n\r\nverbose_json\r\n/);
  assert.match(calls[0].body, /name="timestamp_granularities\[\]"\r\n\r\nword\r\n/);
  assert.equal(calls[0].url.includes(apiKey), false);
  assert.equal(calls[0].body.includes(apiKey), false);
});

test("STT 非法 endpoint 在 fetch 前失败且不调用外部服务", async () => {
  const invalidUrls = [
    "",
    "   ",
    "http://stt-relay.example.test/v1/audio/transcriptions",
    "https://",
    "https://user:password@stt-relay.example.test/v1/audio/transcriptions",
    "https://stt-relay.example.test/v1/audio/transcriptions?api_key=secret",
    "https://stt-relay.example.test/v1/audio/transcriptions#fragment",
  ];
  for (const url of invalidUrls) {
    let fetchCalls = 0;
    await assert.rejects(() => requestOpenAiTranscription({ OPENAI_API_KEY: "sk-test-secret", OPENAI_STT_URL: url },
      analysis("ana_invalid_url", 3), audioStream([new Uint8Array([1, 2, 3])]), async () => {
        fetchCalls += 1;
        return Response.json({ text: "unexpected" });
      }), (error) => {
        assert.equal(error.code, "STT_CONFIG_INVALID");
        assert.equal(error.retryable, false);
        return true;
      });
    assert.equal(fetchCalls, 0, `非法 URL ${JSON.stringify(url)} 不应触发 fetch`);
  }
});

test("STT 非法 model 在 fetch 前失败且不调用外部服务", async () => {
  const invalidModels = ["", "   ", "relay\nmodel", "relay\u0000model", "m".repeat(10_000)];
  for (const model of invalidModels) {
    let fetchCalls = 0;
    await assert.rejects(() => requestOpenAiTranscription({ OPENAI_API_KEY: "sk-test-secret", OPENAI_STT_MODEL: model },
      analysis("ana_invalid_model", 3), audioStream([new Uint8Array([1, 2, 3])]), async () => {
        fetchCalls += 1;
        return Response.json({ text: "unexpected" });
      }), (error) => {
        assert.equal(error.code, "STT_CONFIG_INVALID");
        assert.equal(error.retryable, false);
        return true;
      });
    assert.equal(fetchCalls, 0, `非法 model ${JSON.stringify(model)} 不应触发 fetch`);
  }
});

test("STT 缺少 API key 在 fetch 前失败且不泄露或调用外部服务", async () => {
  let fetchCalls = 0;
  await assert.rejects(() => requestOpenAiTranscription({ OPENAI_STT_URL: "https://stt-relay.example.test/v1/audio/transcriptions" },
    analysis("ana_missing_key", 3), audioStream([new Uint8Array([1, 2, 3])]), async () => {
      fetchCalls += 1;
      return Response.json({ text: "unexpected" });
    }), (error) => {
      assert.equal(error.code, "STT_NOT_CONFIGURED");
      assert.equal(error.retryable, false);
      assert.equal(error.message.includes("undefined"), false);
      return true;
    });
  assert.equal(fetchCalls, 0);
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

async function readBodyText(stream) { return new Response(stream).text(); }

async function readChunks(stream) {
  const bytes = [];
  const reader = stream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return bytes;
    bytes.push(...chunk.value);
  }
}
