import { route } from "./http-utils.js";
import { resolveIdentity } from "./routes-auth.js";

export async function handleAnalysis(context) {
  const { request, pathname, application, json, raw, success } = context;
  if (request.method === "GET" && pathname === "/analysis/demo-processing") {
    return success(200, { id: "demo-processing", status: "analyzing", retryable: true,
      steps: ["uploaded", "transcribing", "analyzing"], error: null });
  }
  const identity = () => resolveIdentity(request, application, context.config).actor;
  let params;
  if (request.method === "POST" && pathname === "/api/v1/analyses") {
    const result = await application.createAnalysis(identity(), await json(), request.headers["idempotency-key"]);
    return success(result.duplicate ? 200 : 202, result);
  }
  if ((params = route(request.method, pathname, { method: "PUT", path: /^\/api\/v1\/analyses\/(?<id>[^/]+)\/audio$/ }))) {
    if (request.headers["content-type"] !== "application/octet-stream") {
      throw Object.assign(new Error("音频上传必须使用 application/octet-stream"),
        { code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
    }
    const result = await application.uploadAudio(identity(), params.id, await raw(context.config.audioLimitBytes));
    return success(202, result);
  }
  if ((params = route(request.method, pathname, { method: "GET", path: /^\/api\/v1\/analyses\/(?<id>[^/]+)$/ }))) {
    return success(200, await application.getAnalysis(identity(), params.id));
  }
  if ((params = actionParams(request.method, pathname, "cancel"))) return success(200, await application.cancel(identity(), params.id));
  if ((params = actionParams(request.method, pathname, "retry"))) return success(202, await application.retry(identity(), params.id));
  if ((params = route(request.method, pathname, { method: "DELETE", path: /^\/api\/v1\/analyses\/(?<id>[^/]+)$/ }))) {
    return success(200, await application.delete(identity(), params.id));
  }
  if (request.method === "GET" && pathname === "/api/v1/analyses") {
    return success(200, application.history(identity(), Object.fromEntries(context.url.searchParams)));
  }
  if ((params = route(request.method, pathname, { method: "GET", path: /^\/api\/v1\/analyses\/(?<id>[^/]+)\/report$/ }))) {
    return success(200, await application.report(identity(), params.id));
  }
  if (request.method === "POST" && pathname === "/api/v1/comparisons") {
    const input = await json();
    return success(200, await application.compare(identity(), input.beforeAnalysisId, input.afterAnalysisId));
  }
  return false;
}

function actionParams(method, pathname, action) {
  return route(method, pathname, { method: "POST", path: new RegExp(`^/api/v1/analyses/(?<id>[^/]+)/${action}$`) });
}
