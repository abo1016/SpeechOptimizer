import { SpeechEngineError, isAbortError } from "./errors.js";
import { runWithTimeout } from "./timeout.js";
import { validateTranscript } from "./validation.js";

// 本地夹具默认立即返回；真实转写默认最多等待 30 秒，由业务层按供应商 SLA 覆盖。
const DEFAULT_FIXTURE_DELAY_MS = 0;
const DEFAULT_STT_TIMEOUT_MS = 30_000;

export function createFixtureSttProvider(fixture, options = {}) {
  const name = options.name ?? "fixture-stt";
  const delayMs = options.delayMs ?? DEFAULT_FIXTURE_DELAY_MS;
  return {
    name,
    async transcribe(_input, { signal }) {
      await waitForFixture(delayMs, signal);
      // 深拷贝阻止调用方修改共享 fixture，保证重复测试得到相同输入。
      return structuredClone({ ...fixture, provider: name });
    },
  };
}

async function waitForFixture(delayMs, signal) {
  if (signal.aborted) throw signal.reason;
  if (delayMs <= 0) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export async function runTranscription(provider, input, options = {}) {
  assertProvider(provider);
  const timeoutMs = options.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS;
  try {
    const transcript = await runWithTimeout(
      (signal) => provider.transcribe(input, { signal }),
      timeoutMs,
      "STT timeout",
    );
    return validateTranscript(transcript);
  } catch (error) {
    if (isAbortError(error)) {
      throw new SpeechEngineError("STT_TIMEOUT", "语音转写超时", { retryable: true, cause: error });
    }
    if (error instanceof SpeechEngineError) throw error;
    throw new SpeechEngineError("STT_FAILED", "语音转写失败", { retryable: true, cause: error });
  }
}

function assertProvider(provider) {
  if (!provider || typeof provider.name !== "string" || typeof provider.transcribe !== "function") {
    throw new SpeechEngineError("INVALID_STT_PROVIDER", "STT provider 必须提供 name 和 transcribe");
  }
}

/**
 * 创建真实 STT 的服务端适配边界。调用方负责从服务端环境读取凭证，适配器不会读取或记录密钥。
 */
export function createServerSttAdapter({ name, request }) {
  if (typeof request !== "function") {
    throw new SpeechEngineError("INVALID_STT_PROVIDER", "真实 STT 适配器需要 request 函数");
  }
  return { name, transcribe: (input, context) => request(input, context) };
}
