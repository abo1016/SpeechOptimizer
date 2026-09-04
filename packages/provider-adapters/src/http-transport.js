import { ProviderError } from "./errors.js";

/**
 * 使用全局 fetch 创建最薄网络边界。测试应注入假 transport，不调用此实现。
 */
export function createFetchTransport(fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== "function") throw new TypeError("fetch transport 需要 fetch 函数");
  return {
    async request({ url, method = "POST", headers, body, signal }) {
      const response = await fetchFn(url, { method, headers, body, signal });
      const raw = await response.text();
      return { status: response.status, headers: response.headers, body: parseBody(raw) };
    },
  };
}

export function mapHttpFailure(response, service) {
  const status = response?.status ?? 0;
  const retryable = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
  const suffix = status ? `HTTP ${status}` : "网络异常";
  throw new ProviderError(`${service}_REQUEST_FAILED`, `${service} 请求失败：${suffix}`, { status, retryable });
}

function parseBody(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
