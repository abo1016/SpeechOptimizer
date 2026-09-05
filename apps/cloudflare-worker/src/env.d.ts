/** Cloudflare Worker 当前阶段允许访问的绑定；后续 D1/R2 必须按环境单独声明。 */
interface Env {
  ASSETS: Fetcher;
  APP_ENV: "local" | "preview" | "production";
  APP_VERSION: string;
  RESOURCE_NAMESPACE: string;
}

/** Static Assets binding 暴露的最小 Fetcher 契约。 */
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
