import { WorkerError } from "./errors.js";
import { hmacBase64Url, safeEqual } from "./web-crypto.js";

/** JSON 响应保持与现有 MVP 相同的 data/error 包装，前端无需知道底层已迁移到 Worker。 */
export function dataResponse(data, status = 200, headers = {}) {
  return jsonResponse({ data }, status, headers);
}

export function errorResponse(error, headers = {}) {
  const status = error instanceof WorkerError ? error.status : 500;
  const code = error instanceof WorkerError ? error.code : "INTERNAL_ERROR";
  const message = status >= 500 ? "服务内部错误" : error.message;
  return jsonResponse({ error: { code, message, details: error.details } }, status, headers);
}

export function jsonResponse(body, status = 200, headers = {}) {
  const responseHeaders = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const [name, value] of Object.entries(headers)) {
    // 登录完成既要写 Session，又要删除 OAuth state；Set-Cookie 不能合并成单个逗号分隔值。
    for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
  }
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

/** 控制类请求体保持 64 KiB 上限，音频本体不进入 Worker 请求体。 */
export async function readJson(request, limit = 64 * 1024) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > limit) throw new WorkerError("PAYLOAD_TOO_LARGE", "请求体过大", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limit) throw new WorkerError("PAYLOAD_TOO_LARGE", "请求体过大", 413);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new WorkerError("INVALID_JSON", "JSON 请求体无效", 400); }
}

export function parseCookies(request) {
  const raw = request.headers.get("cookie") ?? "";
  return Object.fromEntries(raw.split(";").map((item) => item.trim().split("=")).filter(([key, value]) => key && value)
    .map(([key, value]) => [key, decodeURIComponent(value)]));
}

export function cookie(name, value, maxAge, secure = true) {
  const flags = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

export async function signAnonymous(id, secret) {
  return `${id}.${await hmacBase64Url(secret, id)}`;
}

export async function verifyAnonymous(value, secret) {
  const separator = String(value ?? "").lastIndexOf(".");
  if (separator < 1) return null;
  const id = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  return safeEqual(provided, await hmacBase64Url(secret, id)) ? id : null;
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,idempotency-key,x-turnstile-token",
    vary: "Origin",
  };
}

/**
 * Cookie 会随浏览器跨站请求自动附带，因此携带登录或匿名身份 Cookie 的写请求必须证明同源。
 * 安全方法、CORS 预检和仅创建认证挑战的请求不使用 Cookie 身份，分别由路由与 OAuth state 校验处理。
 */
export function assertCookieMutationOrigin(request, env) {
  if (isSafeMethod(request.method) || !hasIdentityCookie(request)) return;
  const origin = request.headers.get("origin");
  if (!origin) {
    console.warn(JSON.stringify({ event: "security.origin_rejected", reason: "missing_origin", method: request.method }));
    throw new WorkerError("ORIGIN_REQUIRED", "Cookie 鉴权写请求必须携带 Origin", 403);
  }
  if (!allowedOrigins(env).includes(origin)) {
    console.warn(JSON.stringify({ event: "security.origin_rejected", reason: "origin_not_allowed", method: request.method }));
    throw new WorkerError("ORIGIN_NOT_ALLOWED", "请求来源不在允许列表", 403);
  }
}

export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function isSafeMethod(method) {
  return new Set(["GET", "HEAD", "OPTIONS"]).has(method);
}

function hasIdentityCookie(request) {
  const cookies = parseCookies(request);
  return Boolean(cookies.so_session || cookies.so_anonymous);
}
