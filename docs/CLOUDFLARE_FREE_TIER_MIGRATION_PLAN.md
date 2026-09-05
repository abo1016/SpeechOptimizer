# SpeechOptimizer Cloudflare 全栈免费层改造方案

> 状态：Phase 1 本地与远程 HTTP Gate 已完成；Phase 2～4 的本地实现、高优先级一致性修复、DLQ 管理闭环与 Wrangler generated types Gate 已通过。Preview D1 已完成 `0003`～`0006` 的受控应用与复核；当前外部 Gate 是配置 Preview Supabase server secret 与 `OPENAI_API_KEY`、部署当前审查版本、验证真实 Supabase/Workflow/OpenAI 流式 E2E、为 Production 应用 `0003`～`0006` 并完成 Free CPU/完整性 Spike；Production 尚未部署或切流。
> 编制日期：2026-09-05
> 目标：在不使用 Railway、Vercel 和 Cloudflare Container 的前提下，将公开站点、真实认证、音频分析与数据持久化迁移到 Cloudflare 免费额度内。第三方 OpenAI、Resend、域名和支付渠道费用不属于 Cloudflare 免费额度。

## 1. 目标与验收口径

### 1.1 目标

- `https://speak-confidently.top` 可由公网匿名访问，不再受 OpenAI Sites `owner-only` 门禁影响。
- 保留现有 `/api/v1/*` REST 语义、错误码、身份模型和分析状态机，减少前端与领域层联动修改。
- 使用 Workers Static Assets 承载 Vite SPA，使用同一 Worker 承载轻量 API。
- 使用 D1 替换本地 JSON/内存持久化，使用 Supabase Storage 替换本地音频文件。
- 使用 Queues 与 Workflows 替换 `setImmediate` 单进程任务队列。
- 支持 Magic Link、Google OAuth、Cookie Session、匿名试用、分析历史和账户删除。
- 初期 Cloudflare 账单保持 `$0/月`，达到护栏时降级或拒绝新任务，不自动切换付费能力。

### 1.2 完成定义

- 公网首页、登录回调和静态资源均正常返回，未登录用户可以进入产品页面。
- Magic Link 与 Google OAuth 在正式域名完成端到端登录，Token/state 均为一次性且过期可控。
- 浏览器不经过 Worker 请求体直接上传音频到 Supabase private bucket；上传凭证只能操作当前任务的单一对象。
- 分析任务可以排队、重试、取消和恢复，重复消息不会重复消耗免费配额或生成重复报告。
- 用户只能读取自己的音频和报告；账户删除会硬删除账户、其 session、同一规范化邮箱的 Magic Link、分析记录及关联 Supabase Storage 对象。未关联账户的 OAuth state 由 Cron 按过期时间清理。
- 免费额度监控与应用层限流已启用；达到 80%/90%/95% 阈值时按本文策略处理。
- 完成常规与 `TZ=UTC` 双轮质量门禁、Cloudflare 本地集成测试、预览环境 E2E 和生产 smoke。

## 2. 边界与硬约束

- 初期不启用 Cloudflare Workers Paid、Containers、Durable Objects Paid 或其他自动产生固定月费的产品。
- 不在 Worker 中执行原生 `ffprobe`、`ffmpeg`、shell 命令或依赖本地持久文件系统的逻辑。
- Worker 不缓冲完整音频，不将音频、完整转写或大型报告写入 Queue/Workflow state。
- Supabase bucket 必须保持 private；server secret 只存在于 Worker，浏览器只接收单对象 signed upload URL。
- 生产密钥只进入 Workers Secrets，不进入 `VITE_*`、Git、日志、D1 或对象元数据。
- 支付未完成 Cloudflare 适配前必须显式关闭，不能使用占位密钥或 Sandbox 配置冒充生产。
- 迁移期间保留 Railway 旧部署作为只读回退，正式验收完成前不删除服务、卷或数据。

## 3. 当前架构差距

| 当前实现 | 问题 | 目标实现 |
| --- | --- | --- |
| OpenAI Sites + `owner-only` | 公网匿名请求返回 401 | Workers Static Assets +公开自定义域名 |
| Sites Worker 代理 `API_ORIGIN` | 强依赖外部后端 | Worker 内部直接路由 API |
| `PersistentStore` JSON 快照 | 无共享事务且依赖磁盘 | D1 Repository/Store adapters |
| `LocalObjectStore` | 依赖本地目录 | Supabase private Storage |
| `AnalysisRunner` + `setImmediate` | 进程退出即丢失任务 | Queue 消息 + Workflow 状态 |
| 上传 API 接收完整 bytes | 占用 Worker CPU/内存 | Supabase 单对象 signed upload 直传 |
| 生产 `ffprobe` | Workers 无原生进程 | 受限格式 + 轻量解析/STT 元数据复核 |
| Node `http.Server` | 无法原样运行在 Worker | Fetch API Router adapter |
| 生产配置强制 Waffo | 免费 Beta 无法关闭支付 | 显式 `PAYMENTS_ENABLED=false` |

## 4. 目标架构

```text
Browser
  │
  ├── GET /assets/* ───────────────> Workers Static Assets
  ├── /api/v1/auth/* ──────────────> Worker API ──> D1 / Google / Resend
  ├── POST /analyses ──────────────> Worker API ──> D1
  ├── POST /audio-upload ──────────> Worker API ──> Supabase signed upload URL
  ├── PUT signed URL ──────────────> Supabase private Storage
  └── POST /audio-complete ────────> Worker API ──> D1 ──> Queue
                                                         │
                                                         ▼
                                                   Analysis Workflow
                                                  ├── Storage 元数据/读取
                                                  ├── OpenAI STT
                                                  ├── 本地 Feedback 引擎（未来可替换为 Provider）
                                                  └── D1 + Storage 结果
```

### 4.1 Cloudflare 资源

- Worker：`speechoptimizer-web`，同时处理静态资源与同源 API。
- D1：`speechoptimizer-production`，保存业务关系数据和小型分析结果。
- Supabase Storage：Preview `speechoptimizer-preview-audio`、Production `speechoptimizer-production-audio`，保存原始音频；bucket 保持 private。
- Queue：`speechoptimizer-analysis`，只传递 `analysisId`、`attempt` 和事件版本。
- Dead Letter Queue：`speechoptimizer-analysis-dlq`，保存耗尽重试次数的任务引用。
- Workflow：`SpeechAnalysisWorkflow`，编排转写、反馈、持久化和清理。
- Secrets：Google、Resend、OpenAI、Cookie/Token 签名和未来支付密钥。
- Turnstile：保护 Magic Link、Google OAuth 启动和匿名分析入口。

## 5. 数据与一致性设计

### 5.1 D1 最小表

| 表 | 关键字段与约束 |
| --- | --- |
| `users` | `id` PK，`email_normalized` UNIQUE，provider subject 可唯一 |
| `sessions` | `token_hash` PK，`user_id` FK，`expires_at`，不得保存明文 Token |
| `magic_links` | `token_hash` PK，`used_at`，`expires_at`，条件更新保证单次消费 |
| `oauth_states` | `state_hash` PK，`redirect_uri`，`expires_at`，消费后删除 |
| `anonymous_trials` | `anonymous_id` PK，`consumed_at`，防止重复试用 |
| `analyses` | owner、状态、attempt、storage key、大小、MIME、时长、错误和时间戳 |
| `idempotency_keys` | owner + key UNIQUE，保存 fingerprint 与 analysis id |
| `analysis_events` | append-only 状态与审计事件，`event_id` PK |
| `quota_counters` | 匿名、账户与全站日限额的唯一当前 Beta 配额模型 |
| `grants/holds/ledger` | 未来支付启用时的权益授予、预占、确认/释放与不可变流水；免费 Beta 不读写这些表 |
| `orders/subscriptions/refunds` | 支付开启后迁移；免费 Beta 不创建业务记录 |
| `webhook_events` | provider event id UNIQUE，保证跨实例幂等 |

### 5.2 一致性规则

- 所有时间以 UTC ISO 字符串或 Unix 毫秒保存，测试同时覆盖 `TZ=UTC`。
- 状态迁移使用条件 SQL：`UPDATE ... WHERE status = ?`，受影响行数必须为 1。
- Magic Link 使用条件更新消费，重复请求返回稳定的 `MAGIC_LINK_USED`。
- 免费 Beta 只使用 `quota_counters` 的条件更新与任务状态/审计事件保证幂等；支付启用后才在独立设计中加入 holds/ledger/grants 的 reserve/confirm/release 事务与补偿。
- Queue 消费者必须按 `analysisId + attempt` 去重；旧 attempt 消息直接确认并忽略。
- Storage 删除采用幂等语义；D1 已删除而对象残留时由定时清理任务回收。

## 6. API 调整

现有查询、认证、账户、计费和报告 API 尽量保持不变。音频上传改为三段式：

1. `POST /api/v1/analyses`：创建任务并返回 `analysisId`。
2. `POST /api/v1/analyses/:id/audio-upload`：校验身份、配额与任务状态，返回单对象短期上传 URL、对象 Key、大小和 MIME 约束。
3. 浏览器直接 `PUT` 到 Supabase signed upload URL。
4. `POST /api/v1/analyses/:id/audio-complete`：服务端读取 Storage `info` 与 4 字节 Range，核对 Key、大小、MIME、SHA-256 元数据、WebM 魔数和所有权，然后将状态改为 `uploaded` 并入队。

旧 `PUT /api/v1/analyses/:id/audio` 在迁移期仅用于本地测试；生产 Worker 返回迁移提示，前端切换完成后移除。

## 7. 音频与免费层策略

### 7.1 首版输入约束

- 单文件上限从 25 MiB 收紧为 10 MiB，最大时长建议 5 分钟。
- 首版优先只允许产品录音器稳定生成的 WebM/Opus；MP3、M4A、WAV 在完成轻量解析验证后逐步开放。
- 浏览器提供时长只能用于 UX 预检，不能作为最终计费依据。
- Worker 校验对象大小、扩展名、声明 MIME 与文件魔数；STT 返回的可用元数据用于二次核对。
- 若无法在 10ms CPU 内可靠验证时长，匿名试用按最大允许时长预占，任务完成后再按可信结果结算。

### 7.2 Supabase Storage 生命周期

- 匿名音频：分析成功后立即删除，失败后最多保留 24 小时。
- 注册用户默认不保留音频；用户显式保留时最多 3 天，后续是否延长另行决策。
- 分析报告优先保存紧凑 JSON；当前音频对象由应用 Cron/D1 状态驱动清理，不依赖 Provider 生命周期规则。
- 匿名/非保留音频完成后立即删除；失败最多保留 24 小时；显式保留最多 3 天。应用默认在 800 MiB 停止新上传，并另行观察 Supabase Storage/egress Usage。

## 8. 免费额度护栏

| 指标 | 免费额度 | 应用警戒值 | 达到警戒值后的动作 |
| --- | ---: | ---: | --- |
| Worker 动态请求 | 100,000/天 | 80,000 | 关闭匿名分析，保留登录和报告读取 |
| Worker CPU | 10ms/调用 | P95 8ms | 停止放量并优化，不依赖偶发宽容 |
| D1 读取 | 5,000,000 行/天 | 4,000,000 | 降低轮询、强制索引查询 |
| D1 写入 | 100,000 行/天 | 80,000 | 限制新任务，保留状态完成写入 |
| D1 存储 | 5 GB | 4 GB | 清理过期 Token、Session、事件和大结果 |
| Supabase Storage | Free 约 1 GB | 800 MiB 应用硬护栏 | 停止上传并执行到期清理 |
| Queue 操作 | 10,000/天 | 8,000 | 降低新任务额度，禁止无界重试 |
| Workflow 步骤 | 3,000/天 | 2,400 | 暂停匿名任务，缩短流程步骤 |

默认产品配额：匿名用户 1 次/天、注册用户 3 次/天、全站 50 次/天、任务最多重试 2 次。运营确认余量后再逐步调高。

## 9. 分阶段实施计划

### Phase 0：可行性 Spike 与决策冻结

- 使用真实 1/5/10 MiB WebM 样本测量 Worker CPU、内存和 STT 上传方式。
- 验证 Supabase signed upload、private bucket、对象 info/Range、读取与删除。
- 验证 D1 条件更新、batch 原子性、Magic Link/OAuth state 并发消费。
- 验证 Queue/Workflow 在 Free 计划的 CPU 与步骤消耗。
- 冻结媒体时长可信来源和支付首版是否关闭。

Gate：10 MiB 样本的 API 与任务步骤均不持续超过 Free CPU 限制；否则选择 Workers Paid 或缩小产品能力，不能带风险进入后续阶段。

### Phase 1：Cloudflare 应用骨架

- 新增 `apps/cloudflare-worker/`：Wrangler 配置、Fetch Router、bindings、环境类型和结构化日志。
- 复用 `prototype/` 构建产物，通过 Static Assets binding 提供 SPA fallback。
- 建立 local/preview/production 三套资源名称，Preview 禁止访问 Production D1/Storage/Secrets。
- 增加 `/health`，仅返回版本、环境、依赖可用性，不泄露绑定或密钥。

Gate：本地 Miniflare 与 Preview 可返回首页、SPA 路由、JSON 404/405 和健康检查。

### Phase 2：D1 与真实认证

- 新增 SQL migrations 与 D1 adapters，保持领域服务接口，不在路由层直接散落 SQL。
- 将 Node `crypto` 哈希与随机数替换为 Web Crypto/`crypto.randomUUID()` 兼容实现。
- 迁移 Magic Link、Google OAuth、Session Cookie、匿名身份和账户删除。
- 接入 Turnstile、邮箱/IP 限流、重定向 Origin allowlist 和 Cookie 安全属性。
- 新增 `PAYMENTS_ENABLED=false`，使免费 Beta 在支付明确关闭时可以生产启动。

Gate：认证并发、重放、过期、CSRF/redirect、Cookie、禁用账户和删除数据测试全部通过。

### Phase 3：Supabase Storage 直传与分析仓储

- 新增 provider-neutral Storage adapter；Preview/Production 使用 Supabase Storage，本地 Miniflare 使用 R2 binding 测试后端。
- 修改前端 `resources.uploadAudio` 为申请 URL、直传、完成确认三步。
- 将 Analysis Repository、幂等键、状态事件和历史查询迁入 D1。
- 实现对象所有权、大小、魔数、校验和、取消、删除及生命周期清理。

Gate：跨用户访问被拒绝；重复完成、篡改 Key、超限文件和孤儿对象均有自动化测试。

### Phase 4：Queue/Workflow 分析链

- 用 Queue 替换 `AnalysisRunner.schedule()`，生产环境不再调用 `setImmediate`。
- Workflow 分离校验、转写、反馈、持久化和清理步骤；支付权益确认属于未来支付启用范围。
- 外部 OpenAI STT 请求配置超时、有限重试、幂等键和稳定错误映射；当前反馈由本地引擎生成，未来接入反馈 Provider 时复用同一约束。
- DLQ 仅保存任务引用；后台管理页展示失败原因并支持受控重试。

Gate：重复消息、乱序消息、Worker 重启、Provider 超时、取消竞态和重试耗尽均保持正确状态与免费配额；支付权益不属于免费 Beta Gate。

### Phase 5：公网切换与下线旧链路

- 在 Preview 完成完整 E2E，再部署 Production Worker。
- 将 `speak-confidently.top` 绑定为公开 Worker Custom Domain，并验证 TLS/DNS。
- 同步 Google OAuth、Magic Link、Resend、CORS/redirect 和 Waffo（若启用）正式域名。
- 先以小流量和每日 50 次任务限额运行 72 小时，再决定是否提高配额。
- 稳定期结束后停止 OpenAI Sites 代理和 Railway 写流量；备份确认后另行授权删除。

Gate：首页公网 200、真实登录成功、完整分析成功、账户删除成功、免费额度监控无异常。

## 10. 预计文件影响范围

- 新增：`apps/cloudflare-worker/**`、D1 migrations、Cloudflare bindings 与集成测试。
- 新增：`apps/cloudflare-worker/src/storage/**`，承载 provider-neutral Storage adapter；D1/Queue/Workflow 仍在 Worker 应用内按现有模块边界实现。
- 修改：`services/account-billing/**`，将同步 Map 操作抽象为异步 Store port。
- 修改：`services/core-platform/**`，适配直接上传完成确认与异步任务边界。
- 修改：`prototype/src/api/resources.js`、上传流程和相关测试。
- 修改：`scripts/quality-gate.mjs` 与 CI，加入 Worker 类型检查、迁移校验和 Miniflare 测试。
- 修改：`docs/DEPLOYMENT.md`，在生产切换后将 Railway/OpenAI Sites 标记为历史路径。
- 暂不删除：`apps/mvp-server/**`、Dockerfile、Railway 配置和现有适配器，直到回滚窗口结束。

## 11. 测试与验收矩阵

- 单元测试：领域状态机、哈希/Token、配额、Storage Key、错误映射和状态转换。
- D1 集成：唯一约束、并发消费、幂等、分页、级联删除和 migration rollback/forward。
- Supabase Storage 集成：signed upload、跨用户拒绝、大小/MIME/SHA-256 不符、重复完成、私有读取、删除和生命周期清理。
- Queue/Workflow：至少一次投递、重复/乱序、超时、重试、DLQ、取消和恢复。
- 安全：开放重定向、Cookie、CSRF、Token 重放、路径穿越、对象越权和日志脱敏。
- 前端 E2E：首页、匿名试用、Magic Link、Google OAuth、录音上传、结果、历史和删除账户。
- 生产 smoke：公网 200、`/health`、真实邮件、OAuth 回调、一次短音频分析和 Supabase Storage 清理。
- 完成门禁：`CI=1 node scripts/quality-gate.mjs all --require-feature-tests` 与 `CI=1 TZ=UTC ...` 均通过。

## 12. 发布、回滚与运维

- 每次发布固定 commit SHA，先 Preview 后 Production，不允许直接在 Dashboard 修改业务代码。
- D1 migration 采用向前兼容的 expand/migrate/contract；切换期间旧服务和新 Worker 可读取兼容数据。
- Worker 发布失败使用版本回滚；DNS 不作为日常版本回滚手段。
- 分析链异常时进入维护模式：停止新上传，允许登录、历史和报告读取。
- 每日检查 Worker 请求/CPU、D1 rows、Queue ops、Workflow steps、Supabase Storage/egress 和错误率。
- 日志默认采样；认证、支付、账户删除和状态终结事件保留必要审计但不得记录 Token、Cookie、音频或密钥。
- Railway 只在新架构完成 72 小时稳定运行、备份可恢复且 owner 明确授权后下线。

## 13. 主要风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Free Worker 10ms CPU 不足 | 请求被 1102 终止 | Phase 0 实测、精简依赖、浏览器直传对象存储；失败则付费或缩减能力 |
| 无 `ffprobe` | 时长/格式不可信 | 限定录音格式、轻量解析、STT 元数据复核、最大时长预占 |
| D1 Store 异步化影响面大 | 账户/计费回归 | 先定义 port 与契约测试，再逐服务替换 |
| Queue 至少一次投递 | 重复分析/扣费 | attempt + 条件状态更新 + 权益幂等引用 |
| Supabase Free Storage/egress 接近额度 | 产生费用、限流或上传失败 | 800 MiB 应用硬护栏、短保留、Cron 清理、全站配额和 Dashboard Usage 告警 |
| 第三方 API 费用失控 | 总成本不再为零 | 用户配额、Token/时长上限、预算告警和 Provider 熔断 |
| 公网开放后滥用 | 邮件、AI 与存储耗尽 | Turnstile、邮箱/IP/用户限流和匿名功能降级 |

## 14. 工期与里程碑

- Phase 0：1～2 个工作日。
- Phase 1～2：3～6 个工作日。
- Phase 3～4：4～8 个工作日。
- Phase 5 与稳定观察：3～5 个工作日，其中稳定观察至少 72 小时。
- 单人生产级改造预计 2～4 周；若 Phase 0 证明 Free CPU 不可行，应立即停止并重新评估付费 Workers，而不是继续堆叠规避代码。

## 15. 实施前必须确认的决策

1. 免费 Beta 是否明确关闭 Waffo 支付，还是支付必须随首版上线。
2. 原始音频默认保留 0、1 或 3 天；本文推荐成功后立即删除、失败保留 24 小时。
3. 首版是否只支持 WebM/Opus；本文推荐先单格式上线。
4. 免费层 CPU Spike 失败时，是接受 Workers Paid `$5/月`，还是继续缩减能力。
5. 是否存在必须从 Railway 导入的真实用户/任务/权益数据；若当前仅为 Mock 数据则不导入。

## 16. 官方约束参考

- Workers Limits：<https://developers.cloudflare.com/workers/platform/limits/>
- Workers Static Assets：<https://developers.cloudflare.com/workers/static-assets/>
- D1 Pricing：<https://developers.cloudflare.com/d1/platform/pricing/>
- Supabase Storage Access Control：<https://supabase.com/docs/guides/storage/security/access-control>
- Supabase Signed Upload URL：<https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl>
- Supabase Pricing：<https://supabase.com/pricing>
- Queues Pricing：<https://developers.cloudflare.com/queues/platform/pricing/>
- Workflows Pricing：<https://developers.cloudflare.com/workflows/reference/pricing/>
- Turnstile Plans：<https://developers.cloudflare.com/turnstile/plans/>

## 17. Phase 1 最终整改进度

> 更新时间：2026-09-05（Asia/Shanghai）
> 当前结论：Phase 1 已完成。2026-09-05 常规与 `TZ=UTC` 双轮全量质量门禁均通过；固定 commit `ec7eef7fce7e3bf16a34ece080c22be16e3019f5` 已部署到 `speechoptimizer-web-preview`。同日重新执行正式 Preview HTTP smoke：`/` 与 `/history` 返回 HTML `200`，`/health` 返回 JSON `200`，`POST /health` 返回 JSON `405`，未知 `/api/v1/*` 返回 JSON `404`。该结果只关闭 Phase 1 Static Assets/Router Gate，不代表当前工作树中的 D1、Storage、Queue、Workflow、Cron 或 Provider 已在线上生效。

### 17.1 已整改完成

- 已新增 `apps/cloudflare-worker/`，形成独立 Worker 应用骨架与 pnpm 锁文件。
- 已配置 `local`、`preview`、`production` 三套 Worker 名称与资源命名空间，Preview 不复用 Production D1/R2/Secrets。
- 已复用 `prototype/dist/client` 作为 Workers Static Assets 目录，并启用 SPA fallback。
- 已实现 Fetch Router、环境类型、结构化 JSON 日志与稳定 JSON 错误响应。
- 已实现 `/health`，仅返回版本、环境和依赖可用性，不输出 binding 名称、secret 或内部目标。
- 已实现 `/health` 方法限制与 `/api/*` 未实现路由的 JSON 405/404 契约。
- 已将 Cloudflare Worker `check`、`test`、`build` 接入 `scripts/quality-gate.mjs` 的 `cloudflare`/`all` 门禁。
- 已增加 Worker 定向测试并完成 simplify 自检，本轮未扩大到 Phase 2 的 D1/认证实现。

### 17.2 已有验证证据

- `pnpm --dir apps/cloudflare-worker run check`：通过。
- `pnpm --dir apps/cloudflare-worker run test`：4/4 通过。
- `prototype` 生产构建：通过，Wrangler 能读取 `prototype/dist/client` 静态产物。
- `wrangler deploy --env preview --dry-run`：通过；当前 Preview dry-run 仅暴露 `ASSETS` 与非敏感环境变量。
- 本地 Wrangler/Miniflare 实测：`/` 200、`/history` 200 SPA fallback、`/health` 200 JSON、`POST /health` 405 JSON、未知 `/api/v1/*` 404 JSON。
- `CI=1 node scripts/quality-gate.mjs all --require-feature-tests`：通过。
- `CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests`：通过。
- `wrangler deploy --temporary --env preview --var APP_VERSION:ff551f1-dirty`：临时远程账号部署成功，Worker Version ID `edaa158b-bccf-4b81-99ce-94c28a830755`，Static Assets 4 个文件上传成功；该临时地址随后从当前网络访问 `/`、`/history`、`/health`、POST `/health` 和未知 `/api/v1/*` 均被 Cloudflare 1010 返回 403，因此该证据只证明远程构建/上传成功，不能替代正式 Preview smoke。
- `wrangler whoami`：已登录目标账号，OAuth token 明确包含 `workers_scripts (write)` 等 Workers 写权限。
- `pnpm exec wrangler deploy --env preview --var APP_VERSION:ff551f1+dirty.e4dd4f18e2dd`：正式目标账号部署成功，4 个 Static Assets 上传成功，Worker Version ID `e195ac3e-fe03-414a-b1de-24e981596d2d`，发布地址为 `speechoptimizer-web-preview.<account-subdomain>.workers.dev`。
- Cloudflare API 正式账号复核：`speechoptimizer-web-preview` 已存在，`has_assets=true`、`has_modules=true`、`last_deployed_from=wrangler`；deployment `6ddf58b1-b60c-4277-a78d-a13666275814` 将 Version ID `e195ac3e-fe03-414a-b1de-24e981596d2d` 以 100% 流量部署。
- Git checkpoint：Cloudflare Phase 1 源码、质量门禁和迁移文档已提交为 `ec7eef7fce7e3bf16a34ece080c22be16e3019f5`（`feat(cloudflare): bootstrap free-tier preview worker`）；任务外 `AGENTS.md` 删除未被暂存或提交。
- 固定版本正式重发：以 `APP_VERSION=ec7eef7fce7e3bf16a34ece080c22be16e3019f5` 执行 `wrangler deploy --env preview` 成功；Static Assets 无变化无需重复上传，最新 Worker Version ID 为 `d58d696d-9175-4e56-a3d1-52a7d36039af`。
- Cloudflare API 最新 deployment 复核：deployment `529f142d-bc1d-40bf-85be-6791fffb2361` 将 Version ID `d58d696d-9175-4e56-a3d1-52a7d36039af` 以 100% 流量部署。
- 固定 commit 后再次执行 `CI=1 node scripts/quality-gate.mjs cloudflare`：`check`、4/4 路由测试和 Preview dry-run 全部通过；dry-run 仍只显示 `ASSETS`、`APP_ENV=preview`、`APP_VERSION=preview`、`RESOURCE_NAMESPACE=speechoptimizer-preview`，未出现 D1/R2/Secrets 绑定。
- 正式 Preview HTTP smoke：2026-09-05 经当前可达网络复核，`/` 与 `/history` 返回 HTML `200`，`/health` 返回 JSON `200`，`POST /health` 返回 JSON `405`，未知 `/api/v1/*` 返回 JSON `404`；`/health` 的 `APP_VERSION` 为固定 commit `ec7eef7fce7e3bf16a34ece080c22be16e3019f5`。
- `git diff --check`：通过。

### 17.3 Phase 1 关闭与后续边界

1. Phase 1 的固定 commit、正式 Preview 部署和远程 HTTP smoke 已全部完成。
2. Preview 与 Production 的 D1、Storage、Queue、Workflow 和 Secrets 继续保持物理隔离；Phase 1 线上版本仍是基础 Router/Assets 版本。
3. 现有 Sites + Railway Demo/Mock 继续作为迁移回退路径，Cloudflare Production 稳定运行 72 小时且 owner 明确授权前不得下线或删除。

当前阻塞已转移到 Phase 2～5 的真实远程 Gate：D1 migration、Worker secrets、Supabase/Workflow/OpenAI E2E、Free CPU/完整性 Spike、Production 部署与公网切流。

### 17.4 Phase 2 启动条件

Phase 1 远程 Preview Gate 已完成，Phase 2～4 已进入本地实现与验收阶段。当前不得跳过 Preview 真实功能 E2E 直接进入 Production。

### 17.5 2026-09-05 Phase 2～4 实施与验收 checkpoint

Phase 2～4 已在当前工作树完成主要实现，并于 2026-09-05 将生产对象存储从 R2 pivot 到 Supabase Storage：D1 migrations/repository、Web Crypto、Magic Link/Google OAuth/Session/匿名身份、Turnstile 校验、邮箱/IP 限流、provider-neutral Storage adapter、Supabase 单对象 signed upload、对象 info/大小/MIME/SHA-256 元数据/4 字节 EBML 魔数校验、Queue + Workflow 状态链、可信 STT 时长二次校验、取消/重试、应用 Cron 生命周期清理、历史/比较/账户删除和 `PAYMENTS_ENABLED=false` 边界均已落盘。账户删除已改为分页清理，超过 100 条分析也会完整删除关联 Storage 对象；重复 `audio-complete` 只允许与已确认对象完全一致，第二次篡改对象 Key/大小/MIME/SHA-256 会返回冲突。匿名体验继续使用可信 STT 时长限制 60 秒，注册账户上限 5 分钟。

免费额度护栏采用“Cloudflare Usage/Analytics + Supabase Dashboard Usage 作为事实源 + Worker 应用降级开关”的分工。Worker 不从请求路径调用平台管理 API，也不把自建 D1 计数冒充平台计费指标。运营按 Worker requests/CPU、D1 rows/storage、Queue ops、Workflow steps 与 Supabase Storage/egress 的实际用量提升 `FREE_TIER_GUARD_LEVEL`：`80` 暂停匿名分析，`90` 暂停新分析，`95` 进一步暂停新上传；登录、历史和报告读取保持可用。应用 `STORAGE_LIMIT_BYTES` 默认 800 MiB，给 Supabase Free 约 1 GB Storage 留出余量。

远程资源已经确认：SpeechOptimizer Supabase project `qnmxxvnypmfzwclyyfhr`、private bucket `speechoptimizer-preview-audio`、private bucket `speechoptimizer-production-audio` 与 `SUPABASE_URL` 均已就绪；两个 bucket 均限制单对象 10 MiB 且只允许 `audio/webm`。Preview/Production D1 已应用 `0001`、`0002_audio_checksum.sql`，当前待应用 `0003`～`0006`。Preview/Production Queue 与 DLQ 已创建，但 producer/consumer 仍为 `0`；Preview Turnstile Managed widget、Preview `TURNSTILE_SECRET_KEY` 与 Preview/Production `TURNSTILE_SITE_KEY` 均已就绪。当前仍缺 Worker server secret（`SUPABASE_SECRET_KEY` 或兼容 `SUPABASE_SERVICE_ROLE_KEY`）与 `OPENAI_API_KEY`；Production Worker 尚不存在。

本轮验证证据：

- `CI=1 node scripts/quality-gate.mjs all --require-feature-tests`：全部通过。
- `CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests`：全部通过。
- `pnpm --dir apps/cloudflare-worker run test`：43/43 通过，覆盖唯一上传 ticket、真实字节容量预占、Queue outbox 补投、最终 delivery 失败持久化、管理员受控重试、流式 STT、认证与日志脱敏。
- `pnpm --dir apps/cloudflare-worker run check`：通过。
- `pnpm --dir apps/cloudflare-worker run types:check` 与 `types:check:production`：通过；Wrangler generated types freshness 已进入 `check`。
- `wrangler deploy --env preview --dry-run`：通过，Preview 只解析 Workflow、Queue、D1、Supabase Storage vars 与 Static Assets，不再出现 R2 binding。
- `git diff --check`：通过。

原 Cloudflare R2 账号级 `10042` blocker 已因 Supabase pivot 被移出当前路径。当前真实远程 Gate 的缺口是 Worker server secret、真实 OpenAI API key、远端 D1 `0003`～`0006`、真实 Supabase/Workflow/OpenAI 流式 E2E，以及 10 MiB Free CPU/完整性 Spike。这些外部前置未完成前，只能完成本地契约与 Preview dry-run，不能把它写成真实 Supabase E2E。

后续正式验收顺序：先复核并应用 Preview D1 全部待迁移项（当前为 `0003`～`0006`），将真实 `SUPABASE_SECRET_KEY`（或兼容期 `SUPABASE_SERVICE_ROLE_KEY`）与 `OPENAI_API_KEY` 写入 Preview Worker Secret；重新部署 Preview，执行真实 Magic Link/Google OAuth、唯一 signed upload、短音频流式 STT、Queue/DLQ/管理员恢复、历史/删除/账户删除/Cron E2E，并测量 1/5/10 MiB 样本 CPU/内存。Preview 全部通过后才允许为 Production 写入独立 secrets 并部署，旧 Sites + Railway 回退链继续保留至少 72 小时。

因此当前不能把“所有迁移任务已最终远程验收”标记为完成：Supabase pivot 的代码、单测、类型检查和 Preview 配置已具备继续上线条件，但 Phase 3 的真实 Supabase Storage Gate、Phase 4 的真实 Provider E2E 与 Phase 5 公网切换仍依赖上述外部项目、bucket 和生产凭证。

### 17.6 2026-09-05 实施侧远程资源复核（历史 checkpoint）

本轮以 Cloudflare OAuth、Wrangler 和已连接的 Supabase 项目为事实源复核。Supabase project `qnmxxvnypmfzwclyyfhr` 为 `ACTIVE_HEALTHY`，URL 与 Wrangler vars 一致；迁移 `20260905050017_create_speechoptimizer_audio_buckets` 已存在。private bucket `speechoptimizer-preview-audio`、`speechoptimizer-production-audio` 均已存在，`public=false`、单对象上限 `10485760`、允许 MIME 仅为 `audio/webm`。

该 checkpoint 当时确认 Cloudflare Preview/Production D1 已应用 `0001`、`0002_audio_checksum.sql`，本地仅有 `0003_analysis_pagination_and_retention.sql` 尚待远端应用；后续已新增 `0004`～`0006`，因此当前待应用列表以 17.9 为准。Preview/Production 的四个 Queue（业务 Queue 与 DLQ）都已存在，但 Queue producer/consumer 仍为 `0`，Cloudflare Workflow 列表为空。Preview 当时的 100% deployment 为 `6ddf58b1-b60c-4277-a78d-a13666275814`，目标 Version `e195ac3e-fe03-414a-b1de-24e981596d2d` 仅含 Fetch/Assets 和旧的基础 vars；它没有 D1、Queue、Workflow、Supabase Storage 或 Cron 配置。后续仅由 secret 更新产生的 Version 也没有这些应用资源绑定。因此当前工作树中的 Phase 2～4 资源配置尚未实际部署，不能把 Queue/Workflow/Cron 或真实 Storage 流程写作线上已生效。

Preview 已有 `TURNSTILE_SECRET_KEY`；Preview/Production 均已写入非敏感 `TURNSTILE_SITE_KEY`。仍未发现 `SUPABASE_SECRET_KEY` 或兼容的 `SUPABASE_SERVICE_ROLE_KEY`，也没有 `OPENAI_API_KEY`。Production Worker `speechoptimizer-web` 尚不存在，因而不能设置或核验其 secrets。实施侧已检查工作区 dotenv、常见本机 Keychain 服务项和已连接 Supabase connector；connector 只暴露 publishable key 读取，未暴露 server/service-role key。publishable key 没有、也不会被当作 server secret 使用。

该 checkpoint 的外部 Gate 当时包括 Preview Supabase server/service-role key、OpenAI API key 与远端 D1 `0003`；后续新增 migration 后，当前远端 D1 Gate 已扩展为 `0003`～`0006`。这些前置完成后，先以已审核工作树重新部署 Preview，部署会创建并绑定 Queue consumer、Workflow 与 Cron；随后才执行 signed upload、对象 info/Range、短音频 Workflow/STT、历史/删除/账户删除和 Cron 清理 E2E。Production 保持未创建、未切流，直到 Preview E2E 通过并具备独立 Production secrets。

### 17.7 2026-09-05 验收审查 C 高优先级纠偏（历史 checkpoint）

本轮补齐匿名与并发边界。匿名 `POST /analyses` 现在必须携带并通过 Turnstile token，同时以 IP 摘要限流；前端会在匿名点击分析前获取 token，并在消费后重置。Google OAuth start 改为 `POST` JSON body，Turnstile token 不再进入 URL、Referer 或访问日志；Google start 同样实施 IP 限流。

账户删除会撤销 session、删除同一规范化邮箱的未消费/历史 Magic Link、删除分析与关联对象，然后硬删除用户。OAuth state 在授权前不含用户标识，不能安全地按账户猜测删除；所有过期 OAuth state 由 Cron 清理。分析事件会随分析外键级联删除，因此免费 Beta 不保留可重识别的账户审计历史；未关联账户的 `analysis_events` 与 provider `webhook_events` 只保留 30 天，认证 session、已消费或过期 Magic Link、过期 OAuth state 都在 Cron 中删除并输出汇总日志。

`listOwned` 改用 `created_at + id` 复合游标与同序索引，确保同一时间戳下的 150+ 条账户分析会完整分页清理。用户创建与 analysis idempotency 创建都在唯一键冲突后重读赢家；Queue 遇到同一 Workflow ID 已存在会写结构化信息日志并 ack，不进入 retry/DLQ。前端与 Worker 首版约束统一为 WebM/Opus、最多 10 MiB；前端不再声明 MP3/WAV/M4A 支持。

免费 Beta 明确 `PAYMENTS_ENABLED=false`：当前分析仅由匿名/账户日限额和免费层护栏控制，不创建、预占、确认或释放 `holds/ledger/grants`。这些未来支付表不属于本阶段 Gate；若未来启用权益扣减，必须在单独设计中实现 reserve/confirm/release 一致性并补偿失败路径。

### 17.8 2026-09-05 Turnstile 外部前置收口（历史 checkpoint）

Cloudflare OAuth 已确认具备 `challenge-widgets.write`，账户原有 Turnstile widget 列表为空。官方 Free 计划允许最多 20 个 widget，因此已创建一个不产生付费资源的 Managed widget；其 hostname 仅为 `speechoptimizer-web-preview.bb382978203.workers.dev` 与 `speak-confidently.top`，未新增或切换任何域名。

公开 site key 已写入 Preview/Production 的 `TURNSTILE_SITE_KEY` 非敏感 var，以供 Worker `/health` 返回给前端渲染；验证密钥仅通过 `wrangler secret put TURNSTILE_SECRET_KEY --env preview` 写入 Preview Worker Secret，写入成功且从未进入仓库、文档、日志或 Production。Production Worker 未创建、未写 secret、未部署。

重新核对后，已连接 Supabase connector 只提供 publishable key 读取能力，没有能合法读取 server/service-role key 的接口；publishable key 未被当作 server secret 使用。工作区 dotenv 和常见本机 Keychain 服务项也未发现可用 `OPENAI_API_KEY`。真实 Preview 的外部凭证 Gate 因此收敛为 Worker `SUPABASE_SECRET_KEY`（或兼容 `SUPABASE_SERVICE_ROLE_KEY`）与 `OPENAI_API_KEY`；两者具备并应用远端全部待迁移项后，才重新部署 Preview，并由独立测试侧执行 Storage、Workflow/STT、删除和 Cron E2E。

### 17.9 2026-09-05 主控验收与未完成任务（当前最新）

本轮以子代理分工完成 Worker、前端、部署手册和质量门禁纠偏。Worker 新增 `0005_upload_tickets_and_dispatch_recovery.sql` 与 `0006_dlq_admin_recovery.sql`：同一分析只复用一个 D1 持久化上传 ticket，容量按声明 bytes 原子预占；`uploaded` 作为持久化 outbox，首次 `Queue.send()` 失败可由重复 `audio-complete`、重试或 Cron 补投；Queue 最终 delivery 失败会先把稳定错误码、失败阶段和时间写入 D1，再让引用进入 DLQ。管理员页面只展示失败分析并调用受权限、可重试性、音频存在和 attempt 上限约束的恢复 API，不迁移免费 Beta 已关闭的支付管理面。

生产 STT 已改为 `Supabase Response.body -> multipart ReadableStream -> OpenAI`，不再通过 `ArrayBuffer` 或 `File` 缓冲完整音频。流在结束时核对实际字节数与 D1 已确认大小；`audio-complete` 仍只比较对象 metadata 中的 checksum 声明，没有服务端重新计算内容 SHA-256，因此内容完整性与纯 JavaScript 流式哈希的 CPU 成本必须在 Phase 0/Preview Spike 中继续验证。Cloudflare `FixedLengthStream` 的真实出站行为也只能由 Preview 短音频 E2E 关闭。

本次主控复验已完成，以下均为可追溯的本地证据：

- Preview `pnpm --dir apps/cloudflare-worker run dry-run`：exit `0`；Wrangler `4.129.0` dry-run 读取 5 个静态资源并以 `--dry-run: exiting now.` 结束，未执行部署。
- 全新 `mktemp -d` 临时持久化目录中的本地 D1 使用锁定 Wrangler `4.129.0`，显式通过 `--local`/`--persist-to`、`--env local` 与 `--config ./wrangler.jsonc` 按顺序应用 `0001`～`0006`；`d1_migrations` 为 6 条且 ID 1～6 与迁移文件顺序一致，`migrations list` 返回 `No migrations to apply!`，`PRAGMA foreign_key_check` 为空。临时目录已清理。
- `git diff --check`：exit `0`；该命令不覆盖未跟踪文件。
- `CI=1 node scripts/quality-gate.mjs all --require-feature-tests` 与 `CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests` 均 exit `0`；两轮各 26 个子门禁通过，TAP 测试均为 `223/223`。
- 本地基础设施静态检查与契约测试均通过；未检测到 Compose v2，脚本跳过 `docker compose config`，其余基础设施检查通过。

2026-09-05 远端 D1 迁移执行与复核证据如下：

- Wrangler `4.129.0` OAuth 认证可用。
- Preview `speechoptimizer-preview` 执行 `0003`～`0006` 的 `migrations apply` 首次因 Cloudflare API timeout 失败；随后只放行一次受控重试，四项迁移逐个成功，命令 exit `0`，最终 `migrations list` 返回 `No migrations to apply!`。
- 首次失败后的 post-list 仍显示 `0003`～`0006` 四项待应用；重试完成后的最终列表不再有待应用迁移。Wrangler 输出未显示 backup/bookmark，因此不记录或声称存在备份/书签证据。
- Production `speechoptimizer-production` 仍待应用 `0003`～`0006`；本次没有触碰 Production 的 migration，未执行其 `migrations apply`/`execute`。
- 当前审查工作树对应的 Preview Worker 尚未部署；Preview 仍缺 `SUPABASE_SECRET_KEY`（或兼容 `SUPABASE_SERVICE_ROLE_KEY`）与 `OPENAI_API_KEY`。

上述记录只证明 Preview D1 迁移已完成受控应用与复核，不代表 Secrets 写入、当前 Worker 部署、真实 E2E、Production D1 迁移或 DNS 操作已完成。

交接前已将原 513 行的 `repository.js` 按认证、分析、上传/容量和维护职责拆分为显式组合的领域仓储；当前所有 Worker JavaScript 文件均不超过 300 行。拆分后的 `pnpm --dir apps/cloudflare-worker run check` 与 43/43 Worker 测试已通过；本次主控复验已补齐最终常规/`TZ=UTC` 双轮全量 Gate，但该结果仍只证明本地工作树，不改变外部资源 Gate 的前置条件。

当前未完成任务按顺序固定为（Preview D1 迁移项已从队列移除）：

1. 由 owner 将可撤销的 Preview `SUPABASE_SECRET_KEY`（或兼容 service-role key）与 `OPENAI_API_KEY` 安全写入 Worker Secrets。
2. 以审查后的固定 commit 重新部署 Preview，验证 bindings、Queue consumer、Workflow、Cron 与 `/health`。
3. 执行 Magic Link、Google OAuth、唯一 signed upload、1/5/10 MiB WebM、流式 STT、DLQ/管理员恢复、历史、删除、账户删除和 Cron 清理 E2E；记录 CPU、内存、Storage/egress、D1 rows、Queue ops 与 Workflow steps。
4. Preview Gate 全部通过后，为 Production D1 应用全部待迁移项 `0003`～`0006`；Production 仍须独立执行并留存结果。
5. Production D1 通过复核后，再准备独立 Production secrets、部署 Production Worker、绑定正式域名并执行生产 smoke。
6. 生产小流量运行至少 72 小时后，再由 owner 决定是否提高配额或下线旧 Sites/Railway 回退链。
