# Cloudflare Worker

SpeechOptimizer 的 Cloudflare 全栈入口。当前已实现 Static Assets、D1、Supabase Storage 直传、Queue、Workflow、真实认证边界、Turnstile 接口、生命周期清理和免费 Beta 配额护栏；Preview/Production 仍以 `PAYMENTS_ENABLED=false` 运行。本地 Miniflare 继续使用 R2 binding 作为无外部依赖的测试后端。

## 环境隔离

- `local`：Worker `speechoptimizer-web-local`，资源命名空间 `speechoptimizer-local`。
- `preview`：Worker `speechoptimizer-web-preview`，资源命名空间 `speechoptimizer-preview`。
- `production`：Worker `speechoptimizer-web`，资源命名空间 `speechoptimizer-production`。

Preview 与 Production 的 D1、Supabase Storage bucket、Queue、Secrets 必须隔离。Preview 使用 `speechoptimizer-preview-audio`，Production 使用 `speechoptimizer-production-audio`；两者都必须是 private bucket。`SUPABASE_SECRET_KEY`（或兼容期的 `SUPABASE_SERVICE_ROLE_KEY`）只允许写入 Worker Secret，绝不能进入浏览器、`VITE_*`、日志或仓库。

## OpenAI-compatible STT 配置

Worker 使用服务端的 OpenAI-compatible 音频转写接口。`OPENAI_API_KEY` 是每个命名环境独立管理的 Worker Secret，只通过 `wrangler secret put OPENAI_API_KEY --env <环境>` 写入；不要把它放进 `wrangler.jsonc` 的 `vars`、浏览器、D1、对象 metadata 或日志。

`OPENAI_STT_URL` 是完整的 `POST` endpoint，不会再自动拼接 `/v1/audio/transcriptions`。未设置时默认使用 `https://api.openai.com/v1/audio/transcriptions`；显式值必须是非空、无首尾或内部空白、长度不超过 2048 的 HTTPS URL，包含 hostname，且不得有 userinfo、query、fragment 或控制字符。这样既能直接调用官方接口，也能切换到路径已确定的 OpenAI-compatible 中转 endpoint；中转 endpoint 必须接受同一 Bearer 鉴权和 multipart 请求契约。

`OPENAI_STT_MODEL` 未设置时默认为 `whisper-1`。它由部署环境控制并写入 multipart 的 `model` 字段；允许经过审查的中转模型别名，但拒绝空白、控制字符和超长值。请求固定携带 `response_format=verbose_json`、`timestamp_granularities[]=word`，因此中转必须返回兼容的 `text`、可信 `duration` 和逐词 `words` 字段。不要把请求体、请求头、endpoint、model 或 Secret 暴露到日志；配置非法会在外部 fetch 前以不可重试的 `STT_CONFIG_INVALID` 失败。

不开放请求体或客户端参数覆盖 endpoint、model、Bearer 鉴权、`response_format`、逐词时间戳、文件名/MIME、`Idempotency-Key`、超时和 Workflow 重试策略；这些属于服务端安全与响应契约，改变它们应先实现并验证独立 provider adapter。

Local、Preview、Production 的 `wrangler.jsonc` 命名环境都会显式声明 URL/model：Local 与 Production 当前为官方兼容默认值，Preview 当前为 owner 选定的 AIHubMix 完整 endpoint 与 `whisper-1`。这不是 AIHubMix 已通过真实转写验收的声明；其 multipart/逐词响应兼容性必须由 Preview E2E 证明。Local 的默认执行链通常由 Mock 后端覆盖，不代表真实 OpenAI Secret 已配置；真实 Preview/Production 流程必须分别保有对应 Worker Secret。

## 本地验证

`pnpm run dev` 会先构建 `prototype/dist/client`，再通过 Wrangler 本地运行 Worker。Static Assets 使用 SPA fallback；`/health` 与 `/api/*` 由 Worker 优先处理。

## Wrangler 类型门禁

`worker-configuration.d.ts` 是已提交的 Wrangler 生成文件，Preview 配置是其权威来源。修改 `wrangler.jsonc` 的 binding、变量或 Workflow 后，先运行 `pnpm run types:generate` 更新文件，再运行 `pnpm run check`；后者会先执行 `types:check`，确保生成物没有滞后于 Preview 配置。

Production 发布前必须额外运行 `pnpm run types:check:production`。该入口用 Production 配置检查同一生成类型契约，只做本地配置校验，不会部署 Worker 或写入远端资源。不要在 `src/env.d.ts` 手写 `Env` 或 Cloudflare 平台接口，避免覆盖 Wrangler 的权威声明。

`APP_VERSION` 当前是环境占位值。正式发布流程应在部署时注入 commit SHA 或版本号，健康检查不得返回 binding 详情、资源 ID 或 Secret。

生产上传采用三段式：创建分析任务、由 Worker 使用 server secret 向 Supabase Storage 申请当前对象的 signed upload URL、浏览器直接 PUT 到 private bucket，再由 Worker 使用 Storage `info` + 4 字节 Range 校验大小/MIME/SHA-256 元数据和 WebM 魔数后入队。Workflow 可以读取完整对象用于 STT。旧 `PUT /api/v1/analyses/:id/audio` 只允许 `local` 环境使用，Preview/Production 会拒绝该路径。

免费额度的 Worker/D1/Queue/Workflow 实际用量以 Cloudflare Usage/Analytics 为事实源，Supabase Storage/egress 以 Supabase Dashboard Usage 为事实源。运营达到警戒值后调整非敏感变量 `FREE_TIER_GUARD_LEVEL=80|90|95`：80 暂停匿名分析，90 暂停创建新分析，95 进一步暂停新上传；登录、历史和报告读取保持可用。应用层 `STORAGE_LIMIT_BYTES` 默认 800 MiB，为 Supabase Free 的约 1 GB Storage 留出余量。匿名体验的可信 STT 时长限制为 60 秒，注册用户上限为 5 分钟。

真实 Preview E2E 需要准备独立 Supabase 项目或明确允许复用的项目，并创建两个 private bucket；随后为 Worker 配置 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`（或兼容期 `SUPABASE_SERVICE_ROLE_KEY`）。当前代码迁移已不再受 Cloudflare R2 账号启用状态阻塞；在真实 Supabase project/bucket/secret 尚未配置并测试前，不得声称 Preview/Production Storage E2E 已通过。
