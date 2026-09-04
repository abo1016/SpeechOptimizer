import { performance } from "node:perf_hooks";
import { assertConfig, ProviderError } from "./errors.js";
import { createFetchTransport, mapHttpFailure } from "./http-transport.js";
import { withRequestTimeout } from "./request-timeout.js";
import { withRetry } from "./retry.js";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * OpenAI 文件转写适配器。whisper-1 是官方当前支持逐词时间戳的模型。
 */
export function createOpenAiSttProvider(options = {}) {
  const config = createConfig(options);
  return {
    name: "openai-whisper-1",
    transcribe: (input, context = {}) => transcribe(input, context, config),
  };
}

function createConfig(options) {
  return Object.freeze({
    // apiKey：只用于 Authorization 请求头，禁止写入任何日志字段。
    apiKey: assertConfig(options.apiKey ?? process.env.OPENAI_API_KEY, "OPENAI_NOT_CONFIGURED", "缺少 OPENAI_API_KEY"),
    // endpoint：默认使用 OpenAI 官方音频转写端点，测试可替换为无网络 transport。
    endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
    // transport：测试注入点；生产默认使用 Node.js 全局 fetch。
    transport: options.transport ?? createFetchTransport(),
    // pricePerMinuteUsd：由部署方按当前价格显式注入；未配置时成本元数据为 0。
    pricePerMinuteUsd: options.pricePerMinuteUsd ?? 0,
    // missingConfidence：官方逐词结果不提供置信度，默认保守标记为 0。
    missingConfidence: options.missingConfidence ?? 0,
    // requestTimeoutMs：限制每次 OpenAI 转写请求，重试会为新请求重新计时。
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelaysMs: options.retryDelaysMs,
    logger: options.logger ?? console,
  });
}

async function transcribe(input, context, config) {
  const audio = normalizeAudio(input);
  const startedAt = performance.now();
  const response = await withRetry(
    () => withRequestTimeout(
      (signal) => send(audio, signal, config),
      { signal: context.signal, timeoutMs: config.requestTimeoutMs, code: "OPENAI_STT_TIMEOUT", message: "OpenAI 转写请求超时" },
    ),
    { signal: context.signal, delaysMs: config.retryDelaysMs, logger: config.logger, operation: "openai.stt" },
  );
  const transcript = normalizeTranscript(response.body, config);
  config.logger.info?.("[openai] 转写完成", { provider: "whisper-1", wordCount: transcript.words.length });
  return { ...transcript, processingDurationMs: Math.round(performance.now() - startedAt) };
}

async function send(audio, signal, config) {
  const form = new FormData();
  form.set("file", new Blob([audio.bytes], { type: audio.mime }), audio.filename);
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  let response;
  try {
    response = await config.transport.request({ url: config.endpoint, headers: { Authorization: `Bearer ${config.apiKey}` }, body: form, signal });
  } catch (cause) {
    throw new ProviderError("OPENAI_STT_REQUEST_FAILED", "OpenAI 转写网络异常", { retryable: true, cause });
  }
  if (response.status < 200 || response.status >= 300) mapHttpFailure(response, "OPENAI_STT");
  return response;
}

function normalizeAudio(input) {
  const source = Buffer.isBuffer(input) ? { bytes: input } : input;
  if (!Buffer.isBuffer(source?.bytes) && !(source?.bytes instanceof Uint8Array)) {
    throw new ProviderError("INVALID_AUDIO_INPUT", "OpenAI 转写需要 bytes");
  }
  return { bytes: source.bytes, mime: source.mime ?? "audio/wav", filename: source.filename ?? "speech.wav" };
}

function normalizeTranscript(body, config) {
  if (!body || !Array.isArray(body.words) || !Number.isFinite(body.duration)) {
    throw new ProviderError("OPENAI_STT_INVALID_RESPONSE", "OpenAI 转写响应缺少逐词时间戳", { retryable: false });
  }
  const words = body.words.map((word) => normalizeWord(word, body.segments, config.missingConfidence));
  return {
    language: normalizeLanguage(body.language), durationSeconds: body.duration, words,
    provider: "openai-whisper-1", estimatedCostUsd: roundCost(body.duration, config.pricePerMinuteUsd),
  };
}

function normalizeWord(word, segments, fallback) {
  if (typeof word.word !== "string" || !Number.isFinite(word.start) || !Number.isFinite(word.end)) {
    throw new ProviderError("OPENAI_STT_INVALID_RESPONSE", "OpenAI 逐词时间戳结构无效");
  }
  return { text: word.word.trim(), startSeconds: word.start, endSeconds: word.end, confidence: segmentConfidence(word, segments, fallback) };
}

function segmentConfidence(word, segments, fallback) {
  const segment = segments?.find((item) => word.start >= item.start && word.end <= item.end);
  if (!Number.isFinite(segment?.avg_logprob)) return fallback;
  return Math.max(0, Math.min(1, Math.exp(segment.avg_logprob)));
}

function normalizeLanguage(language) {
  return String(language ?? "en").toLowerCase().startsWith("en") ? "en-US" : String(language);
}

function roundCost(durationSeconds, pricePerMinuteUsd) {
  return Math.round((durationSeconds / 60) * pricePerMinuteUsd * 1e6) / 1e6;
}
