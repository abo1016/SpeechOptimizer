import { HttpError } from "./errors.js";

export async function readBody(request, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError("PAYLOAD_TOO_LARGE", "请求体超过限制", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request, limitBytes) {
  const body = await readBody(request, limitBytes);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError("INVALID_JSON", "JSON 请求体无效", 400);
  }
}

export function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body), ...headers });
  response.end(body);
}

/** 原样发送 Waffo SDK 签名响应；不得套用 MVP JSON data envelope 或改写响应正文。 */
export function sendRaw(response, status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  response.writeHead(status, { "content-type": "application/json",
    "content-length": bytes.byteLength, ...headers });
  response.end(bytes);
}

export function route(method, pathname, pattern) {
  if (method !== pattern.method) return null;
  const match = pathname.match(pattern.path);
  return match?.groups ?? null;
}

export function errorStatus(error) {
  if (Number.isInteger(error.status)) return error.status;
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "ACCOUNT_DISABLED") return 403;
  if (error.code === "INVALID_SESSION") return 401;
  if (/NOT_FOUND$/.test(error.code ?? "")) return 404;
  if (/INVALID_STATE|CONFLICT|NOT_RETRYABLE|NOT_READY/.test(error.code ?? "")) return 409;
  if (/TOO_LARGE/.test(error.code ?? "")) return 413;
  if (/UNSUPPORTED/.test(error.code ?? "")) return 415;
  return error.code ? 400 : 500;
}
