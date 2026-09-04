import { logEvent } from "../lib/logEvent.js";

const API_PREFIX = "/api/v1";

/** API 错误保留服务端稳定 code，界面据此提供可恢复操作。 */
export class ApiError extends Error {
  constructor(code, message, status = 0, details) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createApiClient(options = {}) {
  // 开发环境沿用当前页面主机名，避免 localhost 与 127.0.0.1 混用导致 Cookie 被浏览器隔离。
  const defaultBaseUrl = import.meta.env?.DEV ? developmentBaseUrl() : "";
  const baseUrl = trimSlash(options.baseUrl ?? import.meta.env?.VITE_API_BASE_URL ?? defaultBaseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(path, init = {}) {
    const startedAt = performance.now();
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: buildHeaders(init),
    }).catch((error) => {
      // 主动离页、取消任务会中止轮询；该状态不能被误报为可重试的网络故障。
      if (init.signal?.aborted || error?.name === "AbortError") throw error;
      throw new ApiError("NETWORK_ERROR", error.message || "Cannot reach the service.");
    });
    const payload = await readPayload(response);
    logEvent("api.request_finished", {
      method: init.method ?? "GET",
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    if (!response.ok) throw toApiError(response.status, payload);
    return payload?.data;
  }

  return {
    get: (path, init) => request(path, init),
    delete: (path, init) => request(path, { ...init, method: "DELETE" }),
    post: (path, body, init) => request(path, jsonInit("POST", body, init)),
    put: (path, body, init) => request(path, jsonInit("PUT", body, init)),
    upload: (path, body, init = {}) => request(path, {
      ...init,
      method: "PUT",
      body,
      headers: { ...init.headers, "content-type": "application/octet-stream" },
    }),
  };
}

function jsonInit(method, body, init = {}) {
  return {
    ...init,
    method,
    body: JSON.stringify(body ?? {}),
    headers: { ...init.headers, "content-type": "application/json" },
  };
}

function buildHeaders(init) {
  return { accept: "application/json", ...init.headers };
}

async function readPayload(response) {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  return response.json().catch(() => null);
}

function toApiError(status, payload) {
  const error = payload?.error;
  return new ApiError(
    error?.code ?? "HTTP_ERROR",
    error?.message ?? `Request failed with status ${status}.`,
    status,
    error?.details,
  );
}

function developmentBaseUrl() {
  if (typeof window === "undefined") return "http://localhost:8787";
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

function trimSlash(value) {
  return String(value).replace(/\/$/, "");
}

export const api = createApiClient();
export { API_PREFIX };
