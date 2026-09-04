import { ProviderError } from "./errors.js";

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([0, 250, 750]);

/**
 * 对可重试错误执行有限重试；signal 中止后立即停止，避免后台继续产生费用。
 */
export async function withRetry(operation, options = {}) {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    await wait(delays[attempt], options.signal);
    try {
      return await operation(attempt + 1);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === delays.length - 1) throw error;
      options.logger?.warn?.("[provider] 外部请求准备重试", { operation: options.operation, attempt: attempt + 1, code: error.code });
    }
  }
  throw lastError;
}

function isRetryable(error) {
  return error instanceof ProviderError && error.retryable;
}

function wait(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
