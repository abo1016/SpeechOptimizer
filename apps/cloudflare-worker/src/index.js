import { routeRequest } from "./router.js";
import { jsonResponse } from "./responses.js";
import { logEvent } from "./logger.js";

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      const url = new URL(request.url);
      logEvent("error", "worker.request_failed", {
        environment: env.APP_ENV,
        method: request.method,
        path: url.pathname,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return jsonResponse(
        { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
        { status: 500 },
      );
    }
  },
};
