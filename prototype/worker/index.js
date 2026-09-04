export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) return proxyApi(request, env, url);

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};

function isApiPath(pathname) {
  return pathname === "/health" || pathname.startsWith("/api/");
}

/** 通过站点同源转发 API，让浏览器会话 Cookie 不依赖第三方 Cookie 策略。 */
async function proxyApi(request, env, url) {
  const apiOrigin = validApiOrigin(env.API_ORIGIN, url.pathname);
  if (!apiOrigin) return unavailableApiResponse(503);

  const transport = env.API?.fetch ? env.API : globalThis;
  try {
    const upstream = new URL(url.pathname + url.search, apiOrigin);
    return await transport.fetch(new Request(upstream, request));
  } catch {
    console.error("sites.api_proxy_failed", { path: url.pathname });
    return unavailableApiResponse(502);
  }
}

/** 仅接受可供 fetch 使用的 HTTP(S) 绝对地址，日志不记录配置值以免暴露内部目标。 */
function validApiOrigin(value, path) {
  const origin = typeof value === "string" ? value.trim() : "";
  if (!origin) {
    console.error("sites.api_proxy_origin_missing", { path });
    return null;
  }
  try {
    const parsed = new URL(origin);
    if (["http:", "https:"].includes(parsed.protocol)) return parsed;
  } catch {}
  console.error("sites.api_proxy_origin_invalid", { path });
  return null;
}

function unavailableApiResponse(status) {
  return new Response("API is unavailable", { status });
}
