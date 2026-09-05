import { route } from "./http-utils.js";
import { clearCookie } from "./cookies.js";
import { HttpError } from "./errors.js";
import { resolveIdentity } from "./routes-auth.js";

export async function handleAccount(context) {
  const { request, pathname, application, json, success } = context;
  if (request.method === "GET" && pathname === "/api/v1/privacy") {
    const identity = resolveIdentity(request, application, context.config);
    return success(200, { retainAudio: identity.user?.retainAudio === true });
  }
  if (request.method === "PUT" && pathname === "/api/v1/privacy") {
    const identity = requireAccount(context);
    identity.user.retainAudio = (await json()).retainAudio === true;
    await application.store.flush();
    return success(200, { retainAudio: identity.user.retainAudio });
  }
  if (request.method === "DELETE" && pathname === "/api/v1/account") return deleteAccount(context);
  if (request.method === "GET" && pathname === "/api/v1/admin/observability") {
    authorizeAdmin(context);
    return success(200, context.application.adminObservability());
  }
  let params = route(request.method, pathname, { method: "GET", path: /^\/api\/v1\/admin\/users\/(?<id>[^/]+)$/ });
  if (params) return success(200, application.admin.userOverview(authorizeAdmin(context).target(params.id)));
  params = route(request.method, pathname, { method: "POST", path: /^\/api\/v1\/admin\/users\/(?<id>[^/]+)\/disable$/ });
  if (params) return adminMutation(context, params.id, "disable", await json());
  params = route(request.method, pathname, { method: "POST", path: /^\/api\/v1\/admin\/users\/(?<id>[^/]+)\/return-minutes$/ });
  if (params) return adminMutation(context, params.id, "return", await json());
  params = route(request.method, pathname, { method: "POST", path: /^\/api\/v1\/admin\/analyses\/(?<id>[^/]+)\/retry$/ });
  if (params) return adminRetry(context, params.id);
  return false;
}

async function deleteAccount(context) {
  const identity = requireAccount(context);
  const core = await context.application.deleteAccount(identity.actor);
  context.application.admin.disableAccount({ userId: identity.user.id, actorId: identity.user.id, reason: "account_deleted" });
  revokeUserSessions(context.application.store, identity.user.id);
  context.application.purgeAccountData(identity.user.id);
  await context.application.store.flush();
  return context.success(200, core, { "set-cookie": clearCookie("so_session", context.config.secureCookies) });
}

async function adminMutation(context, userId, action, input) {
  const admin = authorizeAdmin(context);
  const result = action === "disable"
    ? context.application.admin.disableAccount({ userId, actorId: admin.user.id, reason: input.reason })
    : context.application.admin.returnMinutes({ userId, actorId: admin.user.id,
      minutes: input.minutes, reason: input.reason });
  if (action === "disable") revokeUserSessions(context.application.store, userId);
  await context.application.store.flush();
  return context.success(200, result);
}

async function adminRetry(context, analysisId) {
  authorizeAdmin(context);
  const summary = context.application.store.analyses.get(analysisId);
  if (!summary) throw new HttpError("ANALYSIS_NOT_FOUND", "分析任务不存在", 404);
  const result = await context.application.retry(summary.owner, analysisId,
    { adminId: resolveIdentity(context.request, context.application, context.config).user.id,
      reason: "admin_requested" });
  return context.success(202, result);
}

function requireAccount(context) {
  const identity = resolveIdentity(context.request, context.application, context.config);
  if (!identity.user) throw new HttpError("AUTHENTICATION_REQUIRED", "该操作需要登录账户", 401);
  return identity;
}

function authorizeAdmin(context) {
  const identity = requireAccount(context);
  context.application.auth.authorize(identity.sessionToken, ["admin"]);
  return { ...identity, target: (id) => id };
}

function revokeUserSessions(store, userId) {
  for (const [key, session] of store.sessions.entries()) {
    if (session.userId === userId) store.sessions.delete(key);
  }
}
