import { createAnalysis, cancelAnalysis, completeAudioUpload, deleteAccount, deleteAnalysis,
  requestAudioUpload, retryAnalysis, retryAnalysisAsAdmin, uploadAudioLocally } from "./analysis.js";
import { beginGoogleOAuth, completeGoogleOAuth, consumeMagicLink, currentSession, ensureAnonymous,
  clearGoogleOAuthStateCookie, logout, requestMagicLink, resolveIdentity } from "./auth.js";
import { runtimeConfig } from "./config.js";
import { WorkerError, invariant } from "./errors.js";
import { assertCookieMutationOrigin, corsHeaders, dataResponse, errorResponse, jsonResponse, readJson } from "./http.js";
import { logEvent } from "./logger.js";
import { D1Repository } from "./repository.js";
import { compareTakes } from "../../../packages/speech-engine/src/compare.js";

/** Fetch Router 是 Worker 唯一 HTTP 分发入口，业务 SQL 和对象存储操作由专用 service/repository 承担。 */
export async function routeRequest(request, env) {
  const url = new URL(request.url);
  const startedAt = Date.now();
  const cors = corsHeaders(request, env);
  let response;
  try {
    if (request.method === "OPTIONS") response = jsonResponse({}, 204, cors);
    else if (url.pathname === "/health") response = healthResponse(request, env);
    else if (url.pathname.startsWith("/api/")) {
      assertCookieMutationOrigin(request, env);
      response = await routeApi(request, url, env, cors);
    } else response = await env.ASSETS.fetch(request);
  } catch (error) {
    response = errorResponse(error, cors);
  }
  logEvent(response.status >= 500 ? "error" : "info", "worker.request_completed", {
    environment: env.APP_ENV, method: request.method, path: url.pathname,
    status: response.status, durationMs: Date.now() - startedAt,
  });
  return response;
}

async function routeApi(request, url, env, cors) {
  const repository = new D1Repository(env.DB);
  const path = url.pathname;
  const method = request.method;
  if (method === "POST" && path === "/api/v1/anonymous/session") return result(await ensureAnonymous(request, env, repository), cors);
  if (method === "POST" && path === "/api/v1/auth/magic-link") return dataResponse(await requestMagicLink(await readJson(request), request, env, repository), 202, cors);
  if (method === "POST" && path === "/api/v1/auth/magic-link/consume") return loginResult(await consumeMagicLink(await readJson(request), env, repository), cors);
  if (method === "POST" && path === "/api/v1/auth/google/start") return googleStart(request, env, repository, cors);
  if (method === "POST" && path === "/api/v1/auth/google/complete") return googleComplete(request, env, repository, cors);
  if (method === "GET" && path === "/api/v1/session") return dataResponse(await currentSession(request, env, repository), 200, cors);
  if (method === "POST" && path === "/api/v1/auth/logout") return result(await logout(request, env, repository), cors);
  if (method === "POST" && path === "/api/v1/comparisons") return routeComparison(request, env, repository, cors);
  if (path.startsWith("/api/v1/admin/")) return routeAdmin(request, url, env, repository, cors);
  if (path.startsWith("/api/v1/analyses")) return routeAnalyses(request, url, env, repository, cors);
  if (path === "/api/v1/privacy") return routePrivacy(request, env, repository, cors);
  if (method === "DELETE" && path === "/api/v1/account") return routeDeleteAccount(request, env, repository, cors);
  if (path.startsWith("/api/v1/billing") || path === "/api/v1/plans") return routePayments(request, env, cors);
  throw new WorkerError("ROUTE_NOT_FOUND", "接口不存在", 404);
}

/** 免费 Beta 管理面只处理 D1 已持久化的失败分析，不迁移付款、账本或人工权益功能。 */
async function routeAdmin(request, url, env, repository, cors) {
  const admin = await requireAdmin(request, env, repository);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/analyses") {
    const status = url.searchParams.get("status");
    invariant(!status || status === "failed", "INVALID_ANALYSIS_STATUS", "管理页只支持查询失败任务", 400);
    const page = await repository.listFailedForAdmin(Object.fromEntries(url.searchParams));
    logEvent("info", "admin.failed_analyses_listed", { adminId: admin.id, count: page.items.length });
    return dataResponse(page, 200, cors);
  }
  const retryMatch = url.pathname.match(/^\/api\/v1\/admin\/analyses\/([^/]+)\/retry$/);
  if (request.method === "POST" && retryMatch) {
    return dataResponse(await retryAnalysisAsAdmin(admin, retryMatch[1], env, repository), 202, cors);
  }
  throw new WorkerError("ROUTE_NOT_FOUND", "接口不存在", 404);
}

/** 前端是否隐藏菜单不构成授权；匿名会话返回 401，普通账户返回 403。 */
async function requireAdmin(request, env, repository) {
  const identity = await resolveIdentity(request, env, repository);
  if (!identity?.user) throw new WorkerError("AUTHENTICATION_REQUIRED", "管理员操作需要登录账户", 401);
  const admin = identity.user;
  if (admin.role !== "admin") throw new WorkerError("FORBIDDEN", "需要管理员权限", 403);
  return admin;
}

async function routeAnalyses(request, url, env, repository, cors) {
  const identity = await resolveIdentity(request, env, repository);
  if (!identity) throw new WorkerError("AUTHENTICATION_REQUIRED", "需要先建立会话", 401);
  const owner = identity.actor;
  if (request.method === "POST" && url.pathname === "/api/v1/analyses") {
    const created = await createAnalysis(request, await readJson(request), owner, env, repository);
    return dataResponse(created, created.duplicate ? 200 : 202, cors);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/analyses") {
    return dataResponse(await repository.listOwned(owner, Object.fromEntries(url.searchParams)), 200, cors);
  }
  const match = url.pathname.match(/^\/api\/v1\/analyses\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) throw new WorkerError("ROUTE_NOT_FOUND", "接口不存在", 404);
  return analysisAction(request, match[1], match[2], owner, env, repository, cors);
}

async function analysisAction(request, id, action, owner, env, repository, cors) {
  if (request.method === "GET" && !action) return dataResponse(await repository.getOwnedAnalysis(id, owner), 200, cors);
  if (request.method === "DELETE" && !action) return dataResponse(await deleteAnalysis(owner, id, env, repository), 200, cors);
  if (request.method === "GET" && action === "report") return reportResponse(owner, id, repository, cors);
  if (request.method === "POST" && action === "audio-upload") {
    return dataResponse(await requestAudioUpload(await readJson(request), owner, id, env, repository), 200, cors);
  }
  if (request.method === "POST" && action === "audio-complete") {
    return dataResponse(await completeAudioUpload(await readJson(request), owner, id, env, repository), 202, cors);
  }
  if (request.method === "PUT" && action === "audio") {
    return dataResponse(await uploadAudioLocally(request, owner, id, env, repository), 202, cors);
  }
  if (request.method === "POST" && action === "cancel") return dataResponse(await cancelAnalysis(owner, id, env, repository), 200, cors);
  if (request.method === "POST" && action === "retry") return dataResponse(await retryAnalysis(owner, id, env, repository), 202, cors);
  throw new WorkerError("ROUTE_NOT_FOUND", "接口不存在", 404);
}

async function reportResponse(owner, id, repository, cors) {
  const analysis = await repository.getOwnedAnalysis(id, owner);
  invariant(analysis.status === "completed", "REPORT_NOT_READY", "报告尚未生成", 409);
  return dataResponse(analysis.result, 200, cors);
}

async function routePrivacy(request, env, repository, cors) {
  const identity = await resolveIdentity(request, env, repository);
  if (!identity) throw new WorkerError("AUTHENTICATION_REQUIRED", "需要先建立会话", 401);
  if (request.method === "GET") return dataResponse({ retainAudio: identity.user?.retainAudio === true }, 200, cors);
  if (request.method !== "PUT") throw new WorkerError("METHOD_NOT_ALLOWED", "请求方法不受支持", 405);
  invariant(identity.user, "AUTHENTICATION_REQUIRED", "该操作需要登录账户", 401);
  const retainAudio = (await readJson(request)).retainAudio === true;
  await repository.updateRetainAudio(identity.actor.id, retainAudio);
  return dataResponse({ retainAudio }, 200, cors);
}

async function routeDeleteAccount(request, env, repository, cors) {
  const identity = await resolveIdentity(request, env, repository);
  if (!identity) throw new WorkerError("AUTHENTICATION_REQUIRED", "该操作需要登录账户", 401);
  const data = await deleteAccount(identity, env, repository);
  return dataResponse(data, 200, { ...cors, "set-cookie": "so_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
}

async function routeComparison(request, env, repository, cors) {
  const identity = await resolveIdentity(request, env, repository);
  if (!identity) throw new WorkerError("AUTHENTICATION_REQUIRED", "需要先建立会话", 401);
  const input = await readJson(request);
  const before = await repository.getOwnedAnalysis(input.beforeAnalysisId, identity.actor);
  const after = await repository.getOwnedAnalysis(input.afterAnalysisId, identity.actor);
  invariant(before.status === "completed" && after.status === "completed", "REPORT_NOT_READY", "比较任务必须已经完成", 409);
  return dataResponse(compareTakes(before.result.report, after.result.report), 200, cors);
}

async function routePayments(request, env, cors) {
  const config = runtimeConfig(env);
  const pathname = new URL(request.url).pathname;
  if (!config.paymentsEnabled && request.method === "GET") {
    if (pathname === "/api/v1/plans") return dataResponse({}, 200, cors);
    if (pathname === "/api/v1/billing/balance") return dataResponse({ minutes: 0, reports: 0, paymentsEnabled: false }, 200, cors);
    if (new Set(["/api/v1/billing/ledger", "/api/v1/billing/orders", "/api/v1/billing/subscriptions"]).has(pathname)) {
      return dataResponse([], 200, cors);
    }
  }
  throw new WorkerError("PAYMENTS_DISABLED", "免费 Beta 暂未开放支付", 503);
}

async function googleStart(request, env, repository, cors) {
  // Google state 与 Turnstile token 都通过 POST body 传递，避免出现在 URL、Referer 或访问日志中。
  const { headers, ...data } = await beginGoogleOAuth(await readJson(request), request, env, repository);
  return dataResponse(data, 200, { ...cors, ...headers });
}

async function googleComplete(request, env, repository, cors) {
  // 无论授权码交换是否成功都清理浏览器绑定，旧 Cookie 不能被下一次 OAuth 回调重用。
  const headers = { ...cors, "set-cookie": clearGoogleOAuthStateCookie() };
  try {
    const value = await completeGoogleOAuth(await readJson(request), request, env, repository);
    return loginResult(value, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
}

function loginResult(value, headers) {
  const setCookies = [headers["set-cookie"], value.headers?.["set-cookie"]].filter(Boolean);
  return dataResponse(value.data, 200, { ...headers, ...value.headers, "set-cookie": setCookies });
}
function result(value, cors) { return dataResponse(value.data, value.status ?? 200, { ...cors, ...value.headers }); }

function healthResponse(request, env) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { allow: "GET, HEAD" });
  const response = jsonResponse({ version: env.APP_VERSION, environment: env.APP_ENV,
    mode: env.APP_ENV === "local" ? "mock" : "cloudflare",
    authMode: env.APP_ENV === "local" ? "mock" : "production",
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
    dependencies: { assets: typeof env.ASSETS?.fetch === "function", d1: Boolean(env.DB),
      storage: env.APP_ENV === "local"
        ? Boolean(env.AUDIO_BUCKET)
        : Boolean(env.SUPABASE_URL && env.SUPABASE_STORAGE_BUCKET
          && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)),
      queue: Boolean(env.ANALYSIS_QUEUE), workflow: Boolean(env.ANALYSIS_WORKFLOW) } });
  return request.method === "HEAD" ? new Response(null, response) : response;
}
