import { createServer } from "node:http";
import { createRequestId } from "./application.js";
import { HttpError } from "./errors.js";
import { errorStatus, readBody, readJson, sendJson } from "./http-utils.js";
import { handleAccount } from "./routes-account.js";
import { handleAnalysis } from "./routes-analysis.js";
import { handleAuth } from "./routes-auth.js";
import { handleBilling } from "./routes-billing.js";

const HANDLERS = [handleAuth, handleAnalysis, handleBilling, handleAccount];

/** 创建无框架 HTTP 服务，限制请求体并集中处理 CORS、错误码和审计请求 ID。 */
export function createMvpServer({ application, config, logger }) {
  const webhookGuard = createWebhookGuard(config);
  return createServer(async (request, response) => {
    const requestId = createRequestId();
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const cors = corsHeaders(request, config);
    if (request.method === "OPTIONS") return sendJson(response, 204, {}, cors);
    try {
      assertOrigin(request, config);
      const context = createContext({ request, response, url, application, config, cors, webhookGuard });
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { data: { status: "ok", mode: application.providers.mode } }, cors);
      }
      for (const handler of HANDLERS) if (await handler(context)) return;
      sendJson(response, 404, { error: { code: "ROUTE_NOT_FOUND", message: "接口不存在" } }, cors);
    } catch (error) {
      const status = errorStatus(error);
      logger[status >= 500 ? "error" : "warn"]("http.request_failed", { requestId,
        method: request.method, path: url.pathname, status, code: error.code ?? "INTERNAL_ERROR" });
      sendJson(response, status, { error: { code: error.code ?? "INTERNAL_ERROR",
        message: status >= 500 ? "服务内部错误" : error.message, details: error.details } }, cors);
    }
  });
}

function createContext({ request, response, url, application, config, cors, webhookGuard }) {
  return { request, response, url, pathname: url.pathname, application, config,
    json: () => readJson(request, config.jsonLimitBytes),
    raw: (limit) => readBody(request, limit),
    guardWebhook: () => webhookGuard(request),
    success(status, data, headers = {}) {
      sendJson(response, status, { data }, { ...cors, ...headers });
      return true;
    } };
}

function corsHeaders(request, config) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.includes(origin)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,idempotency-key,x-waffo-signature", "vary": "Origin" };
}

function assertOrigin(request, config) {
  const origin = request.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) {
    throw new HttpError("ORIGIN_NOT_ALLOWED", "请求来源不在允许列表", 403);
  }
}

function createWebhookGuard(config) {
  const windows = new Map();
  return (request) => {
    const source = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown").split(",")[0].trim();
    if (config.waffoAllowedSources.length > 0 && !config.waffoAllowedSources.includes(source)) {
      throw new HttpError("WEBHOOK_SOURCE_NOT_ALLOWED", "Webhook 来源不在允许列表", 403);
    }
    const minute = Math.floor(Date.now() / 60_000);
    const current = windows.get(source);
    const count = current?.minute === minute ? current.count + 1 : 1;
    windows.set(source, { minute, count });
    if (count > config.webhookRequestsPerMinute) {
      throw new HttpError("WEBHOOK_RATE_LIMITED", "Webhook 请求过于频繁", 429);
    }
  };
}
