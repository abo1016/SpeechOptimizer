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
  if (!env.API_ORIGIN) {
    console.error("sites.api_proxy_not_configured", { path: url.pathname });
    return new Response("API origin is not configured", { status: 503 });
  }

  const upstream = new URL(url.pathname + url.search, env.API_ORIGIN);
  const transport = env.API?.fetch ? env.API : globalThis;
  try {
    return await transport.fetch(new Request(upstream, request));
  } catch {
    console.error("sites.api_proxy_failed", { path: url.pathname });
    return new Response("API is unavailable", { status: 502 });
  }
}
