# Cloudflare Worker

SpeechOptimizer 的 Cloudflare 全栈入口。当前已实现 Static Assets、D1、Supabase Storage 直传、Queue、Workflow、真实认证边界、Turnstile 接口、生命周期清理和免费 Beta 配额护栏；Preview/Production 仍以 `PAYMENTS_ENABLED=false` 运行。本地 Miniflare 继续使用 R2 binding 作为无外部依赖的测试后端。

## 环境隔离

- `local`：Worker `speechoptimizer-web-local`，资源命名空间 `speechoptimizer-local`。
- `preview`：Worker `speechoptimizer-web-preview`，资源命名空间 `speechoptimizer-preview`。
- `production`：Worker `speechoptimizer-web`，资源命名空间 `speechoptimizer-production`。

Preview 与 Production 的 D1、Supabase Storage bucket、Queue、Secrets 必须隔离。Preview 使用 `speechoptimizer-preview-audio`，Production 使用 `speechoptimizer-production-audio`；两者都必须是 private bucket。`SUPABASE_SECRET_KEY`（或兼容期的 `SUPABASE_SERVICE_ROLE_KEY`）只允许写入 Worker Secret，绝不能进入浏览器、`VITE_*`、日志或仓库。

## 本地验证

`pnpm run dev` 会先构建 `prototype/dist/client`，再通过 Wrangler 本地运行 Worker。Static Assets 使用 SPA fallback；`/health` 与 `/api/*` 由 Worker 优先处理。

## Wrangler 类型门禁

`worker-configuration.d.ts` 是已提交的 Wrangler 生成文件，Preview 配置是其权威来源。修改 `wrangler.jsonc` 的 binding、变量或 Workflow 后，先运行 `pnpm run types:generate` 更新文件，再运行 `pnpm run check`；后者会先执行 `types:check`，确保生成物没有滞后于 Preview 配置。

Production 发布前必须额外运行 `pnpm run types:check:production`。该入口用 Production 配置检查同一生成类型契约，只做本地配置校验，不会部署 Worker 或写入远端资源。不要在 `src/env.d.ts` 手写 `Env` 或 Cloudflare 平台接口，避免覆盖 Wrangler 的权威声明。

`APP_VERSION` 当前是环境占位值。正式发布流程应在部署时注入 commit SHA 或版本号，健康检查不得返回 binding 详情、资源 ID 或 Secret。

生产上传采用三段式：创建分析任务、由 Worker 使用 server secret 向 Supabase Storage 申请当前对象的 signed upload URL、浏览器直接 PUT 到 private bucket，再由 Worker 使用 Storage `info` + 4 字节 Range 校验大小/MIME/SHA-256 元数据和 WebM 魔数后入队。Workflow 可以读取完整对象用于 STT。旧 `PUT /api/v1/analyses/:id/audio` 只允许 `local` 环境使用，Preview/Production 会拒绝该路径。

免费额度的 Worker/D1/Queue/Workflow 实际用量以 Cloudflare Usage/Analytics 为事实源，Supabase Storage/egress 以 Supabase Dashboard Usage 为事实源。运营达到警戒值后调整非敏感变量 `FREE_TIER_GUARD_LEVEL=80|90|95`：80 暂停匿名分析，90 暂停创建新分析，95 进一步暂停新上传；登录、历史和报告读取保持可用。应用层 `STORAGE_LIMIT_BYTES` 默认 800 MiB，为 Supabase Free 的约 1 GB Storage 留出余量。匿名体验的可信 STT 时长限制为 60 秒，注册用户上限为 5 分钟。

真实 Preview E2E 需要准备独立 Supabase 项目或明确允许复用的项目，并创建两个 private bucket；随后为 Worker 配置 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`（或兼容期 `SUPABASE_SERVICE_ROLE_KEY`）。当前代码迁移已不再受 Cloudflare R2 账号启用状态阻塞；在真实 Supabase project/bucket/secret 尚未配置并测试前，不得声称 Preview/Production Storage E2E 已通过。
