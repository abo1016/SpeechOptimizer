# SpeechOptimizer Cloudflare 全栈免费层改造方案

> 状态：Phase 1 本地实现与双轮质量门禁已完成；正式账户 Preview 发布仍受 Cloudflare 认证与固定提交版本约束
> 编制日期：2026-09-05
> 目标：在不使用 Railway、Vercel 和 Cloudflare Container 的前提下，将公开站点、真实认证、音频分析与数据持久化迁移到 Cloudflare 免费额度内。第三方 OpenAI、Resend、域名和支付渠道费用不属于 Cloudflare 免费额度。

## 1. 目标与验收口径

### 1.1 目标

- `https://speak-confidently.top` 可由公网匿名访问，不再受 OpenAI Sites `owner-only` 门禁影响。
- 保留现有 `/api/v1/*` REST 语义、错误码、身份模型和分析状态机，减少前端与领域层联动修改。
- 使用 Workers Static Assets 承载 Vite SPA，使用同一 Worker 承载轻量 API。
- 使用 D1 替换本地 JSON/内存持久化，使用 R2 替换本地音频文件。
- 使用 Queues 与 Workflows 替换 `setImmediate` 单进程任务队列。
- 支持 Magic Link、Google OAuth、Cookie Session、匿名试用、分析历史和账户删除。
- 初期 Cloudflare 账单保持 `$0/月`，达到护栏时降级或拒绝新任务，不自动切换付费能力。

### 1.2 完成定义

- 公网首页、登录回调和静态资源均正常返回，未登录用户可以进入产品页面。
- Magic Link 与 Google OAuth 在正式域名完成端到端登录，Token/state 均为一次性且过期可控。
- 浏览器不经过 Worker 请求体直接上传音频到私有 R2；上传凭证只能操作当前任务的单一对象。
- 分析任务可以排队、重试、取消和恢复，重复消息不会重复扣减权益或生成重复报告。
- 用户只能读取自己的音频和报告；账户删除会清除身份数据、分析记录和 R2 对象。
- 免费额度监控与应用层限流已启用；达到 80%/90%/95% 阈值时按本文策略处理。
- 完成常规与 `TZ=UTC` 双轮质量门禁、Cloudflare 本地集成测试、预览环境 E2E 和生产 smoke。

## 2. 边界与硬约束

- 初期不启用 Cloudflare Workers Paid、Containers、Durable Objects Paid 或其他自动产生固定月费的产品。
- 不在 Worker 中执行原生 `ffprobe`、`ffmpeg`、shell 命令或依赖本地持久文件系统的逻辑。
- Worker 不缓冲完整音频，不将音频、完整转写或大型报告写入 Queue/Workflow state。
- R2 使用 Standard 存储；不使用没有免费额度且存在最短保存期限的 Infrequent Access。
- 生产密钥只进入 Workers Secrets，不进入 `VITE_*`、Git、日志、D1 或 R2 元数据。
- 支付未完成 Cloudflare 适配前必须显式关闭，不能使用占位密钥或 Sandbox 配置冒充生产。
- 迁移期间保留 Railway 旧部署作为只读回退，正式验收完成前不删除服务、卷或数据。

## 3. 当前架构差距

| 当前实现 | 问题 | 目标实现 |
| --- | --- | --- |
| OpenAI Sites + `owner-only` | 公网匿名请求返回 401 | Workers Static Assets +公开自定义域名 |
| Sites Worker 代理 `API_ORIGIN` | 强依赖外部后端 | Worker 内部直接路由 API |
| `PersistentStore` JSON 快照 | 无共享事务且依赖磁盘 | D1 Repository/Store adapters |
| `LocalObjectStore` | 依赖本地目录 | 私有 R2 Object Store |
| `AnalysisRunner` + `setImmediate` | 进程退出即丢失任务 | Queue 消息 + Workflow 状态 |
| 上传 API 接收完整 bytes | 占用 Worker CPU/内存 | R2 单对象预签名直传 |
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
  ├── POST /audio-upload ──────────> Worker API ──> R2 预签名 URL
  ├── PUT signed URL ──────────────> Private R2
  └── POST /audio-complete ────────> Worker API ──> D1 ──> Queue
                                                         │
                                                         ▼
                                                   Analysis Workflow
                                                  ├── R2 元数据/读取
                                                  ├── OpenAI STT
                                                  ├── Feedback Provider
                                                  └── D1 + R2 结果
```

### 4.1 Cloudflare 资源

- Worker：`speechoptimizer-web`，同时处理静态资源与同源 API。
- D1：`speechoptimizer-production`，保存业务关系数据和小型分析结果。
- R2：`speechoptimizer-private`，保存原始音频和超出 D1 合理大小的结果。
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
| `analyses` | owner、状态、attempt、R2 key、大小、MIME、时长、错误和时间戳 |
| `idempotency_keys` | owner + key UNIQUE，保存 fingerprint 与 analysis id |
| `analysis_events` | append-only 状态与审计事件，`event_id` PK |
| `grants/holds/ledger` | 权益授予、预占、确认/释放与不可变流水 |
| `orders/subscriptions/refunds` | 支付开启后迁移；免费 Beta 可以保留空表或延后建表 |
| `webhook_events` | provider event id UNIQUE，保证跨实例幂等 |

### 5.2 一致性规则

- 所有时间以 UTC ISO 字符串或 Unix 毫秒保存，测试同时覆盖 `TZ=UTC`。
- 状态迁移使用条件 SQL：`UPDATE ... WHERE status = ?`，受影响行数必须为 1。
- Magic Link 使用条件更新消费，重复请求返回稳定的 `MAGIC_LINK_USED`。
- 权益预占、任务状态和审计事件在同一 D1 batch/事务边界内提交。
- Queue 消费者必须按 `analysisId + attempt` 去重；旧 attempt 消息直接确认并忽略。
- R2 删除采用幂等语义；D1 已删除而 R2 对象残留时由定时清理任务回收。

## 6. API 调整

现有查询、认证、账户、计费和报告 API 尽量保持不变。音频上传改为三段式：

1. `POST /api/v1/analyses`：创建任务并返回 `analysisId`。
2. `POST /api/v1/analyses/:id/audio-upload`：校验身份、配额与任务状态，返回单对象短期上传 URL、对象 Key、大小和 MIME 约束。
3. 浏览器直接 `PUT` 到 R2。
4. `POST /api/v1/analyses/:id/audio-complete`：服务端 HEAD 对象并核对 Key、大小、校验和和所有权，然后将状态改为 `uploaded` 并入队。

旧 `PUT /api/v1/analyses/:id/audio` 在迁移期仅用于本地测试；生产 Worker 返回迁移提示，前端切换完成后移除。

## 7. 音频与免费层策略

### 7.1 首版输入约束

- 单文件上限从 25 MiB 收紧为 10 MiB，最大时长建议 5 分钟。
- 首版优先只允许产品录音器稳定生成的 WebM/Opus；MP3、M4A、WAV 在完成轻量解析验证后逐步开放。
- 浏览器提供时长只能用于 UX 预检，不能作为最终计费依据。
- Worker 校验对象大小、扩展名、声明 MIME 与文件魔数；STT 返回的可用元数据用于二次核对。
- 若无法在 10ms CPU 内可靠验证时长，匿名试用按最大允许时长预占，任务完成后再按可信结果结算。

### 7.2 R2 生命周期

- 匿名音频：分析成功后立即删除，失败后最多保留 24 小时。
- 注册用户默认不保留音频；用户显式保留时最多 3 天，后续是否延长另行决策。
- 分析报告优先保存紧凑 JSON；超过约定阈值时转存 R2，并在 D1 保存 Key 和摘要。
- 设置生命周期规则与每日孤儿对象清理；R2 使用量达到 8 GiB 时停止新上传。

## 8. 免费额度护栏

| 指标 | 免费额度 | 应用警戒值 | 达到警戒值后的动作 |
| --- | ---: | ---: | --- |
| Worker 动态请求 | 100,000/天 | 80,000 | 关闭匿名分析，保留登录和报告读取 |
| Worker CPU | 10ms/调用 | P95 8ms | 停止放量并优化，不依赖偶发宽容 |
| D1 读取 | 5,000,000 行/天 | 4,000,000 | 降低轮询、强制索引查询 |
| D1 写入 | 100,000 行/天 | 80,000 | 限制新任务，保留状态完成写入 |
| D1 存储 | 5 GB | 4 GB | 清理过期 Token、Session、事件和大结果 |
| R2 存储 | 10 GB-month | 8 GB | 停止上传并执行到期清理 |
| Queue 操作 | 10,000/天 | 8,000 | 降低新任务额度，禁止无界重试 |
| Workflow 步骤 | 3,000/天 | 2,400 | 暂停匿名任务，缩短流程步骤 |

默认产品配额：匿名用户 1 次/天、注册用户 3 次/天、全站 50 次/天、任务最多重试 2 次。运营确认余量后再逐步调高。

## 9. 分阶段实施计划

### Phase 0：可行性 Spike 与决策冻结

- 使用真实 1/5/10 MiB WebM 样本测量 Worker CPU、内存和 STT 上传方式。
- 验证 R2 预签名上传、CORS、私有读取、对象 HEAD 与删除。
- 验证 D1 条件更新、batch 原子性、Magic Link/OAuth state 并发消费。
- 验证 Queue/Workflow 在 Free 计划的 CPU 与步骤消耗。
- 冻结媒体时长可信来源和支付首版是否关闭。

Gate：10 MiB 样本的 API 与任务步骤均不持续超过 Free CPU 限制；否则选择 Workers Paid 或缩小产品能力，不能带风险进入后续阶段。

### Phase 1：Cloudflare 应用骨架

- 新增 `apps/cloudflare-worker/`：Wrangler 配置、Fetch Router、bindings、环境类型和结构化日志。
- 复用 `prototype/` 构建产物，通过 Static Assets binding 提供 SPA fallback。
- 建立 local/preview/production 三套资源名称，Preview 禁止访问 Production D1/R2/Secrets。
- 增加 `/health`，仅返回版本、环境、依赖可用性，不泄露绑定或密钥。

Gate：本地 Miniflare 与 Preview 可返回首页、SPA 路由、JSON 404/405 和健康检查。

### Phase 2：D1 与真实认证

- 新增 SQL migrations 与 D1 adapters，保持领域服务接口，不在路由层直接散落 SQL。
- 将 Node `crypto` 哈希与随机数替换为 Web Crypto/`crypto.randomUUID()` 兼容实现。
- 迁移 Magic Link、Google OAuth、Session Cookie、匿名身份和账户删除。
- 接入 Turnstile、邮箱/IP 限流、重定向 Origin allowlist 和 Cookie 安全属性。
- 新增 `PAYMENTS_ENABLED=false`，使免费 Beta 在支付明确关闭时可以生产启动。

Gate：认证并发、重放、过期、CSRF/redirect、Cookie、禁用账户和删除数据测试全部通过。

### Phase 3：R2 直传与分析仓储

- 新增 R2 Object Store adapter 和预签名上传服务。
- 修改前端 `resources.uploadAudio` 为申请 URL、直传、完成确认三步。
- 将 Analysis Repository、幂等键、状态事件和历史查询迁入 D1。
- 实现对象所有权、大小、魔数、校验和、取消、删除及生命周期清理。

Gate：跨用户访问被拒绝；重复完成、篡改 Key、超限文件和孤儿对象均有自动化测试。

### Phase 4：Queue/Workflow 分析链

- 用 Queue 替换 `AnalysisRunner.schedule()`，生产环境不再调用 `setImmediate`。
- Workflow 分离校验、转写、反馈、持久化、权益确认和清理步骤。
- 外部 Provider 请求配置超时、有限重试、幂等键和稳定错误映射。
- DLQ 仅保存任务引用；后台管理页展示失败原因并支持受控重试。

Gate：重复消息、乱序消息、Worker 重启、Provider 超时、取消竞态和重试耗尽均保持正确状态与权益。

### Phase 5：公网切换与下线旧链路

- 在 Preview 完成完整 E2E，再部署 Production Worker。
- 将 `speak-confidently.top` 绑定为公开 Worker Custom Domain，并验证 TLS/DNS。
- 同步 Google OAuth、Magic Link、Resend、CORS/redirect 和 Waffo（若启用）正式域名。
- 先以小流量和每日 50 次任务限额运行 72 小时，再决定是否提高配额。
- 稳定期结束后停止 OpenAI Sites 代理和 Railway 写流量；备份确认后另行授权删除。

Gate：首页公网 200、真实登录成功、完整分析成功、账户删除成功、免费额度监控无异常。

## 10. 预计文件影响范围

- 新增：`apps/cloudflare-worker/**`、D1 migrations、Cloudflare bindings 与集成测试。
- 新增：`packages/cloudflare-adapters/**`，承载 D1/R2/Queue/Workflow 适配器。
- 修改：`services/account-billing/**`，将同步 Map 操作抽象为异步 Store port。
- 修改：`services/core-platform/**`，适配直接上传完成确认与异步任务边界。
- 修改：`prototype/src/api/resources.js`、上传流程和相关测试。
- 修改：`scripts/quality-gate.mjs` 与 CI，加入 Worker 类型检查、迁移校验和 Miniflare 测试。
- 修改：`docs/DEPLOYMENT.md`，在生产切换后将 Railway/OpenAI Sites 标记为历史路径。
- 暂不删除：`apps/mvp-server/**`、Dockerfile、Railway 配置和现有适配器，直到回滚窗口结束。

## 11. 测试与验收矩阵

- 单元测试：领域状态机、哈希/Token、配额、R2 Key、错误映射和状态转换。
- D1 集成：唯一约束、并发消费、幂等、分页、级联删除和 migration rollback/forward。
- R2 集成：直传、跨用户拒绝、大小不符、重复完成、删除和生命周期。
- Queue/Workflow：至少一次投递、重复/乱序、超时、重试、DLQ、取消和恢复。
- 安全：开放重定向、Cookie、CSRF、Token 重放、路径穿越、对象越权和日志脱敏。
- 前端 E2E：首页、匿名试用、Magic Link、Google OAuth、录音上传、结果、历史和删除账户。
- 生产 smoke：公网 200、`/health`、真实邮件、OAuth 回调、一次短音频分析和 R2 清理。
- 完成门禁：`CI=1 node scripts/quality-gate.mjs all --require-feature-tests` 与 `CI=1 TZ=UTC ...` 均通过。

## 12. 发布、回滚与运维

- 每次发布固定 commit SHA，先 Preview 后 Production，不允许直接在 Dashboard 修改业务代码。
- D1 migration 采用向前兼容的 expand/migrate/contract；切换期间旧服务和新 Worker 可读取兼容数据。
- Worker 发布失败使用版本回滚；DNS 不作为日常版本回滚手段。
- 分析链异常时进入维护模式：停止新上传，允许登录、历史和报告读取。
- 每日检查 Worker 请求/CPU、D1 rows、R2 GB、Queue ops、Workflow steps 和错误率。
- 日志默认采样；认证、支付、账户删除和状态终结事件保留必要审计但不得记录 Token、Cookie、音频或密钥。
- Railway 只在新架构完成 72 小时稳定运行、备份可恢复且 owner 明确授权后下线。

## 13. 主要风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Free Worker 10ms CPU 不足 | 请求被 1102 终止 | Phase 0 实测、精简依赖、直传 R2；失败则付费或缩减能力 |
| 无 `ffprobe` | 时长/格式不可信 | 限定录音格式、轻量解析、STT 元数据复核、最大时长预占 |
| D1 Store 异步化影响面大 | 账户/计费回归 | 先定义 port 与契约测试，再逐服务替换 |
| Queue 至少一次投递 | 重复分析/扣费 | attempt + 条件状态更新 + 权益幂等引用 |
| R2 达到 10 GB | 产生费用或上传失败 | 8 GB 硬护栏、短保留、生命周期和全站配额 |
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
- R2 Pricing：<https://developers.cloudflare.com/r2/pricing/>
- R2 Presigned URLs：<https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- Queues Pricing：<https://developers.cloudflare.com/queues/platform/pricing/>
- Workflows Pricing：<https://developers.cloudflare.com/workflows/reference/pricing/>
- Turnstile Plans：<https://developers.cloudflare.com/turnstile/plans/>

## 17. Phase 1 最终整改进度

> 更新时间：2026-09-05（Asia/Shanghai）
> 当前结论：Phase 1 本地实现与本地 Gate 已完成，常规与 `TZ=UTC` 双轮全量质量门禁均已通过。2026-09-05 已完成本机 Wrangler OAuth 登录，`wrangler whoami` 明确显示 `workers_scripts (write)` 权限；随后已将 `speechoptimizer-web-preview` 正式部署到目标 Cloudflare 账号，Static Assets 上传成功，Worker Version ID 为 `e195ac3e-fe03-414a-b1de-24e981596d2d`。Cloudflare API 进一步确认该版本以 100% 流量部署且 Worker `has_assets=true`。当前仅剩两项未闭环：工作树尚未形成固定 commit，以及当前执行环境访问 `workers.dev` 仍受网络限制（经代理返回 Cloudflare 1010，禁用代理后直连超时），因此远程 HTTP smoke 尚不能声明通过。

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
- 正式 Preview HTTP smoke：当前终端经代理请求 `/`、`/history`、`/health`、POST `/health`、未知 `/api/v1/*` 均被 Cloudflare 1010 返回 403；禁用所有代理变量后相同请求均连接超时。因此现有证据证明正式账号上传/部署完成，但当前执行环境无法完成外部 HTTP 可达性验收。
- `git diff --check`：通过。

### 17.3 最后待整改/验收项

1. 将本轮 Phase 1 改动形成固定 commit，再以该 commit SHA 作为 `APP_VERSION` 重新发布一次 `speechoptimizer-web-preview`。当前正式 Preview 已使用可审计的 dirty 指纹 `ff551f1+dirty.e4dd4f18e2dd` 部署用于运行验证，但它不能替代最终固定 commit SHA。
2. 在远程 Preview 复核首页、至少一个 SPA 深链、`/health`、JSON 404 和 JSON 405。
3. 确认 Preview 环境未绑定或引用 Production D1、R2、Secrets；Phase 2 创建资源时继续保持物理隔离。
4. 远程 Preview Gate 通过后，将本文状态改为“Phase 1 完成”，并把 `Current Phase` 切换到 Phase 2。
5. Phase 2 开始前继续保留现有 Sites + Railway Demo/Mock 作为迁移回退路径，不提前下线或删除。

当前明确阻塞：Cloudflare 账号写权限与正式 Preview 部署问题已经解除。剩余阻塞为：本轮 Worker/质量门禁改动尚未形成固定 commit；当前执行环境访问正式 `workers.dev` 时，经代理会被 Cloudflare 1010 拒绝，禁用代理后则连接超时。完成固定 commit + 重新发布，并从可正常访问该 `workers.dev` 地址的网络完成 HTTP smoke 后，才能满足“固定 commit SHA + 正式账户 Preview + 远程 smoke”的完整 Gate。

### 17.4 Phase 2 启动条件

远程 Preview Gate 完成后即可进入 Phase 2。Phase 2 的第一批工作固定为：D1 migrations、D1 Store/Repository adapters、Web Crypto 兼容改造、Magic Link/Google OAuth/Session/匿名身份迁移，以及 `PAYMENTS_ENABLED=false` 的生产启动边界。
