import test from "node:test";
import assert from "node:assert/strict";
import { openAiFeedbackFixture } from "../fixtures/openai-feedback.js";
import { openAiTranscriptionFixture } from "../fixtures/openai-transcription.js";
import { createOpenAiFeedbackProvider, createOpenAiSttProvider } from "../src/index.js";

const silentLogger = { info() {}, warn() {} };

test("OpenAI STT 使用 whisper-1 逐词时间戳并映射成本", async () => {
  const requests = [];
  const transport = { async request(request) { requests.push(request); return { status: 200, body: openAiTranscriptionFixture }; } };
  const provider = createOpenAiSttProvider({ apiKey: "test-secret", transport, pricePerMinuteUsd: 0.006, logger: silentLogger });
  const result = await provider.transcribe({ bytes: Buffer.from("audio"), mime: "audio/webm", filename: "clip.webm" });
  assert.equal(requests[0].body.get("model"), "whisper-1");
  assert.equal(requests[0].body.get("response_format"), "verbose_json");
  assert.equal(requests[0].body.get("timestamp_granularities[]"), "word");
  assert.equal(result.language, "en-US");
  assert.equal(result.words.length, 2);
  assert.ok(result.words[0].confidence > 0.9);
  assert.equal(result.estimatedCostUsd, 0.00025);
});

test("OpenAI STT 对 429 做有限重试", async () => {
  let calls = 0;
  const transport = { async request() { calls += 1; return calls === 1 ? { status: 429, body: {} } : { status: 200, body: openAiTranscriptionFixture }; } };
  const provider = createOpenAiSttProvider({ apiKey: "test", transport, retryDelaysMs: [0, 0], logger: silentLogger });
  await provider.transcribe({ bytes: Buffer.from("audio") });
  assert.equal(calls, 2);
});

test("OpenAI 反馈请求启用严格 JSON Schema 并统计 token 成本", async () => {
  let requestBody;
  const transport = { async request(request) { requestBody = JSON.parse(request.body); return { status: 200, body: openAiFeedbackFixture }; } };
  const provider = createOpenAiFeedbackProvider({
    apiKey: "test", transport, inputCostPerMillion: 2, outputCostPerMillion: 4, logger: silentLogger,
  });
  const result = await provider.generate({ transcript: { words: [] }, metrics: { wordsPerMinute: 100 } });
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.estimatedCostUsd, 0.0004);
});

test("OpenAI 反馈缺少 output_text 时返回稳定错误", async () => {
  const transport = { async request() { return { status: 200, body: { output: [] } }; } };
  const provider = createOpenAiFeedbackProvider({ apiKey: "test", transport, logger: silentLogger });
  await assert.rejects(() => provider.generate({ transcript: {}, metrics: {} }), { code: "OPENAI_FEEDBACK_INVALID_RESPONSE" });
});

test("OpenAI STT 单次请求超时返回可重试稳定错误", async () => {
  const transport = { async request() { return new Promise(() => {}); } };
  const provider = createOpenAiSttProvider({
    apiKey: "test", transport, requestTimeoutMs: 5, retryDelaysMs: [0], logger: silentLogger,
  });
  await assert.rejects(
    () => provider.transcribe({ bytes: Buffer.from("audio") }),
    { code: "OPENAI_STT_TIMEOUT", retryable: true },
  );
});

test("OpenAI 反馈单次请求超时返回可重试稳定错误", async () => {
  const transport = { async request() { return new Promise(() => {}); } };
  const provider = createOpenAiFeedbackProvider({
    apiKey: "test", transport, requestTimeoutMs: 5, retryDelaysMs: [0], logger: silentLogger,
  });
  await assert.rejects(
    () => provider.generate({ transcript: {}, metrics: {} }),
    { code: "OPENAI_FEEDBACK_TIMEOUT", retryable: true },
  );
});
