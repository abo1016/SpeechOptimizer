# Cloudflare Worker

SpeechOptimizer 的 Cloudflare 全栈入口。Phase 1 只建立 Worker、Static Assets、环境隔离、结构化日志与健康检查；D1、R2、Queue、Workflow 会在后续阶段接入。

## 环境隔离

- `local`：Worker `speechoptimizer-web-local`，资源命名空间 `speechoptimizer-local`。
- `preview`：Worker `speechoptimizer-web-preview`，资源命名空间 `speechoptimizer-preview`。
- `production`：Worker `speechoptimizer-web`，资源命名空间 `speechoptimizer-production`。

Preview 与 Production 的 D1、R2、Queue、Secrets 必须分别创建和绑定。新增绑定时必须写在对应 `env.preview` / `env.production` 下，禁止 Preview 复用任何 `speechoptimizer-production` 资源 ID、bucket 名或生产 Secret。

## 本地验证

`pnpm run dev` 会先构建 `prototype/dist/client`，再通过 Wrangler 本地运行 Worker。Static Assets 使用 SPA fallback；`/health` 与 `/api/*` 由 Worker 优先处理。

`APP_VERSION` 当前是环境占位值。正式发布流程应在部署时注入 commit SHA 或版本号，健康检查不得返回 binding 详情、资源 ID 或 Secret。
