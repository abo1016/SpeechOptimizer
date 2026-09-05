import { logEvent } from "./logger.js";
import { apiNotFound, jsonResponse, methodNotAllowed } from "./responses.js";

/**
 * Phase 1 只提供基础路由。后续 API 必须继续通过此入口分发，避免业务 SQL 或绑定调用散落到 Fetch handler。
 * @param {Request} request
 * @param {Env} env
 */
export async function routeRequest(request, env) {
  const url = new URL(request.url);
  const startedAt = Date.now();
  let response;

  if (url.pathname === "/health") {
    response = healthResponse(request, env);
  } else if (url.pathname.startsWith("/api/")) {
    response = apiNotFound();
  } else {
    response = await env.ASSETS.fetch(request);
  }

  logEvent("info", "worker.request_completed", {
    environment: env.APP_ENV,
    method: request.method,
    path: url.pathname,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response;
}

/** @param {Request} request @param {Env} env */
function healthResponse(request, env) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    return methodNotAllowed(["GET", "HEAD"]);
  }

  const response = jsonResponse({
    version: env.APP_VERSION,
    environment: env.APP_ENV,
    dependencies: {
      assets: typeof env.ASSETS?.fetch === "function",
    },
  });
  return request.method === "HEAD" ? new Response(null, response) : response;
}
