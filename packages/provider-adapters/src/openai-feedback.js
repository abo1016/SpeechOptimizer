import { performance } from "node:perf_hooks";
import { assertConfig, ProviderError } from "./errors.js";
import { createFetchTransport, mapHttpFailure } from "./http-transport.js";
import { withRequestTimeout } from "./request-timeout.js";
import { withRetry } from "./retry.js";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 10_000;
const FEEDBACK_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    items: {
      type: "array", maxItems: 3,
      items: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["high", "medium", "low"] },
          issue: { type: "string" }, evidence: { type: "string" }, revision: { type: "string" }, rerecordPrompt: { type: "string" },
        },
        required: ["priority", "issue", "evidence", "revision", "rerecordPrompt"], additionalProperties: false,
      },
    },
  },
  required: ["items"], additionalProperties: false,
});

/** 创建 OpenAI Responses API 严格结构化反馈 provider。 */
export function createOpenAiFeedbackProvider(options = {}) {
  const config = createConfig(options);
  return { name: `openai-${config.model}`, generate: (input, context = {}) => generate(input, context, config) };
}

function createConfig(options) {
  return Object.freeze({
    // apiKey：仅服务端读取，不得记录或返回给调用方。
    apiKey: assertConfig(options.apiKey ?? process.env.OPENAI_API_KEY, "OPENAI_NOT_CONFIGURED", "缺少 OPENAI_API_KEY"),
    // model：默认值可通过环境覆盖，部署前应结合当前官方模型清单确认。
    model: options.model ?? process.env.OPENAI_FEEDBACK_MODEL ?? "gpt-4o-mini",
    // token 单价：由部署配置提供，避免把易变价格硬编码进业务包。
    inputCostPerMillion: options.inputCostPerMillion ?? 0,
    outputCostPerMillion: options.outputCostPerMillion ?? 0,
    endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
    transport: options.transport ?? createFetchTransport(),
    // requestTimeoutMs：限制每次 Responses API 请求，避免占用任务 worker。
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelaysMs: options.retryDelaysMs,
    logger: options.logger ?? console,
  });
}

async function generate(input, context, config) {
  const startedAt = performance.now();
  const body = buildRequest(input, config.model);
  const response = await withRetry(
    () => withRequestTimeout(
      (signal) => send(body, signal, config),
      { signal: context.signal, timeoutMs: config.requestTimeoutMs, code: "OPENAI_FEEDBACK_TIMEOUT", message: "OpenAI 反馈请求超时" },
    ),
    { signal: context.signal, delaysMs: config.retryDelaysMs, logger: config.logger, operation: "openai.feedback" },
  );
  const items = parseItems(response.body);
  const usage = response.body.usage ?? {};
  config.logger.info?.("[openai] 结构化反馈完成", { model: config.model, itemCount: items.length });
  return { items, estimatedCostUsd: estimateCost(usage, config), processingDurationMs: Math.round(performance.now() - startedAt) };
}

function buildRequest(input, model) {
  return {
    model,
    instructions: "Return at most three actionable English speaking-coach suggestions. Use only supplied transcript and measured metrics. Never infer health, personality, emotion, or protected traits.",
    input: JSON.stringify({ transcript: input.transcript, metrics: input.metrics }),
    text: { format: { type: "json_schema", name: "speech_feedback", strict: true, schema: FEEDBACK_SCHEMA } },
  };
}

async function send(body, signal, config) {
  let response;
  try {
    response = await config.transport.request({
      url: config.endpoint, headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
  } catch (cause) {
    throw new ProviderError("OPENAI_FEEDBACK_REQUEST_FAILED", "OpenAI 反馈网络异常", { retryable: true, cause });
  }
  if (response.status < 200 || response.status >= 300) mapHttpFailure(response, "OPENAI_FEEDBACK");
  return response;
}

function parseItems(body) {
  const text = body?.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new ProviderError("OPENAI_FEEDBACK_INVALID_RESPONSE", "OpenAI 反馈响应缺少 output_text");
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.items)) throw new Error("items missing");
    return parsed.items;
  } catch (cause) {
    throw new ProviderError("OPENAI_FEEDBACK_INVALID_RESPONSE", "OpenAI 反馈 JSON 无效", { cause });
  }
}

function estimateCost(usage, config) {
  const inputCost = (usage.input_tokens ?? 0) * config.inputCostPerMillion / 1e6;
  const outputCost = (usage.output_tokens ?? 0) * config.outputCostPerMillion / 1e6;
  return Math.round((inputCost + outputCost) * 1e6) / 1e6;
}

export { FEEDBACK_SCHEMA };
