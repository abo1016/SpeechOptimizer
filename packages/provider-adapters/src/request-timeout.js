import { ProviderError } from "./errors.js";

/**
 * 限制单次外部请求时长。父 signal 中止优先原样传播，便于业务层识别主动取消。
 */
export async function withRequestTimeout(operation, options) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Request timed out", "AbortError"));
  }, options.timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), abortPromise(controller.signal)]);
  } catch (cause) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (timedOut) throw new ProviderError(options.code, options.message, { retryable: true, cause });
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function abortPromise(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
