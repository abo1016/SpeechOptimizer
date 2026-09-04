import { createServer } from "node:http";
import { CoreError } from "./errors.js";

/**
 * 创建薄 HTTP 适配层。identityResolver 必须由账户模块注入，核心服务不解析会话或令牌。
 * maxJsonBytes 限制控制类请求体，音频上传上限仍由核心服务 config 二次校验。
 */
export function createHttpServer({ service, identityResolver, logger, maxJsonBytes = 64 * 1024 }) {
  if (typeof identityResolver !== "function") throw new TypeError("必须注入 identityResolver");
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return send(response, 200, { status: "ok", service: "core-platform" });
      }
      const actor = await identityResolver(request);
      const result = await dispatch({ request, service, actor, maxJsonBytes });
      return send(response, result.status, result.body);
    } catch (error) {
      return handleError(response, error, logger);
    }
  });
}

async function dispatch(context) {
  const { request } = context;
  const url = new URL(request.url, "http://core-platform.local");
  const segments = url.pathname.split("/").filter(Boolean);
  if (request.method === "POST" && url.pathname === "/v1/analyses") return createAnalysis(context);
  if (segments[0] === "v1" && segments[1] === "analyses" && segments[2]) {
    return analysisRoute(context, segments[2], segments[3]);
  }
  if (request.method === "DELETE" && segments[0] === "v1" && segments[1] === "accounts") {
    return ok(await context.service.deleteAccount({ accountId: segments[2], actor: context.actor }));
  }
  return { status: 404, body: { code: "ROUTE_NOT_FOUND" } };
}

async function createAnalysis({ request, service, actor, maxJsonBytes }) {
  const body = await readJson(request, maxJsonBytes);
  const result = await service.createAnalysis({
    idempotencyKey: request.headers["idempotency-key"], owner: actor,
    retainAudio: body.retainAudio,
  });
  return { status: result.duplicate ? 200 : 201, body: result };
}

async function analysisRoute(context, analysisId, action) {
  const { request, service, actor } = context;
  if (request.method === "GET" && !action) return ok(await service.getAnalysis({ analysisId, actor }));
  if (request.method === "DELETE" && !action) return ok(await service.deleteAnalysis({ analysisId, actor }));
  if (request.method === "PUT" && action === "audio") {
    const bytes = await readBytes(request, service.config.maxAudioBytes + 1);
    return ok(await service.uploadAudio({ analysisId, actor, bytes }));
  }
  if (request.method === "POST" && action === "run") return accepted(await service.runAnalysis({ analysisId, actor }));
  if (request.method === "POST" && action === "retry") return accepted(await service.retryAnalysis({ analysisId, actor }));
  if (request.method === "POST" && action === "cancel") return ok(await service.cancelAnalysis({ analysisId, actor }));
  if (request.method === "GET" && action === "audits") {
    return ok(await service.listAudits({ analysisId, actor }));
  }
  return { status: 404, body: { code: "ROUTE_NOT_FOUND" } };
}

async function readJson(request, limit) {
  const bytes = await readBytes(request, limit);
  if (bytes.length === 0) return {};
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CoreError("JSON 请求体无效", { code: "INVALID_JSON", status: 400 });
  }
}

async function readBytes(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new CoreError("请求体过大", { code: "PAYLOAD_TOO_LARGE", status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function handleError(response, error, logger) {
  if (error instanceof CoreError) {
    logger.warn("http.business_error", { action: error.code });
    return send(response, error.status, { code: error.code, message: error.message, details: error.details });
  }
  logger.error("http.internal_error", { action: error?.name ?? "Error" });
  return send(response, 500, { code: "INTERNAL_ERROR" });
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function ok(body) { return { status: 200, body }; }
function accepted(body) { return { status: 202, body }; }
