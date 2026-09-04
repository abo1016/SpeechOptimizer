# SpeechOptimizer MVP 当前开发交接

> 交接日期：2026-09-03（Asia/Shanghai）
> 最近更新：2026-09-04（Asia/Shanghai）。PR #1 已于 2026-09-04 合并，合并提交为 `1c38e65a6c88212225fea4c70587b33a3f9ffb78`；[PR #2](https://github.com/abo1016/SpeechOptimizer/pull/2) 是将线上部署修复提交 `3a912b7` 与交接文档提交 `deeeca3` 同步到 `main` 的既定路径，合并后 `main` 将包含部署与文档提交。Sites 与 Railway 已完成可浏览器验收的 Demo/Mock 部署；生产 Release 仍关闭。
> 工作区：`/Users/bopop/Documents/SpeechOptimizer`
> Git 分支：`codex/cicd-bootstrap`
> 远端同步：当前部署分支已推送到 `origin/codex/cicd-bootstrap`；PR #2 是部署与文档同步到 `main` 的当前路径，合并后以其远端合并提交和 `main` CI 为准。
> 最近核验：Sites 部署状态为成功，主站启用 owner-only 登录保护；Railway API `/health` 返回 HTTP 200，模式为 `mock`，数据目录为 `/var/lib/speechoptimizer`。自定义域名 `app.bo-pop.top` 的 Sites `status`、`provider_status`、`ssl_status` 均为 `active`，匿名公网访问返回 HTTP 401 登录门槛，不再是 404。主站、API、持久卷和同源 API 代理均已上线。
> 当前状态：**SpeechOptimizer 已完成可浏览器验收的 Demo/Mock 部署**，前端、API、Railway 持久卷和同源 `/api/*`、`/health` 代理均已上线；模型、支付、邮件、Google OAuth、生产数据库/对象存储、可观测性等外部依赖仍未接入，不应将当前状态表述为完整生产模式。PR #2 是将 `3a912b7` 的 4 个部署文件变更与 `deeeca3` 的文档回写同步到 `main` 的既定路径；合并后 `main` 将包含二者。根目录 `AGENTS.md` 删除仍是任务外用户改动。

## 0. Canonical Handoff State

本节是长任务恢复入口，只维护“现在是什么状态”和已有详细章节的索引；事实细节仍以链接章节为准，不在这里复制第二套历史。每次阶段完成、验证状态变化、出现 blocker/architecture decision/failed attempt，或会话准备结束时，都必须同步更新本节和对应详细章节。仓库级恢复规则见根目录 `AGENTS.md`。

| Field | Current State |
| --- | --- |
| **Goal** | 完成 SpeechOptimizer 整个 MVP，并达到当前代码、测试、HTTP、浏览器和上线边界可审计的交付质量；在不伪造外部证据的前提下完成 Waffo 官方 Node SDK 3.0.1 集成，并按第 15.16 节继续上线链。 |
| **Current Phase** | 可浏览器验收的 Sites + Railway Demo/Mock 部署已完成；PR #2 是将 `3a912b7` 部署变更与 `deeeca3` 文档回写同步到 `main` 的既定路径，合并后 `main` 将包含二者。 |
| **Current Objective** | 保持当前单实例 Mock 部署可验收；完成 PR #2 的检查与合并后核验 `main`，再按外部依赖准备情况接入真实模型、邮件、OAuth、支付、数据库/对象存储与可观测性。Vercel Release 流程保留为遗留/备用路径，未经 owner 决策不修改。 |
| **Completed** | Sites 主站、同源 API 代理、Railway `speechoptimizer-api`、500 MB 持久卷和 Mock 全链路已上线；主站 owner-only 登录保护、Railway `/health` HTTP 200、`app.bo-pop.top` 域名状态及匿名 401 门槛均已核验。PR #1 于 2026-09-04 以合并提交 `1c38e65` 合并；部署源码提交 `3a912b7` 与文档提交 `deeeca3` 已推送到 `codex/cicd-bootstrap`。 |
| **In Progress** | 线上仍为 `mock` 模式，真实模型/支付/邮件/OAuth/生产数据层和监控尚未配置；PR #2 正在完成部署与文档同步。根目录 `AGENTS.md` 删除继续保持未暂存，不得带入部署提交。 |
| **Next** | 1）完成 PR #2 的检查与合并，并核验 `main` CI；2）保持当前单实例 Railway volume 部署并继续监控 `/health`；3）补齐真实 OpenAI、邮件、Google OAuth、Waffo、数据库/对象存储、备份和监控；4）真实依赖就绪后再做 staging/production E2E；5）如需启用 Vercel Release，先由 owner 明确其作为主路径还是备用路径。 |
| **Blockers** | **部署运行：无当前阻塞，Mock 全链路已通过。** **完整生产模式：** OpenAI/SMTP/Google/Waffo 凭证与业务决策、生产数据库/对象存储、备份和监控仍不完整。**源码同步：** PR #2 是既定同步路径，合并后 `main` 将包含 `3a912b7` 与 `deeeca3`。 |
| **Architecture Decisions** | 既有域名/Supabase/单实例持久卷决定保持。Release 新增：workflow_run 必须验证 CI success + push + main，并 checkout 对应 immutable SHA；人工发布仅 main；生产开关默认关闭；GHCR 和 Vercel 独立 job 共享同一 verify gate；Vercel 使用固定 59.11.2 + prebuilt production deploy；checkout 不持久化凭证。 |
| **Failed Attempts** | 既有历史与 Luna 通道失败见 15.13。Actions run `33868265419` 使用 `pnpm/action-setup@v6` 后在 Setup pnpm 卡住超过两分钟；官方 release 已声明该 action 由 `pnpm/setup` 继任，因此主动取消该 run，不再重试旧 action。切换 `pnpm/setup@v2` 后恢复正常。 |
| **Verification** | **本次 PR #2 本地：** 常规与 UTC 完整质量门禁、原型生产构建、`git diff --check` 通过；Sites Worker `8/8`。**历史部署核验：** 常规与 UTC 完整质量门禁各 `165/165`、原型测试 `21/21`、Sites Worker `6/6`，以及 Railway 创建匿名会话、分析任务、WAV 上传、报告获取和删除链路均通过；真实 Chrome 已验证上传合成 WAV、分析、报告跳转及指标展示；最终 `/health` HTTP 200。历史 GitHub CI run `33868583632` SUCCESS 且 annotations `[]`，不替代当前线上验收。 |
| **Git State** | Branch `codex/cicd-bootstrap`；部署源码提交 `3a912b7` 与文档提交 `deeeca3` 已推送；PR #1 已于 2026-09-04 合并，merge commit `1c38e65a6c88212225fea4c70587b33a3f9ffb78`。PR #2 是将部署与文档同步到 `main` 的既定路径，合并后以 `main` CI 核验；任务外 `AGENTS.md` 删除仍未暂存、未进入任何 commit。 |
| **Important Files** | `AGENTS.md`（tracked 但当前工作树已删除，需 owner 确认意图）；`docs/MVP_HANDOFF_2026-09-03.md`（恢复入口：第 0 节 + 15.16）；`docs/DEPLOYMENT.md`；`apps/mvp-server/Dockerfile`、`prototype/.openai/hosting.json`、`prototype/worker/index.js`、`prototype/tests/sites-worker.test.mjs`（线上部署变更）；以及 `.github/workflows/{ci.yml,release.yml}`、`.waffo/integration-manifest.json` 与 MVP/Waffo 关键源码。 |
| **Session Summary** | 2026-09-04：完成 Sites + Railway Demo/Mock 部署、持久卷、同源代理、域名和浏览器端验收；PR #1 已合并，部署源码提交 `3a912b7` 与文档提交 `deeeca3` 已推送到 `codex/cicd-bootstrap`；PR #2 是同步到 `main` 的既定路径。 |

## 1. 交接结论

当前工作区包含一套完整的本地 SpeechOptimizer MVP 代码，并已在 `codex/cicd-bootstrap` 上形成可部署源码检查点。2026-09-04 已完成可浏览器验收的 Sites + Railway Demo/Mock 部署：**本地代码门禁、独立 UTC 门禁、Railway API 全链路和匿名上传到报告的真实 Chrome smoke 均有通过证据**。线上 API 仍明确运行在 `mock` 模式，不把健康检查或 Mock 报告当作真实 Provider 生产证据。旧 Waffo 接线中断、fixture 红灯和 loopback 限制属于下方历史 checkpoint，不再是当前 Demo 部署的运行阻塞。范围覆盖：

- 匿名会话、Magic Link、Google OAuth 本地替身、Cookie 会话、账户隔离、角色授权和管理员操作；
- 音频录制/上传、服务端 MIME/大小/时长校验、本地对象存储、转写、指标和结构化反馈；
- 异步分析状态机、刷新恢复、失败/取消/重试、历史、报告、比较、单条删除和账户级删除；
- Free/Pro/分钟包/深度报告的权益与流水、Waffo 注入式网关、订单/订阅取消/退款边界、Webhook 验签和幂等；
- React 前端从旧 Demo 页面切换到本地 HTTP API，覆盖工作台、处理页、报告页、比较页、历史、计费、隐私、认证和管理页面；
- 本地 Docker 依赖编排（PostgreSQL、MinIO、Mailpit）及静态契约检查。

这些模块现在都存在于工作区。需要严格区分两个状态：① **当前 Demo/Mock 部署**已经通过 Sites、Railway、持久卷、同源代理和浏览器主链路验收；② **完整生产模式**仍缺真实 Waffo/支付、STT/LLM、Google、邮件、生产数据库/对象存储、备份和可观测性。历史实施细节、失败尝试和旧 blocker 仍保留在第 12–15 节，但当前恢复入口是第 0 节与第 15.16 节。

## 2. 本轮执行时间线

1. 首先检查工作区，发现 `main` 仅比 `origin/main` 多本地未跟踪内容；执行 `git pull --ff-only`，远端无新提交。
2. 发现完整 MVP 源码被保存在本地 stash 的未跟踪文件快照中，而工作区只留下了部分 `dist` 产物；按文件范围恢复了源码，未删除 `.data/` 或构建产物。
3. 读取 `docs/MVP_PLAN.md` 和既有 `docs/MVP_HANDOFF_2026-09-02.md`，按交接文档的“实现收尾、双重门禁、最终审查、浏览器验收”顺序继续。
4. 并行委派了三个工作流：核心恢复/权益一致性、React API 闭环、独立质量门禁。代理均使用项目要求的 GPT-5.6 Terra / max，未提交或推送。
5. 核心工作流修复了恢复时的预扣/匿名试用补偿和终态权益结算，并进一步修复了账户失败重试可能复用已释放 hold 的应用层引用问题。
6. 前端工作流把真实 API/state/hooks 接入 `main.jsx` 和应用壳，替换旧的静态 Demo 路由，并修复 Abort 请求被误判为网络错误的问题。
7. 本次用户中断发生在前端最终定向测试和两轮全量门禁之前，因此本文件记录为“持续实施与验证中”。

## 3. 当前工作树状态

### 3.1 Git 与本地运行时文件

- 当前分支：`codex/cicd-bootstrap`；线上部署源码提交为 `3a912b7`，文档回写提交为 `deeeca3`，均已推送到该分支；PR #2 是同步到 `main` 的既定路径，合并后 `main` 将包含二者。
- 已确认远端：`origin` 指向 `https://github.com/abo1016/SpeechOptimizer.git`。
- PR #1 已于 2026-09-04 合并，合并提交为 `1c38e65`；PR #2 是将部署提交 `3a912b7` 和文档提交 `deeeca3` 同步到 `main` 的既定路径，合并后 `main` 将包含二者。
- `prototype/src/App.jsx`、`AppShell.jsx`、`RecorderWorkspace.jsx`、各页面和 `main.jsx` 是已修改的既有文件。
- `apps/`、`packages/`、`services/`、`spikes/`、`infra/`、`scripts/`、`prototype/src/` 与 `prototype/tests/` 当前已由提交 `d1432f3` 跟踪；此前“从 stash 恢复的大量未跟踪源码”属于 superseded historical state，不应据此判断当前 diff。
- `.data/`、`apps/mvp-server/.data/` 和 `.pnpm-store/` 是本地运行/测试状态或依赖状态，不应作为代码审查结论，也不要用删除工作区的方式“清理”。
- 当前部署源码与文档已执行 `git diff --check`，结果退出码为 0；后续代码改动仍应在交付前再次执行。

### 3.2 Node/pnpm 运行时

交接文档已确认可用运行时路径：

```bash
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
node --version   # 交接时为 v24.19.0
pnpm --version   # 交接时为 11.19.0
```

非 TTY 环境直接执行 pnpm 可能触发 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。最终门禁使用 `CI=1`，不要为了绕过该提示修改锁文件或静默重装依赖。

## 4. 已实现模块与入口

### 4.1 HTTP 组合服务

主要入口和契约：

- [apps/mvp-server/src/index.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/src/index.js)：加载配置、Provider、持久化和 HTTP 服务；
- [apps/mvp-server/src/application.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/src/application.js)：组合核心分析、账户、权益和计费；
- [apps/mvp-server/src/server.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/src/server.js)：CORS、请求体限制、错误码、Webhook 来源限制；
- [apps/mvp-server/CONTRACT.md](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/CONTRACT.md)：`/api/v1` HTTP 契约。

核心路由：

| 领域 | 已实现端点 |
| --- | --- |
| 身份 | 匿名会话、Magic Link、Google start/complete、session、logout、account delete |
| 分析 | create、octet-stream upload、查询、cancel、retry、delete、history、report、compare |
| 计费 | plans、balance、ledger、orders、subscriptions、cancel、refund |
| Webhook | `POST /api/v1/webhooks/waffo`，原始 body 验签、版本检查、幂等处理 |
| 管理 | user overview、disable、return-minutes、failed analysis retry、observability |

### 4.2 核心音频与分析层

- [services/core-platform/src/core-platform-service.js](/Users/bopop/Documents/SpeechOptimizer/services/core-platform/src/core-platform-service.js) 管理任务生命周期和本地 repository。
- [services/core-platform/src/media-inspector.js](/Users/bopop/Documents/SpeechOptimizer/services/core-platform/src/media-inspector.js) 不信任浏览器 MIME，校验文件头、大小和真实媒体时长。
- [services/core-platform/src/local-object-store.js](/Users/bopop/Documents/SpeechOptimizer/services/core-platform/src/local-object-store.js) 使用受限本地目录保存/删除音频对象，防止路径穿越。
- [packages/speech-engine/src/](/Users/bopop/Documents/SpeechOptimizer/packages/speech-engine/src/) 提供英语转写夹具、WPM、有效说话时长、口头禅、停顿、重复短语、句长和比较。
- [packages/provider-adapters/src/](/Users/bopop/Documents/SpeechOptimizer/packages/provider-adapters/src/) 提供 OpenAI STT/反馈、媒体探测、邮件和 Waffo 注入式适配边界；开发模式仍使用显式本地 Mock。

任务状态：

```text
created -> uploaded -> transcribing -> analyzing -> completed
                                      \-> failed
                                      \-> cancelled
```

### 4.3 恢复与权益一致性修复

核心修复位于 [apps/mvp-server/src/application.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/src/application.js)：

- `uploaded` 任务恢复时先补齐账户 hold/匿名试用并镜像快照，`flush` 成功后才重新调度 runner，避免“核心任务已上传但组合快照崩溃导致免费执行”；
- 恢复发现权益不足或匿名试用已经被另一任务消费时，取消该核心任务，不让它绕过权益；
- `transcribing`/`analyzing` 中断任务转为带 `PROCESS_INTERRUPTED`、可重试的 `failed`，释放仍为 `reserved` 的权益；
- 核心任务已经 `completed` 时确认残留预扣，`failed`/`cancelled` 时释放残留预扣；
- 账户失败重试不再复用原分析 ID 作为唯一 hold 引用，而是按分析 attempt 派生 `analysisId:retry:<attempt>:<sequence>`；同一尝试的 `reserved` hold 可幂等复用，已释放 hold 会使用新序号；
- runner 仍在结算时，重复 retry 返回稳定的 `ANALYSIS_NOT_RETRYABLE`/409 边界，避免并发重复预扣。

相关回归在 [apps/mvp-server/test/http-flow.test.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/test/http-flow.test.js) 覆盖恢复崩溃窗口、匿名试用归属、终态结算和账户失败重试余额变化。

### 4.4 账户、权限、计费与 Waffo 边界

- [services/account-billing/src/auth-service.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/auth-service.js)：一次性 Magic Link、OAuth state、session 撤销、账户禁用和角色授权。
- [services/account-billing/src/entitlement-service.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/entitlement-service.js)：原有最早到期预扣/确认/释放仍在；已加入 `startsAt` 生效窗口和 `sourceSummary()`，用于“年付但每月仅 60 分钟、月末清零”和自动退款前判断权益是否已消费。account-billing 定向测试已记录为 33/33；当前完整门禁结果以第 15.16 节记录的双轮 `165/165` 为准。
- [services/account-billing/src/billing-policy.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/billing-policy.js)：本轮新增，统一定义 Free、Pro 月付/年付、分钟包、Deep Report 的 purchase type 与订阅周期；`pro_yearly` 当前设计为 Waffo 12 个月计费周期，同时在本地预建 12 个按月生效/过期的 60 分钟批次。
- [services/account-billing/src/billing-service.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/billing-service.js) + [billing-webhook-processor.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/billing-webhook-processor.js)：已完成资金 request ID 持久化、Provider write 结果自持久化、启动 inquiry-only reconciliation、一次性/订阅分流、退款人工审核边界和 Webhook 生命周期处理。当前测试为 33/33；但 `billing-service.js` 当前 **328 行**，仍超过仓库单文件 300 行硬上限，需要行为保持地继续拆分。
- [packages/provider-adapters/src/waffo-gateway.js](/Users/bopop/Documents/SpeechOptimizer/packages/provider-adapters/src/waffo-gateway.js) + [waffo-gateway-support.js](/Users/bopop/Documents/SpeechOptimizer/packages/provider-adapters/src/waffo-gateway-support.js)：已迁移到官方 `@waffo/waffo-node 3.0.1` 的 `order()` / `subscription()` / `refund()` API，覆盖 Hosted Checkout、USD minor 单位、UnknownStatus 同 request ID inquiry、operation/status 恢复判定和 Auth 时间戳归一。当前 provider-adapters 38/38；但 `waffo-gateway-support.js` 当前 **381 行**，超过 300 行硬上限。
- [apps/mvp-server/src/config.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/src/config.js)、[providers.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/src/providers.js) 与 [waffo-webhook.js](/Users/bopop/Documents/SpeechOptimizer/apps/mvp-server/src/waffo-webhook.js)：已接入官方 SDK client factory、原始 body + `X-SIGNATURE` Webhook、生产配置 fail-closed 和未确认 Waffo 决策拒绝启动。历史 `providers.test.js` fixture 契约问题已在部署前收口；当前线上仍为 Mock，真实 Waffo 决策和凭证继续保持未配置。
- [spikes/sdk-integrations/src/waffo-client.js](/Users/bopop/Documents/SpeechOptimizer/spikes/sdk-integrations/src/waffo-client.js) 与 `webhook.js`：request ID、UnknownStatus inquiry、签名验证、事件 claim/release 的 Spike。

开发模式的本地网关在 [services/account-billing/fixtures/local-adapters.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/fixtures/local-adapters.js)，只生成 Mock checkout，不访问外网或产生真实订单。生产模式缺少必要 Provider/密钥时会拒绝启动。

## 5. 前端当前接线状态

### 5.1 已完成的真实 API 接线

- [prototype/src/main.jsx](/Users/bopop/Documents/SpeechOptimizer/prototype/src/main.jsx) 已挂载 `AppProvider`。
- [prototype/src/state/AppProvider.jsx](/Users/bopop/Documents/SpeechOptimizer/prototype/src/state/AppProvider.jsx) 在首屏先探测 health，再创建/恢复匿名 Cookie，最后读取 session/privacy；支持 bootstrap retry、logout 后回落匿名。
- [prototype/src/api/client.js](/Users/bopop/Documents/SpeechOptimizer/prototype/src/api/client.js) 统一处理 JSON、octet-stream、credentials、稳定 API error code 和 Abort signal。
- [prototype/src/api/resources.js](/Users/bopop/Documents/SpeechOptimizer/prototype/src/api/resources.js) 集中维护分析、认证、历史、比较、计费、隐私和管理端点。
- [prototype/src/components/RecorderWorkspace.jsx](/Users/bopop/Documents/SpeechOptimizer/prototype/src/components/RecorderWorkspace.jsx) 录音和文件上传都通过 create analysis → binary upload → 动态 processing 路径；服务端是唯一可信任务 ID 来源。
- `ProcessingPage` 真实轮询服务端状态并支持 cancel/retry；`ResultPage`/`ComparePage` 使用动态报告 ID；历史、删除、隐私、计费、退款和管理页使用真实 API。
- [prototype/src/components/AuthDialog.jsx](/Users/bopop/Documents/SpeechOptimizer/prototype/src/components/AuthDialog.jsx) 走 Magic Link 和 Google OAuth 本地替身；真实生产 Provider 仍需配置。

### 5.2 仍需浏览器验收

源码已具备语义按钮、可读错误、`aria-live`/`aria-busy`、移动触控尺寸和键盘路径，但尚未在本轮最终代码上完成真实浏览器 smoke。需要在服务启动后验证：

- 320/375/414/768/1024/1440px 下无横向溢出或遮挡；
- 匿名冷启动、麦克风允许/拒绝/撤销、录音暂停/完成/重录；
- 文件格式/大小/时长错误反馈；
- 处理页刷新恢复、失败 retry、cancel 终态、报告、比较；
- 登录、Magic Link 预览 token、OAuth callback、logout；
- 历史查看/删除、隐私偏好、账户删除后匿名回落；
- 套餐、余额、订单、退款和管理员界面仅显示本地 Mock 状态，不触发真实收费。

## 6. 验证证据矩阵

### 6.1 已有局部证据

以下结果区分“本次重新执行”和“历史/未重跑”，均不能替代最终双轮全量门禁：

| 范围 | 证据 | 当前解释 |
| --- | --- | --- |
| 原型测试 | **本次** `node --test prototype/tests/*.test.mjs`：19/19 | 当前定向测试绿；真实浏览器 smoke 仍未重跑 |
| 语音引擎 | 历史 check、test 14/14、build | 本次未重跑；由最终 quality gate 统一复核 |
| Provider 适配 | **本次** check PASS、test 38/38、build PASS | 当前定向门禁绿；`waffo-gateway-support.js` 381 行仍违反仓库硬规则 |
| 核心平台 | 历史 check/build 与历史门禁 | 本次未独立重跑；由最终 quality gate 统一复核 |
| 账户计费 | **本次** check PASS、test 33/33、build PASS | 当前定向门禁绿；`billing-service.js` 328 行仍违反仓库硬规则 |
| MVP HTTP | **本次** check PASS、build PASS；test 5/34 pass、29 fail | 27 个失败是 loopback `EPERM`；另 2 个是 `providers.test.js` production fixture 缺失订阅决策字段的真实失败 |
| SDK Spike | check、test 13/13、build | 本地 Mock transport；不代表 Waffo Sandbox |
| Sites Worker | 原型旧模块测试通过 | 前端接线后需重跑 build/test:sites |
| infra/local | 静态检查和契约测试通过 | 未真实启动 Docker 容器 |
| Waffo validator | handoff 先前记录 schemaVersion 2 manifest 基础检查 `0 errors / 0 warnings` | 本次直接执行被运行环境安全策略拦截，没有新的 validator 证据；最终交付前必须在可执行环境重跑 |
| 工作树 | **本次** `git diff --check` 退出码 0 | 当前无 whitespace error；后续任何代码/文档修改后都要再跑 |

### 6.2 第一轮全量门禁失败的环境原因

独立质量工作流执行：

```bash
PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" \
node scripts/quality-gate.mjs all --require-feature-tests
```

当时未通过的证据：

- prototype 的 pnpm build/test:sites 在非 TTY 依赖状态检查中触发 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`；最终应设置 `CI=1`，不是修改项目依赖。
- `apps/mvp-server` 的 HTTP 测试全部因当前受限沙箱禁止 `listen 127.0.0.1` 而报 `EPERM`；独立探针也复现相同限制。
- `services/core-platform` 的 HTTP 测试曾出现 Node `InternalCallbackScope::Close` 断言崩溃，需要在允许 loopback 的环境重新确认，不得直接当作业务回归或通过。

## 7. Waffo 状态与硬阻塞

### 7.1 已完成的本地适配边界

- 本地账户计费服务只依赖注入式 `gateway`，可以替换为官方 Waffo client；金额从服务端商品目录读取，不信任前端金额。
- 订单使用本地状态、外部 ID、Webhook 事件和权益流水；重复事件不会重复发放权益，乱序事件不会覆盖较新的状态。
- UnknownStatus 会保留 request ID 并尝试 inquiry；查询失败时本地订单落为可重试失败，不留下伪造 pending 成功。
- Webhook 先验签，再校验来源/事件版本/事件 ID；本地默认 claim/串行队列只保证单进程语义。

### 7.2 Owner 已确认的 Waffo 业务范围

用户在本轮明确回复：`按推荐方案执`，用于确认上一条消息中给出的推荐支付方案。可以按该确认继续实现以下范围：

- feature：启用一次性订单（分钟包、Deep Report）、退款、Pro 月付/年付订阅；**本轮不做 subscription upgrade/downgrade**；
- 支付最终事实：Webhook 为 Source of Truth；redirect 只用于 UX，不直接发权益；UnknownStatus 使用**同一 request ID** inquiry，不能新建 request ID 猜测失败；
- checkout：Waffo Hosted Checkout + full-page redirect；币种固定单币种 USD；
- Pro 月付：每个有效月度周期发 60 分钟，周期结束清零；
- Pro 年付：现金侧是一笔年付，但本地权益按 12 个自然月批次生效，每月仅 60 分钟可用，未使用部分月末失效；
- 取消订阅：当前周期权益继续有效，到期停止续费，不立即撤销已发权益；
- 扣款失败：不发新的周期权益，已有当前周期权益不因为单次扣款失败自动回收；
- 自动退款：仅当该订单权益**完全未消费**时自动处理；已部分/全部消费、订阅退款、已生成 Deep Report 均进入人工审核，不允许为了退款制造负权益；
- Webhook 业务：一次性 `onPayment` 成功后发对应订单权益；`onRefund` 成功后只撤订单来源尚未使用权益；subscription status/period 事件负责生命周期与新周期权益，subscription payment 不能走一次性订单发放分支。

### 7.3 仍未确认、不得代答的 Waffo 人工决策

以下项目**没有被“按推荐方案执行”充分回答**，必须继续保留为未解决/上线阻塞，不能伪造 `CONFIRMED_BY_HUMAN`：

- `userTerminal` 的最终人工确认（代码/当前产品明显是 Web，但 Waffo Skill 要求资金相关 preference 由人确认）；
- `subscriptionMode`：payment-first vs service-first 的 Waffo 合同语义仍未明确。当前仅确认了“扣款失败不发新周期权益”，没有确认重试成功后是否重置账单日/重试耗尽后下一期是否继续扣款；
- `subscriptionRetryConfig`：Waffo 商户合同里的重试次数与间隔；不得在代码中假设；
- device-wallet 的实际签约/真机覆盖；Hosted Checkout 不使用 iframe，但 Apple Pay/Google Pay 是否 active 必须由 `payMethodConfig().inquiry()` + Sandbox/真机证据决定；
- Go-Live Q1–Q8；
- `complianceExemption`：没有得到 premium/qualified merchant 对 `goodsUrl/appName` 的豁免确认，因此实现必须默认**无豁免**并提供真实 `goodsUrl`；
- Sandbox MID/API Key/private key/Waffo public key、对外 HTTPS Webhook 地址、正式回跳域名等环境事实。

### 7.4 当前 Waffo validator 状态

已读取并按 `waffo-integrate` skill **1.7.0** 开始执行，当前官方 Node SDK 已核实为 **`@waffo/waffo-node 3.0.1`**。SDK 已安装到 `apps/mvp-server`，`package.json` 和 `pnpm-lock.yaml` 已变更。

`.waffo/integration-manifest.json` **已经创建**，当前为 schemaVersion 2，并把第 7.2 节已确认项与第 7.3 节 unresolved 决策分开登记；`userTerminal`、`subscriptionMode`、`subscriptionRetryConfig`、Go-Live Q1–Q8、device-wallet/payment method、`complianceExemption` 等仍保持 unresolved，不能因为 manifest 已存在就视为业务确认完成。

handoff 先前记录的基础 validator 结果为 `0 errors / 0 warnings`，并识别 `onPayment/onRefund/onSubscriptionStatus/onSubscriptionPeriodChanged`。本次尝试重新执行：

```bash
node /Users/bopop/.codex/skills/waffo-integrate/bin/waffo-verify.js . --json
```

该直接脚本调用被当前运行环境安全策略拦截，未产生新的退出码或 validator JSON。因此：**0 errors / 0 warnings 只能保留为先前同阶段既有证据，本次不能冒充重新验证通过**。当前也没有生成正式 payment report；只有在后续可执行环境里重新跑 validator/report gate 并满足外部证据要求后才能生成。

## 8. 当前风险清单

| 等级 | 风险 | 处理/后续 |
| --- | --- | --- |
| 已解除 | Sites + Railway Demo/Mock 部署 | 主站、同源代理、Railway API、500 MB 持久卷和 `app.bo-pop.top` 已完成平台状态、HTTP 健康和浏览器验收；API 当前为 `mock`。 |
| 进行中 | PR #2 源码同步 | 线上 4 个部署文件变更由 `3a912b7` 承载，文档回写由 `deeeca3` 承载；PR #2 是同步到 `main` 的既定路径，合并后 `main` 将包含部署与文档提交。 |
| BLOCKER（完整生产模式） | 真实模型、邮件、Google OAuth、Waffo 和生产数据层尚未配置 | 当前 Demo/Mock 部署不受阻；接入真实 Provider 前需要凭证、预算/限流、业务决策、staging E2E、Postgres/对象存储迁移和备份策略。 |
| MAJOR | 当前 JSON/音频本地持久化仍依赖单实例 Railway volume | 在实现并验证 Supabase Postgres/S3 adapter、跨实例幂等和迁移前，不要增加 replica 或移除 `/var/lib/speechoptimizer` volume。 |
| MAJOR（后续可选） | Vercel Release 流程与当前 Sites 主路径并行存在 | `.github/workflows/release.yml` 的 Vercel job 是遗留/备用路径；未经 owner 决策不修改、启用或将其当作当前主站发布链。 |
| MINOR | 根目录 `AGENTS.md` 删除属于任务外工作区改动 | 继续保持未暂存、未提交、未恢复；任何文档或部署提交都必须显式排除它。 |
| 观察项 | 本机 Compose v2 覆盖不足 | 已通过静态/契约门禁，但本机未检测到 Compose v2；不能据此声称 PostgreSQL/MinIO/Mailpit 容器已启动。 |
| MINOR | Webhook claim/队列默认仅单进程 | 多实例部署前换共享数据库唯一键、Redis 原子 claim 或消息队列 |
| MINOR | JSON repository/组合快照不是关系型事务 | 单实例 MVP 已加恢复对账；未来生产需统一事务/Outbox/幂等方案 |
| MINOR | `.data`/`.pnpm-store` 仍是未跟踪本地状态 | 不纳入代码审查，不删除用户数据；最终报告中单独排除 |

## 9. 当前接续执行顺序

当前部署已经完成，后续接手按以下顺序推进；不要把历史章节中的“首次部署”步骤重新执行：

1. 先核对第 0 节与第 15.16 节，再检查分支和工作区；保留根目录 `AGENTS.md` 删除状态，不要将其纳入提交。
2. 完成 PR #2 的检查与合并，并核验 `main` CI；合并前确认部署、代理校验和文档文件边界，不要通过重写历史或恢复用户文件解决同步问题。
3. 保持现有 Railway `speechoptimizer-api` 单实例与 `/var/lib/speechoptimizer` volume，用 `/health`、平台日志和浏览器报告监控当前 Mock 运行态。
4. 真实 Provider 就绪后，先在 staging 配置 OpenAI、邮件、Google OAuth、Waffo 及对应 CORS/回调，再执行真实 E2E；不要将 Mock 结果当作生产证据。
5. 实现并验证 Supabase Postgres/S3 adapter、迁移、备份和跨实例幂等后，才评估移除本地 volume 或增加 replica。
6. 若 owner 明确选择 Vercel 作为备用或主发布路径，再单独创建/链接 Project、配置 secrets、运行其 Release gate；在此之前保持现有 Vercel 流程不变。

## 10. 交付边界

当前交接已包含经 owner 授权完成的文档/源码提交与远程推送；后续远程 Git 操作仍需遵循当轮授权和严格文件边界。以下事项不属于当前 Demo/Mock 部署的完成范围：

- 真实 Waffo 收费、退款、订阅变更或生产 Webhook；
- 真实用户音频、转写文本或外部 LLM/STT 数据上传；
- 将 Mock 健康检查、局部测试或浏览器报告误称为真实 Provider 生产验收；
- 将源码中的 `API_ORIGIN`、CORS 或持久卷约定误称为已配置的平台事实；
- 在没有 Supabase adapter、迁移、备份和跨实例幂等证据前移除 Railway volume 或扩容。

当前 Demo/Mock 交付判定已经满足：部署成功、owner-only 主站可访问、Railway `/health` HTTP 200、自定义域名 active 且匿名返回 401、双轮质量门禁与浏览器报告可核验。完整生产交付仍需真实 Provider、数据层、监控/备份和对应人工决策明确完成，或由 owner 明确将其移出本轮范围。

## 11. 2026-09-03 晚间接续结果（历史记录）

本次从本交接文档继续执行，未提交、未合并、未推送。

- Step 1：prototype 测试 `19/19`、MVP HTTP 测试 `19/19`、check/build、`git diff --check` 均通过。
- 第一轮 `CI=1 node scripts/quality-gate.mjs all --require-feature-tests`：全部通过。
- 第二轮 `CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests`：全部通过。
- 只读审查补了两处实际问题：生产环境不再继承本地 Vite `ALLOWED_ORIGINS`；账户删除同时清理 Magic Link 邮箱、账户关联 Webhook 与审计残留。
- Chrome Headless 真实 smoke 发现并修复了 Vite 使用 `localhost:8787`、页面使用 `127.0.0.1` 时匿名 Cookie 被隔离的问题；开发 API 地址现在跟随当前页面 hostname。
- 修复后浏览器在 375/768/1440 三个视口均满足 `scrollWidth === clientWidth`，没有 `Service connection failed`、Runtime exception 或 console error。
- 使用本地生成的 1 秒无隐私 WAV 完成真实主链路：匿名 Cookie → 选择文件 → `Analyze this take` → processing → `/analysis/<id>/report`，报告正常展示 Speaking rate、Filler words、Long pauses 等服务端结果。
- 本地基础设施门禁仍仅为静态/契约检查；当前机器未检测到 Compose v2，因此未宣称 PostgreSQL/MinIO/Mailpit 容器已启动。
- 该绿灯基线之后 owner 已回复 `按推荐方案执`，Waffo feature 和核心履约规则已开始落地；因此**当前真正的第一 BLOCKER 已变成“未完成的 Waffo 重构导致账户计费测试红灯”**，其次才是剩余人工决策与 Sandbox/生产凭证。

## 12. 2026-09-03 21:xx Waffo 接线中断快照（历史交接点）

本节优先级高于前文任何“Waffo 尚未开始”或“当前全绿”的旧描述。用户在 Waffo 重构进行中要求立即落盘 handoff，因此本轮**到此停止继续实现**。

### 12.1 已完成的 Waffo 准备工作

1. 已读取本机 `waffo-integrate` skill：`/Users/bopop/.codex/skills/waffo-integrate/SKILL.md`，skill package version 为 **1.7.0**。
2. 已读取并核对：
   - `docs/enforcement.md`；
   - `references/business-validation.md`；
   - `references/scenario-selection.md`；
   - `references/api-contract.md`；
   - `references/code-generation-rules.md`；
   - `references/node.md`。
3. 已通过 npm registry 核实当前官方 Node SDK 版本：**`@waffo/waffo-node 3.0.1`**。
4. 已安装到 `apps/mvp-server`：

   ```text
   apps/mvp-server/package.json      dependencies: { "@waffo/waffo-node": "3.0.1" }
   apps/mvp-server/pnpm-lock.yaml    已同步变更
   ```

   因当时 shell 直接找不到 `pnpm`，实际使用的是：

   ```bash
   npx --yes corepack pnpm add @waffo/waffo-node@3.0.1
   ```

   执行时当前 shell Node 为 v22.23.2，而 `apps/mvp-server/package.json` 声明 `node >=24`，所以 pnpm 打印了 engine warning；这不是 SDK 安装失败。之前完整门禁使用过 Node 24 runtime，最终回归仍应切回项目指定 Node 24。
5. 已直接检查 `node_modules/@waffo/waffo-node/dist/index.d.ts`，确认 3.0.1 实际可执行契约包括：
   - `waffo.order().create/inquiry/cancel/refund/capture`；
   - `waffo.refund().inquiry`；
   - `waffo.subscription().create/inquiry/cancel/manage/update/change/changeInquiry`；
   - `waffo.payMethodConfig().inquiry`；
   - `waffo.webhook().onPayment/onRefund/onSubscriptionStatus/onSubscriptionPeriodChanged/.../handleWebhook`；
   - `WaffoUnknownStatusError`；
   - 所有 write request ID 最大 32 字符，当前设计使用无横线 UUID 32 字符。
6. 已确认现有 `packages/provider-adapters/src/waffo-gateway.js` 仍是旧 `@waffo/pancake-ts`/`checkout.createSession` 思路，与官方 3.0.1 契约不一致，需要替换而不是继续补兼容分支。

### 12.2 本轮已经落盘的代码修改

#### `services/account-billing/src/billing-policy.js`（新文件）

已经新增统一商品规则：

- `free_monthly`：免费，不允许创建支付订单；
- `pro_monthly`：subscription，Waffo `MONTHLY / 1`，每月 60 分钟；
- `pro_yearly`：subscription，Waffo `MONTHLY / 12`，现金侧一年一笔，本地权益 12 个按月窗口；
- `minutes_30`、`minutes_100`、`deep_report`：one-time。

这里的目的不是新增另一份价格表，而是把“支付类型/订阅周期/权益周期”从 `BillingService` 条件分支中抽出来。金额仍应以 `apps/mvp-server/src/application.js` 服务端商品目录为准，不接受前端金额。

#### `services/account-billing/src/entitlement-service.js`

已落盘两项变化：

- `grant()` 增加 `startsAt`；`activeGrant()` 现在要求 `startsAt <= now < expiresAt`，这样可以提前持久化未来月份但不让未来额度提前可用；
- 增加 `sourceSummary(sourceId)`，返回 `{ granted, remaining }`，用于自动退款前判断某订单来源权益是否被消费。

**重要设计约束：** `pro_yearly` 不应简单在年付成功时只发 60 分钟，也不应一次性发 720 分钟。当前方向是在一笔年度 subscription cycle 成功时预建 12 个 `60 minute` grant，每个 grant 有独立 `startsAt/expiresAt` 月度窗口。

#### `services/account-billing/src/billing-service.js`

当前文件已被重写为中间态，语法检查 `node --check` 为 0，但尚未满足业务测试/文件长度门禁。已经落盘的核心方向：

- 订单创建时先在本地生成并保存 32 字符 `paymentRequestId` / `subscriptionRequest`，调用 `persist()` 后再发 gateway write；
- 一次性商品走 `gateway.createOrder()`；Pro 商品改走计划中的 `gateway.createSubscription()`；
- 退款新增本地 `refundRequestId`，自动退款前调用 `entitlements.sourceSummary(order source)`，若不是“完全未消费”则抛 `REFUND_MANUAL_REVIEW_REQUIRED`；
- 订阅退款直接阻断为人工审核；
- 写请求异常若 gateway 映射成 `WAFFO_STATUS_UNCONFIRMED`，订单保留 `pending_confirmation`，而不是直接当失败；
- Webhook 领域事件已扩展为 payment/refund/subscription pending/success/failure/renew/cancel 等状态；
- payment success 会核对 webhook 的 amount/currency（若提供）与本地订单一致后再发权益；
- 年付 12 个按月权益窗口的代码已写在当前 `billing-service.js` 内。

**当前问题：该文件 361 行。** 当前 `services/account-billing/scripts/check.mjs` 和顶层 quality gate 未发现会因行数直接失败的机械门禁；拆分仍然必要，理由是领域隔离、可审查性和多 agent ownership，而不是“行数门禁必然失败”。中断前原计划把 Webhook 处理拆到 `billing-webhook-processor.js`，但用户消息到来时 write 尚未成功，**该文件现在不存在**。不要误以为已经拆完。

### 12.3 尚未落盘的必要代码

以下都是下一位接手者必须完成的真实缺口：

1. `services/account-billing/src/store.js`
   - 还没有 `this.refunds = new Map()`；这是当前测试主要 TypeError 的直接原因。
2. `apps/mvp-server/src/persistent-store.js`
   - `MAP_FIELDS` 还没有 `refunds`；即使 MemoryStore 补了，也必须确保 refund request ID 可跨重启恢复。
3. `services/account-billing/fixtures/local-adapters.js`
   - `MockWaffoGateway` 还没有 `createSubscription()`；现有 Pro 支付测试更新后一定会遇到。
4. `packages/provider-adapters/src/waffo-gateway.js`
   - 尚未迁移到 `@waffo/waffo-node 3.0.1`；
   - 尚未实现 order create/inquiry UnknownStatus recovery；
   - 尚未实现 subscription create/inquiry/cancel UnknownStatus recovery；
   - 尚未实现 refund + refund inquiry；
   - 尚未解析 SDK `orderAction/subscriptionAction` 得到 hosted checkout URL；
   - 尚未提供/校验 `notifyUrl`、三类 redirect URL、`goodsName + goodsUrl`、user info、`ONE_TIME_PAYMENT`/`SUBSCRIPTION` 等正式字段。
5. 正式 SDK client 初始化
   - `apps/mvp-server/src/providers.js` 仍要求外部注入 `waffoClient`，尚未决定是继续组合根注入还是直接由 `Waffo` env config 创建；
   - 新 SDK 需要 `WAFFO_API_KEY`、`WAFFO_PRIVATE_KEY`、`WAFFO_PUBLIC_KEY`、`WAFFO_MERCHANT_ID`、明确 SANDBOX/PRODUCTION environment。
6. `apps/mvp-server/src/routes-billing.js`
   - 目前生产 Webhook 还是本地 HMAC `x-waffo-signature` + 自定义 event JSON；
   - 正式 Waffo 3.0.1 必须用 `X-SIGNATURE` 和 SDK `handleWebhook(rawBody, signature)`；
   - SDK response 要回 `X-SIGNATURE: responseSignature`，`Content-Type: application/json`，body 使用 SDK `responseBody` 原样返回；
   - 应在 SDK handlers 中把 Waffo notification **归一成 BillingService 的领域事件**，而不是把 Waffo payload 直接泄漏进领域层。
7. `.waffo/integration-manifest.json`
   - 尚未创建；新集成必须 schemaVersion 2；
   - features 应为 `order/refund/subscription`，不要加 `subscriptionChange`；
   - 必需 handlers 需要 validator 在**非测试生产代码**里扫到实际 SDK 注册调用；只在注释/字符串/测试里写 handler 名不算。
8. 测试
   - `services/account-billing/test/billing-admin.test.js` 尚未按新规则更新；
   - `packages/provider-adapters/test/waffo.test.js` 还是旧 `checkout.createSession` 契约；
   - `apps/mvp-server/test/http-flow.test.js` Webhook 仍是旧本地 HMAC 形态；
   - 需要新增 request-ID persist-before-call、UnknownStatus inquiry、refund request persistence、subscription create ID persistence、SDK webhook handler 注册/归一等覆盖。
9. 组合层持久化
   - `BillingService` 虽然支持注入 `persist()`，但 `MvpApplication` 当前没有传入 `persist: () => store.flush()`；真实 HTTP 路径尚未兑现“本地 request ID 先跨重启落盘，再进行 provider write”。
10. 共享返回字段
   - `MockWaffoGateway.createOrder()` 当前返回 `externalOrderId`，而中间态 `BillingService` 读取 `acquiringOrderId`；补 Mock 时必须以冻结后的 gateway port 为准，不能再引入兼容字段漂移。

### 12.4 当前最小诊断结果（中断时真实状态）

为避免把上一次绿灯误当成当前状态，中断前只做了诊断，不做修复：

```text
node --check services/account-billing/src/billing-service.js
=> PASS / exit 0

node --test services/account-billing/test/*.test.js
=> 26 tests
=> PASS 16
=> FAIL 10
=> exit 1

(cd apps/mvp-server && node scripts/check.mjs)
=> JavaScript 语法检查通过
=> exit 0

node /Users/bopop/.codex/skills/waffo-integrate/bin/waffo-verify.js . --json
=> exit 1
=> Missing .waffo/integration-manifest.json
```

账户计费当前失败的第一根因非常明确：

```text
TypeError: Cannot read properties of undefined (reading 'values')
at BillingService.#refundFromData
```

因为 `BillingService` 已开始读取 `store.refunds.values()`，但 `MemoryStore` 尚未增加 `refunds` Map。至少 9 个测试因此在 Webhook 记录/target 查找阶段提前失败。

另一个当前失败是旧测试仍尝试 `createOrder(free_monthly)`；新领域规则明确抛：

```text
FREE_PRODUCT_NOT_PURCHASABLE: 免费权益不能创建支付订单
```

这是**预期的新业务规则**，应更新测试为“Free 不能收费 + 免费月度权益由非支付流程发放”，而不是为了旧测试恢复 Free checkout。

修复 `refunds` 后预计还会继续暴露后续中断项，例如 `MockWaffoGateway.createSubscription()` 尚不存在、旧 refund mock 返回结构与新领域契约不一致等；不要假定补一个 Map 就能全绿。

### 12.5 接手后的最短正确执行顺序

1. **先不要改前端。** 当前主链路前端在 Waffo 重构前已经稳定，问题集中在计费/Provider/Webhook。
2. 补 `MemoryStore.refunds` + `PersistentStore MAP_FIELDS refunds`，让当前领域事件能完整落盘。
3. 把 361 行 `billing-service.js` 拆成 Billing command service + Webhook processor；保持现有行为，不要在拆分时顺手换状态语义。
4. 补/更新 `MockWaffoGateway` 的 `createSubscription/refundOrder` 返回契约，先让 `services/account-billing` 新业务测试全绿。
5. 重写 `packages/provider-adapters/src/waffo-gateway.js` 到官方 3.0.1 API；把 UnknownStatus same-key inquiry 封装在 gateway，领域层只接收“已确认状态/状态未知”的稳定 ProviderError。
6. 增加正式 Waffo client factory/config；生产缺任何 API key/private key/public key/MID/environment/redirect/notify 配置时 fail closed。
7. 新建 SDK Webhook adapter：注册 `onPayment`、`onRefund`、`onSubscriptionStatus`、`onSubscriptionPeriodChanged`，把 notification 归一成现有领域 event；subscription payment 必须与 one-time payment fulfillment 分流。
8. 更新 Provider/MVP HTTP tests；Mock 环境可以继续使用完全本地 fixture，但测试命名要明确“不代表 Sandbox”。
9. 创建 `.waffo/integration-manifest.json`，先登记已确认项与 unresolved 项，然后跑 validator 修到**代码层机械检查**允许继续；未确认项必须按 skill 规则保留 runtime `WAFFO_DECISION_REQUIRED` stub。
10. 账户计费/Provider/MVP 定向测试全绿后，从本文 **Step 1 → Step 2 → Step 3** 全部重跑。任何失败都重新从 Step 1 开始。
11. 最后才向 owner 收集剩余 Waffo 人工决策 + Sandbox 凭证并进入 Phase A/B/C/D。

### 12.6 不要做的事情

- 不要回退 `@waffo/waffo-node 3.0.1` 去继续维护旧 `pancake-ts` 接口；
- 不要因为当前测试红灯而恢复“Free 创建收费订单”；
- 不要把 Pro 年付改成一次性 720 分钟可用；已确认是按月 60、月末清零；
- 不要把 redirect 当支付成功事实；
- 不要在 UnknownStatus 时生成新 request ID 重试 write；
- 不要自动退款已消费权益或订阅，不能产生负余额；
- 不要实现 subscription change/upgrade/downgrade，本轮明确不做；
- 不要手写假的 Waffo webhook RSA 验签，正式链路用 SDK；
- 不要在没有 `payMethodConfig().inquiry()`/Sandbox 证据时声称 Apple Pay/Google Pay/某支付方式已支持；
- 不要生成正式 `integration-report-*.md`，直到 `waffo-verify --gate report` 真正通过。

### 12.7 Git/进程边界

- 本轮没有 `commit`、`merge`、`push`、`rebase`、`reset` 或 `clean`；
- 当前 `git status` 仅包含本 handoff 的本轮修改和本地 `.data/.pnpm-store` 状态（Phase 0 更新后以实际命令为准），不要删除本地状态；
- 本轮没有启动真实 Waffo 请求、没有产生真实订单/退款/订阅；
- 之前浏览器 smoke 启动的本地进程已经在前一阶段清理完；本次 Waffo 重构没有留下需要 handoff 的服务进程。

## 13. 2026-09-04 Codex with ChatGPT 连接恢复记录

### 13.1 现象与根因

- ChatGPT 中已经存在 `Codex with ChatGPT · SpeechOptimizer`，项目合集也已绑定，但 Codex 侧普通健康检查持续返回 `pid_unknown`，看起来像“连接器不可用”。
- 项目绑定、固定地址和连接器名称都没有变化；不是连接器被删除、授权失效或地址被回收。
- 根因是当前受限命令环境无法访问本地健康端点，也无权用 PID 信号确认进程是否存在。工具为了避免重复启动服务，把这种情况保守标记为 `unknown`；该结果是本地探测误报，不能直接推导为 ChatGPT 连接器失效。

### 13.2 已完成恢复与当前证据

- 在系统级环境重新执行健康检查后，项目识别、本地服务、未授权边界、授权入口和固定安全连接均为正常状态。
- 不需要删除、重命名或重建 `Codex with ChatGPT · SpeechOptimizer`。
- 已在 `SpeechOptimizer` ChatGPT Project 内创建并保存当前 C2C 会话。
- ChatGPT 已实际调用 `workspace_info`，返回 workspace `SpeechOptimizer`，并成功读取仓库顶层 `AGENTS.md`。这份端到端读取证据优先于受限环境中的 `pid_unknown` 误报。

### 13.3 后续恢复规则

1. 普通检查若返回 `pid_unknown`，先不要执行 `start`、`restart`，也不要删除或重复创建 ChatGPT 连接器。
2. 对同一项目改用系统级权限重新运行健康检查；只有系统级检查仍失败，才依据明确的 `namedRepair` / `chatgptRepair` 结果进入重新登录或重新授权流程。
3. 健康检查全绿后，直接复用已保存的 SpeechOptimizer ChatGPT 会话；新 Codex 会话从同一 Project 合集创建新聊天。
4. 最终可用性必须以 ChatGPT 成功执行 `workspace_info` 和读取仓库文件为准，不能只依赖受限环境中的进程探测结果。

## 14. 2026-09-04 ChatGPT 规划与多 agent 执行拆解

### 14.1 本轮结论与证据边界

- 已通过同一 `SpeechOptimizer` ChatGPT Project 会话完成只读规划，得到完整的 `STATE: PLAN`；规划结论与当前源码、测试和 canonical handoff 相互印证。
- 本阶段没有修改业务代码、没有创建新 commit，也没有启动真实 Waffo 请求；只更新了本 handoff，保存了新的总控聊天和可恢复的规划检查点。
- 当前实际工作树以 `main@d1432f3` 为基线，tracked diff 在 Phase 0 前为空；历史 `services/account-billing` `16/26 PASS, 10/26 FAIL` 只是未重新验证的线索，不作为本轮结果。
- MVP 主体当前已由 `d1432f3` 跟踪；并行 agent 必须以实际文件、测试输出和明确 ownership 为准，不能依赖过期的“源码未跟踪”描述。

### 14.2 并行前必须串行冻结的共享契约

协调者先完成一次契约冻结和 checkpoint，之后才启动 Wave 1。任何 agent 发现需要改变以下契约，必须停止并回报协调者，不得自行扩展：

1. Domain → Gateway port 保持 provider-agnostic：
   - `createOrder({ requestId, merchantOrderId, amount, currency, productCode, userId, userEmail, userCreatedAt }) → { acquiringOrderId, checkoutUrl }`；
   - `createSubscription({ requestId, merchantSubscriptionId, amount, currency, productCode, periodType, periodInterval, userId, userEmail, userCreatedAt }) → { externalSubscriptionId, checkoutUrl }`；
   - `refundOrder({ refundRequestId, acquiringOrderId, amount, currency, reason }) → { acquiringRefundOrderId? }`；
   - `cancelSubscription({ externalSubscriptionId, subscriptionRequest }) → normalized result`。
2. UnknownStatus 只能对同一 key 做 inquiry：order 用同一个 `paymentRequestId`，subscription 用同一个 `subscriptionRequest`，refund 用同一个 `refundRequestId`；无法确认时统一为 `WAFFO_STATUS_UNCONFIRMED`，禁止再次 write。
3. 资金侧状态顺序固定为：`mutate local state/request-id → await persist() → provider write`。`MvpApplication` 必须真正注入 `persist: () => store.flush()`。
4. Webhook 适配层只向领域层发送 `{ id, version, type, occurredAt, data }` 形式的归一化事件。`subscription.payment` 不得复用一次性 `order.paid` 权益发放路径。
5. 业务策略固定：Webhook 是事实源；Hosted Checkout；USD；月付每周期 60 分钟；年付本地为 12 个独立月窗口；取消到期生效；新周期扣款失败不发新权益；已消费或订阅退款转人工；本轮不实现 `subscription.change/update`。

跨包 contract、shared type、schema、根配置、依赖和 lockfile 不允许由多个 agent 并行修改。实际派发时按当前用户指令统一使用 `gpt-5.6-luna`；reasoning effort 只能使用 `xhigh` 或 `max`，复杂实现/审查优先 `max`。tri-agent 的角色名称只用于说明任务性质，不覆盖该模型约束。

### 14.3 Wave 1：三个边界清晰的并行 agent

三个 agent 共享当前工作树或由 harness 提供隔离，但严格按目录 ownership 工作。当前 MVP 源码已 tracked；如果使用可靠的隔离 worktree，必须从同一 `d1432f3` 基线创建并由协调者整合，禁止 agent 自行创建/合并分支。不得删除 `.data/`、`.pnpm-store/` 或其他用户状态来获得“干净”。

#### Agent A — Account Billing Domain Recovery

**Ownership：** `services/account-billing/**`。

**目标：** 让 account-billing 恢复为自洽、可测试的领域包，并把 Webhook 状态机从 command service 中拆出。

**必须完成：**

- `src/store.js` 增加 `refunds = new Map()`；
- 将 Webhook 处理拆到 `src/billing-webhook-processor.js`，`BillingService.processWebhook()` 只做委托；
- 保留 request ID、persist-before-provider-write、Free 禁止收费、退款未消费自动路径和已消费/订阅人工审核规则；
- `fixtures/local-adapters.js` 补 `createSubscription()`，并把 Mock 的 `acquiringOrderId`、subscription、refund 返回值统一到冻结后的 gateway port；
- 更新 account-billing 测试：先创建本地 subscription 再发送 Webhook，补月付/年付窗口、重复/乱序/失败/cancel、refund persistence 与 persist ordering；旧的 Free checkout 和“已消费后仍自动退款”断言改成新业务规则。

**禁止：** 不改 `apps/`、`packages/provider-adapters/`、`prototype/`，不自行改变跨包契约或产品价格事实源。

**验收：**

```bash
pnpm --dir services/account-billing run check
pnpm --dir services/account-billing run test
pnpm --dir services/account-billing run build
```

#### Agent B — Official Waffo 3.0.1 Gateway

**Ownership：** `packages/provider-adapters/**`，仅限该包已有文件和测试；必要 export 也由该 agent 负责。

**目标：** 只重写 Provider adapter，彻底移除旧 `checkout.createSession` / `orders.cancelSubscription` 假设，领域层不感知 SDK payload。

**必须完成：**

- 适配已安装的 `@waffo/waffo-node 3.0.1`：order create/inquiry/refund、subscription create/inquiry/cancel、refund inquiry；
- 正确处理 SDK `ApiResponse.isSuccess()/getData()/getCode()/getMessage()`，非成功 response 转稳定 `ProviderError`；
- 解析 `orderAction/subscriptionAction` 的 hosted checkout `webUrl`，字段缺失时 fail closed 为 `WAFFO_INVALID_RESPONSE`；
- USD minor → SDK decimal string 使用单一 helper；
- 注入 SDK client 和 `isUnknownStatusError` predicate，不把 merchant secret 写入日志，不改变依赖拓扑；
- 对 order/subscription/refund/cancel 按共享契约做 same-key inquiry，禁止 UnknownStatus 后生成新 write key。

**禁止：** 不改 `apps/mvp-server` 的配置、组合根、路由或 lockfile；若官方 SDK 需要改变依赖拓扑，回报协调者串行处理。

**验收：**

```bash
pnpm --dir packages/provider-adapters run check
pnpm --dir packages/provider-adapters run test
pnpm --dir packages/provider-adapters run build
```

测试至少覆盖 one-time/subscription 参数映射、三类 UnknownStatus、cancel inquiry、失败 response、畸形 action、不可用 gateway 和 `createSubscription`。

#### Agent C — MVP Server Persistence / SDK Composition / Webhook HTTP

**Ownership：** `apps/mvp-server/**`。

**目标：** 负责应用组合根、正式 SDK 配置和 HTTP Webhook 集成；不改 Domain 与 Provider package 的实现。

**必须完成：**

- `src/persistent-store.js` 的 `MAP_FIELDS` 加入 `refunds`，并补重启 round-trip；
- `MvpApplication` 构造 `BillingService` 时传入 `persist: () => store.flush()`，测试证明 provider write 发生前已 flush；
- 在 `src/config.js` / `.env.example` 明确 API key、merchant private key、Waffo public key、merchant ID、SANDBOX/PRODUCTION、notify URL、success/failed/cancel redirect、goods metadata；生产缺资金关键配置时 fail closed；
- `src/providers.js` 形成正式 SDK client 的组合根，同时保留测试 fake client 注入；为 gateway 注入 `WaffoUnknownStatusError` predicate；日志不得泄露密钥；
- `src/routes-billing.js` 生产路径改为 `X-SIGNATURE`、SDK `handleWebhook(rawBody, signature)` 和 SDK response body/signature；注册 payment/refund/subscription handlers，并将 notification 归一为领域事件；客户端身份/邮箱等敏感字段以服务端账户为准；
- 更新 HTTP/config 测试，明确 Mock fixture 不等于 Sandbox 证据，覆盖 one-time 与 subscription payment 分流、重复/乱序/签名失败和 restart persistence。

**禁止：** 不改 `services/account-billing/**` 和 `packages/provider-adapters/**`；不自行决定 `userTerminal`、subscription mode/retry、Go-Live Q1–Q8 或支付方式；若需要依赖升级、schema 变更或根配置变化，停止并回报协调者。

**验收：**

```bash
pnpm --dir apps/mvp-server run check
pnpm --dir apps/mvp-server run test
pnpm --dir apps/mvp-server run build
```

### 14.4 Wave 2：串行跨包整合 agent

#### Agent D — Cross-package Contract Integration

**启动条件：** Agent A/B/C 各自定向门禁通过，且协调者已读取实际 changed files 和测试结果。

**Ownership：** 可跨越上述三个包，但仅修接口拼接，不做功能扩张；同一时刻不得再让 A/B/C 修改共享边界。

**检查重点：**

- Mock、gateway、BillingService 的字段完全一致，特别是 `acquiringOrderId` / `externalSubscriptionId` / refund 三方 ID；
- request ID 在真实 provider write 前已经 flush；
- subscription 必须先有本地 record，Webhook 不凭空创建业务对象；
- Waffo subscription payment 不进入一次性 order fulfillment；
- 年付仍是 12 个独立 60 分钟窗口，不出现一次性 720 分钟；
- production 缺 API key/private key/public key/MID/environment/notify/redirect/goods URL 时启动失败；
- 不引入 `subscription.change/update`。

**验收：**

```bash
pnpm --dir services/account-billing test
pnpm --dir packages/provider-adapters test
pnpm --dir apps/mvp-server test
```

任何接口错误由 D 单独收口；若必须改变某个 agent 的核心行为，应记录原因并重新回到该 agent 的定向测试，不要三方再次同时改同一文件。

### 14.5 Wave 3：manifest 与独立审查

#### Agent E — Waffo Manifest / Validator

**Ownership：** `.waffo/**`，并可对生产代码做只读检查。

**要求：** 新建 schemaVersion 2 manifest，features 仅声明 `order/refund/subscription`；不要声明 `subscriptionChange`；把已确认范围和 unresolved 人工决策分开登记；validator 必须在非测试生产代码里找到实际 SDK handler 注册；未确认的资金决策只能保留 runtime fail-closed / `WAFFO_DECISION_REQUIRED`，不能伪造确认。没有 Sandbox 证据时，不生成正式 integration report。

#### Agent F — Independent Regression / Security Review

**性质：** 只读审查，默认不修改 prototype 或业务代码。

**审查：** request-ID durability、UnknownStatus、Webhook 签名/重复/乱序、subscription/one-time 分流、refund 不产生负权益、Cookie/CORS/admin authorization、secret/log redaction、production fail closed、删除/恢复流程，以及 tracked/untracked 边界和生成物污染。

### 14.6 依赖图与最终门禁

```text
串行契约冻结 / handoff checkpoint
              ↓
       A  ╲    B    ╱  C       （Wave 1 并行）
              ↓
       D：跨包接口整合（串行）
              ↓
       E：manifest/validator  ║  F：独立审查（可并行）
              ↓
       定向门禁 → Step 1 → Step 2 → Step 3 → HTTP smoke → Chrome smoke
```

所有代码实现合并后，最终顺序固定为：

1. account-billing / provider-adapters / mvp-server 定向测试；
2. prototype tests；
3. apps/mvp-server check、test、build；
4. `git diff --check`；
5. `CI=1 node scripts/quality-gate.mjs all --require-feature-tests`；
6. `CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests`；
7. 独立安全/逻辑审查；
8. 本地 HTTP smoke；
9. 375 / 768 / 1440 三个 viewport 的 Chrome smoke，覆盖录音 → 分析 → 报告；
10. 支付 UI 只用 Mock，禁止真实收费；
11. 更新本 handoff，区分 local integration complete 与 external validation blocked。

任意代码修复发生在第 1–6 步之后，都必须从第 1 步重新开始。真实 Waffo Sandbox 只在本地全绿后进行，且仍需 owner 提供 `userTerminal`、subscription mode/retry、Go-Live Q1–Q8、compliance/goods URL、Sandbox credentials、HTTPS notify/redirect 域名、实际支付方式和 order/refund/subscription/Webhook 端到端证据。

### 14.7 Agent 交付格式与安全边界

每个 leaf agent 完成后只回报以下摘要，并等待协调者整合：

```text
STATUS: DONE | BLOCKED | ESCALATE
Scope completed:
Files changed:
Behavior changed:
Verification:
Pre-existing failures:
Residual risks:
```

leaf agent 不得 spawn 子 agent，不得 commit、stash、切换/创建分支、reset、restore、rebase、merge、push 或删除其他 agent/用户文件；发现超出 ownership、需要 shared contract/schema/root config/dependency 变化、或测试失败根因跨界时，返回 `ESCALATE`，由协调者重新排程。协调者必须在每个 agent 返回后读取实际文件和验证证据，不能只相信口头“完成”。

## 15. 2026-09-04 Wave 1 实际执行检查点（历史汇总）

> 历史说明：15.1–15.15 是按时间保存的旧检查点，其中“当前”仅指各自记录时刻；任何与线上部署、PR 合并、域名状态或源码分支冲突的表述均已由 15.16 supersede。恢复任务只把第 0 节和 15.16 作为当前入口。

本节 supersede 第 12.3、12.4、12.5 节中“尚未落盘/中断时状态”的描述；第 12 节保留为历史诊断证据，不得作为当前工作树事实。

### 15.1 总控与执行拓扑

- 总控：同一 `SpeechOptimizer` ChatGPT Project 内的新聊天，已通过 C2C `workspace_info` 和顶层 `AGENTS.md` 读取验证，并返回当前 workspace 名称。
- 执行器：本 Codex 会话，负责本地改动、子代理派发、独立验证、整合和纠偏。
- 本轮不再调用 DevSpace；Wave 1 使用 Codex 内置 bounded agent 工具，三个 agent 均显式使用 `gpt-5.6-luna` + `max`。
- Wave 1 agent：A `01a06a8d-3957-7a01-8cb5-86d18d035f8b`、B `01a06a8d-38dd-7ca1-a5fa-966cd2f7a577`、C `01a06a8d-39e1-7d41-a5f7-5ab646040e63`；均已返回 `STATUS: DONE`，未 commit/push/merge。

### 15.2 Wave 1 落盘范围

- A（`services/account-billing/**`）：增加 `refunds` Map、持久化前 request ID、Webhook processor 拆分、Mock subscription/refund port 对齐、Free/订阅/退款/年付月窗口规则和回归测试。
- B（`packages/provider-adapters/**`）：接入官方 `@waffo/waffo-node@3.0.1` 的 order/subscription/refund API，统一响应归一、Hosted Checkout URL、USD minor 金额转换和同 key inquiry。
- C（`apps/mvp-server/**`）：接入官方 SDK client factory、生产配置 fail-closed、原始 body + `X-SIGNATURE` Webhook、SDK response 原样返回、handler 归一化、refund persistence 和组合根 persist 注入。
- C 另外删除了 `apps/mvp-server/scripts/build.mjs` 中不再需要的 spike SDK 复制项，并新增 provider/Webhook/persistence 集成测试；这些修改均在其 ownership 内。
- 当前新增/修改源文件、测试和文档均未提交；`.data/`、`.pnpm-store/` 是本地状态/依赖目录，不纳入本轮代码判断。

### 15.3 主控独立验证证据

以下均为当前工作树由主控实际执行的结果，而非仅代理自报：

```text
PATH=... CI=1 pnpm --dir services/account-billing run check
=> exit 0
PATH=... CI=1 pnpm --dir services/account-billing run test
=> 29/29 pass, 0 fail, 0 cancelled, 0 skipped
PATH=... CI=1 pnpm --dir services/account-billing run build
=> exit 0

PATH=... CI=1 pnpm --dir packages/provider-adapters run check
=> exit 0
PATH=... CI=1 pnpm --dir packages/provider-adapters run test
=> 34/34 pass, 0 fail, 0 cancelled, 0 skipped
PATH=... CI=1 pnpm --dir packages/provider-adapters run build
=> exit 0

PATH=... CI=1 pnpm --dir apps/mvp-server run check
=> exit 0
PATH=... CI=1 pnpm --dir apps/mvp-server run test
=> 31/31 pass, 0 fail, 0 cancelled, 0 skipped
PATH=... CI=1 pnpm --dir apps/mvp-server run build
=> exit 0
git diff --check
=> exit 0
```

第一次主控执行 mvp-server check 时，受限沙箱无法从 npm 获取 `@waffo/waffo-node@3.0.1`，返回 `EPERM/fetch failed`；在受控本机环境重新执行后依赖解析和 check 均通过。该失败记录为环境限制，不是代码通过证据，也不代表真实 Waffo 业务联调成功。

### 15.4 当前未完成与下一步

- Wave 2 D 尚未启动：需串行复核三包返回字段、persist-before-write、订阅 Webhook 本地记录约束、subscription payment 分流和年付 12×60 分钟窗口；必要修复只限跨包接口拼接。
- `.waffo/integration-manifest.json` 尚未创建；完成后必须运行 validator，并保持未确认的 `userTerminal`、subscription mode/retry、Go-Live Q1–Q8、compliance/goods URL 为 unresolved/runtime fail-closed。
- 仍需完成独立安全/正确性审查、prototype 定向测试、两轮全量 quality gate、HTTP smoke、真实浏览器 smoke 和最终 diff 审查。
- 当前只能称为“Wave 1 本地集成定向门禁通过”；不能称为 MVP 已可上线，也不能称为 Waffo Sandbox/生产支付通过。

### 15.5 ChatGPT Wave 1 审查 findings 与 D 任务入口

ChatGPT 已读取本轮 execution output、当前 git diff 和 `@waffo/waffo-node@3.0.1` 类型定义；三包测试证据真实有效，但以下问题阻止进入 Wave 3：

- MAJOR-1：provider write 成功/明确失败/UnknownStatus 后，资金结果不能依赖 HTTP route 偶然 flush；BillingService 必须在结果状态变更后自行 persist。取消失败要撤销未被 provider 接受的取消意图；退款明确失败要落为 failed，允许新 attempt，UnknownStatus 仍禁止第二次 write。
- MAJOR-2：启动恢复增加 inquiry-only billing reconciliation：order/subscription/refund 使用原 request ID inquiry，绝不在恢复阶段重放 create/refund/cancel write；recovery 不直接发权益，未确认仍保持 pending_confirmation。
- MAJOR-3：Provider UnknownStatus inquiry 必须按 operation/status 证明原 mutation；退款失败、取消仍 ACTIVE、创建结果缺字段等不能被误判为成功，只有确证成功才返回 recovered success。
- MAJOR-4：`userCreatedAt` 在 adapter 边界从有限 epoch milliseconds 归一为 ISO-8601 string，真实 AuthService/MVP 数字时间戳需有跨包回归覆盖。
- MAJOR-5：订阅周期发权益前校验通知 amount/currency 与本地 subscription order 一致；不一致时返回签名失败、不写 processed event、不发权益。
- MAJOR-6：Waffo 未知 event/status/period 组合必须 fail closed，不能静默降级为 pending 并 ACK。
- MAJOR-7：账户删除和重启快照必须清理新增 `refunds` 读模型及其关联 PII。

下一步只启动一个 `gpt-5.6-luna` + `max` 的 Agent D，ownership 为 `services/account-billing/**`、`packages/provider-adapters/**`、`apps/mvp-server/**`，只修上述 findings 及直接暴露的接口问题；不改 prototype、不创建 manifest、不实现 subscription change/update。D 完成后由主控独立重跑三包 check/test/build、`git diff --check`，若仍有任一 MAJOR 或失败则继续纠偏，不进入 Wave 3。

### 15.6 Wave 2 主控本地收口检查点（2026-09-04）

- Agent D `01a06abc-84d6-7d32-b901-9d76f3ec3b88` 已按用户约束请求 `gpt-5.6-luna` + `max`，但因账户用量限制直接失败，未产生可采纳的文件改动；没有重试该失败路径，也没有改用 DevSpace。
- 主控在同一工作树完成 D 计划的等价修复：BillingService 对 provider write 结果自持久化；启动阶段对订单/订阅/退款只做原 request ID inquiry；Waffo adapter 按 operation/status 判定 UnknownStatus 恢复；AuthService 时间戳归一为 ISO 字符串；订阅激活校验本地订单 amount/currency；未知 Waffo event/status/period fail closed；账户 purge 清理 refunds。
- 关键文件：`services/account-billing/src/billing-service.js`、`services/account-billing/src/billing-webhook-processor.js`、`packages/provider-adapters/src/waffo-gateway.js`、`packages/provider-adapters/src/waffo-gateway-support.js`、`apps/mvp-server/src/index.js`、`apps/mvp-server/src/application.js`、`apps/mvp-server/src/waffo-webhook.js` 及对应三包测试。
- 当前主控验证：account-billing `pnpm test` 33/33；provider-adapters `pnpm test` 38/38；mvp-server `CI=true pnpm test` 34/34；三包 `check` 与 `build` 均 exit 0；`git diff --check` exit 0。mvp-server 测试使用受控权限以允许临时回环 HTTP 服务。
- 当前未完成：`.waffo/integration-manifest.json` 与 validator、prototype 最新测试、两轮完整 quality gate、独立只读安全审查、HTTP smoke、最终浏览器 smoke。当前仍不得称为 MVP 已上线或 Waffo Sandbox 已通过。
- 下一步最短顺序：创建 schemaVersion 2 manifest（不伪造未确认的人工作业决策）→ 运行 `waffo-verify` → 读取/修正机械错误 → 从 Step 1 重新执行完整门禁。

### 15.7 2026-09-04 当前项目恢复核验与详细交接（历史 checkpoint）

本节 supersede 第 1、4.4、6.1、7.4、8、15.4、15.6 中所有与“当前状态”冲突的旧描述；旧章节仍保留为历史演进和失败诊断证据。接手者从本节和第 0 节恢复，不要回到第 12 节旧中断点。

#### 15.7.1 当前阶段与模块进度

| 模块 | 当前磁盘事实 | 本次验证/状态 |
| --- | --- | --- |
| MVP 基线 | `d1432f3` 已包含语音分析、账户、权益、HTTP、React prototype 和本地基础设施基线 | 历史稳定基线，不等于当前工作树最终绿灯 |
| `services/account-billing` | Waffo 资金 request ID、write 结果持久化、启动 inquiry-only reconciliation、订阅/退款/权益规则、Webhook processor 已落盘 | test 33/33、check/build PASS；`billing-service.js` 328 行违反 300 行硬上限 |
| `packages/provider-adapters` | 官方 `@waffo/waffo-node 3.0.1` order/subscription/refund、Hosted Checkout、UnknownStatus 同键 inquiry、响应归一已落盘 | test 38/38、check/build PASS；`waffo-gateway-support.js` 381 行违反 300 行硬上限 |
| `apps/mvp-server` | 官方 SDK client factory、生产 fail-closed、原始 body + `X-SIGNATURE` Webhook、持久化组合、Waffo HTTP 集成测试已落盘 | check/build PASS；test 5/34 pass、29 fail：27 个 loopback `EPERM` + 2 个真实 production fixture/decision 失败 |
| `prototype` | 真实 API/state 接线、录制/上传/处理/报告/比较/历史/计费/隐私/认证/管理界面仍在当前代码中 | `node --test prototype/tests/*.test.mjs` 19/19 PASS；当前代码的真实浏览器 smoke 未重跑 |
| Waffo manifest | `.waffo/integration-manifest.json` 已存在，schemaVersion 2；已确认项和 unresolved 决策分离 | handoff 先前记录基础 validator 0 errors / 0 warnings；本次重跑入口被安全策略拦截，需后续补新证据 |

#### 15.7.2 本次重新执行的验证证据

```text
pnpm --dir services/account-billing test
=> 33/33 pass
pnpm --dir services/account-billing run check
=> exit 0
pnpm --dir services/account-billing run build
=> exit 0

pnpm --dir packages/provider-adapters test
=> 38/38 pass
pnpm --dir packages/provider-adapters run check
=> exit 0
pnpm --dir packages/provider-adapters run build
=> exit 0

node --test prototype/tests/*.test.mjs
=> 19/19 pass

CI=true pnpm --dir apps/mvp-server run check
=> PASS
CI=true pnpm --dir apps/mvp-server run build
=> PASS
CI=true pnpm --dir apps/mvp-server test
=> 5/34 pass, 29 fail
=> 27 failures: listen EPERM: operation not permitted 127.0.0.1
=> 2 failures: apps/mvp-server/test/providers.test.js
   WAFFO_DECISION_REQUIRED: subscriptionMode

git diff --check
=> exit 0
```

本轮没有执行 Step 2 第一轮完整 quality gate，也没有执行 Step 3 `TZ=UTC` 第二轮，因为 Step 1 的 mvp-server test 已经真实红灯。按仓库规则，不能跳过失败继续制造“全量通过”结论。

#### 15.7.3 当前第一根因与不要误判的环境噪音

真实代码/测试一致性问题只有当前已确认的两个 production fixture 失败：`apps/mvp-server/test/providers.test.js` 的 `productionConfig()` 提供了 `waffoUserTerminal`，但没有同步 `src/config.js` 新增的 `waffoSubscriptionMode` 和 `waffoSubscriptionRetryPolicy` fail-closed 决策字段。接手实现时要让测试 fixture 与生产配置契约一致，但测试数据只能用于验证配置行为，**不得顺手把 manifest 中 unresolved 的真实商户决策改成 CONFIRMED_BY_HUMAN**。

其余 27 个 mvp-server 失败均为当前运行环境不允许绑定 `127.0.0.1` 的 `EPERM`，这是环境限制，不是业务通过或业务失败证据。在允许 loopback 的本机/受控环境重跑之前，HTTP 测试状态必须保持“未验证/被环境阻断”。

此外，本次发现两个仓库规则层面的质量问题：

- `services/account-billing/src/billing-service.js`：328 行；
- `packages/provider-adapters/src/waffo-gateway-support.js`：381 行。

根 `AGENTS.md` 规定单文件 ≤300 行，因此即使对应单测当前全绿，也不能在不处理该问题的情况下声明达到仓库最终质量门禁。拆分应保持行为和公共契约不变，拆分后必须重跑各自 test/check/build。

#### 15.7.4 本次 Failed Attempts / 环境限制

- 第一次直接执行 `pnpm --dir apps/mvp-server test` 时，pnpm 在非 TTY 环境触发 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，测试本身尚未开始；按提示改为 `CI=true` 后才得到上面的真实 5/34 结果。后续自动化环境统一使用 `CI=1/true`，不要为此修改 lockfile 或依赖策略。
- 本次尝试直接执行 `node /Users/bopop/.codex/skills/waffo-integrate/bin/waffo-verify.js . --json` 时，被当前运行环境安全策略拦截；随后检查当前可调用工具，没有等价 Waffo validator 工具入口。因此本轮不能声称重新运行 validator 成功，也不要机械重复同一被拦截调用。
- 历史 mvp-server 34/34 与 validator 0 errors / 0 warnings 仍可作为历史/既有证据，但当前配置和执行环境已经变化；在新的 Step 1 和 validator 重跑完成前，不得把它们提升为本轮绿灯。

#### 15.7.5 Git 恢复点与文件边界

```text
branch: main
HEAD: d1432f36fb03899c70bce22fd5284e42632b1412 (d1432f3)
remote relation: origin/main behind 0 / ahead 1
working tree: dirty
```

当前 tracked 修改集中在 `apps/mvp-server/**`、`packages/provider-adapters/**`、`services/account-billing/**` 和本 canonical handoff。新增但尚未提交的实现/测试文件包括：

- `apps/mvp-server/src/waffo-webhook.js`
- `apps/mvp-server/test/persistent-store.test.js`
- `apps/mvp-server/test/providers.test.js`
- `apps/mvp-server/test/waffo-integration.test.js`
- `packages/provider-adapters/src/waffo-gateway-support.js`
- `packages/provider-adapters/test/waffo-fixtures.js`
- `services/account-billing/src/billing-webhook-processor.js`

未跟踪本地状态目录包括 `.data/`、`.pnpm-store/`、`.waffo/`。其中 `.waffo/integration-manifest.json` 是本轮需要保留的集成状态文件；`.data/` / `.pnpm-store/` 不应为了“干净工作树”被擅自删除。当前会话没有执行 commit、push、merge、rebase、reset、clean 或 stash。

#### 15.7.6 接手后的最短正确顺序

1. 先只修 `apps/mvp-server/test/providers.test.js` 与 fail-closed production config 的 fixture/契约一致性；不要替用户回答真实 `subscriptionMode` / retry 商户决策。
2. 行为保持地拆分 `billing-service.js` 和 `waffo-gateway-support.js` 到 ≤300 行；只移动内部职责，不扩大公共 API/schema/shared contract。
3. 重跑 account-billing 和 provider-adapters 的 test/check/build，确认拆分没有回归。
4. 在允许 loopback 的环境执行 `CI=1 pnpm --dir apps/mvp-server test`，必须取得新的 34/34 或记录剩余真实失败；若仍失败，先修根因，不进入全量门禁。
5. 在允许执行 validator 的环境重跑 `waffo-verify.js . --json`；若机械检查仍为 0 errors / 0 warnings，再把它写成新的当前证据。unresolved 决策继续保持 unresolved。
6. 任何代码修复完成后从第 9 节 Step 1 重新开始；Step 1 绿后执行第一轮完整 quality gate，再执行独立 `TZ=UTC` 第二轮。
7. 双轮绿后做独立只读安全/正确性审查，重点检查 Cookie/CORS/管理员授权、恢复幂等、Webhook 签名与乱序、UnknownStatus、生产 fail-closed、日志脱敏和未跟踪文件范围。
8. 最后做本地 HTTP smoke + 真实浏览器 smoke（375/768/1440 至少覆盖匿名冷启动、录制/上传、处理、报告、比较、失败/取消/重试、登录/退出、历史/删除、计费 UI）；不要触发真实收费。
9. 只有上述本地交付链路完成后，再向 owner 收集 Waffo 未决人工答案、Sandbox MID/credentials、HTTPS webhook/redirect、payment method 证据，进入 Sandbox/Go-Live 阶段。

当前没有任何新业务代码计划被本次交接任务“默认授权落盘”；本次只整理状态、重新验证并更新 handoff。下一位实现者应把第 15.7.6 节视为直接执行入口。

### 15.8 2026-09-04 本地 MVP 实现收口与最终验证（历史 checkpoint）

本节 supersede 第 15.7 节及前文所有与“当前本地实现仍有 fixture/行数/loopback/validator blocker”冲突的描述。当前恢复入口为第 0 节 + 本节。

#### 15.8.1 本轮实际落盘

1. 修复 `apps/mvp-server/test/providers.test.js` 的 production fixture：补入**仅用于测试**的显式 subscription mode/retry 值，使测试能验证生产组合根，同时继续保持 `.waffo/integration-manifest.json` 中真实商户决策为 `UNRESOLVED`，没有伪造 `CONFIRMED_BY_HUMAN`。
2. 将 `BillingService` 的启动资金对账拆到 `services/account-billing/src/billing-reconciler.js`；恢复阶段仍只 inquiry 已有 request ID，不重放 create/refund/cancel write，不直接发权益。
3. 将 Waffo SDK ApiResponse 解包、UnknownStatus 同键 inquiry、operation/status 恢复判定拆到 `packages/provider-adapters/src/waffo-gateway-response.js`；`waffo-gateway-support.js` 只保留配置、输入、商品、金额和时间转换职责。
4. 最终审查发现 `apps/mvp-server/src/application.js` 仍超过根 `AGENTS.md` 的 300 行硬规则，进一步行为保持拆分：
   - `application-analysis-support.js`：speech processor、analysis attempt/hold/usage helper；
   - `product-catalog.js`：服务端商品目录和 `UNKNOWN_PRODUCT` 边界；
   - `application.js` 保留组合和业务编排。
5. 没有修改 Waffo 已冻结的跨包 port、商品价格、Webhook Source of Truth、年付 12×60 分钟窗口、退款人工审核边界或 subscription change 范围。

最终关键源码行数：

```text
apps/mvp-server/src/application.js                         294
apps/mvp-server/src/application-analysis-support.js         78
apps/mvp-server/src/product-catalog.js                      18
services/account-billing/src/billing-service.js            265
services/account-billing/src/billing-reconciler.js          85
services/account-billing/src/billing-webhook-processor.js  299
packages/provider-adapters/src/waffo-gateway-support.js     157
packages/provider-adapters/src/waffo-gateway-response.js    234
```

当前对 `apps/`、`packages/`、`services/` 非 dist `src/*.js` 的扫描没有任何文件超过 300 行。

#### 15.8.2 Step 1 与双轮质量门禁

所有代码拆分完成后，按规则从 Step 1 重新开始，当前工作树证据为：

```text
node --test prototype/tests/*.test.mjs
=> 19/19 pass

pnpm --dir services/account-billing run check
pnpm --dir services/account-billing run test
pnpm --dir services/account-billing run build
=> check/build PASS, test 33/33 pass

pnpm --dir packages/provider-adapters run check
pnpm --dir packages/provider-adapters run test
pnpm --dir packages/provider-adapters run build
=> check/build PASS, test 38/38 pass

CI=1 pnpm --dir apps/mvp-server run check
CI=1 pnpm --dir apps/mvp-server run test
CI=1 pnpm --dir apps/mvp-server run build
=> check/build PASS, test 34/34 pass

git diff --check
=> exit 0

CI=1 node scripts/quality-gate.mjs all --require-feature-tests
=> 全部门禁通过

CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests
=> exit 0 / 全部门禁通过
```

两轮 quality gate 均覆盖 prototype 生产构建/Sites/功能测试、SDK spike、speech-engine、provider-adapters、core-platform、account-billing、mvp-server 与 infra 静态/契约检查。当前机器仍未检测到 Compose v2，因此 infra 结果不等于 PostgreSQL/MinIO/Mailpit 容器已运行。

#### 15.8.3 Waffo validator 当前证据

最终重新执行：

```text
node /Users/bopop/.codex/skills/waffo-integrate/bin/waffo-verify.js . --json
=> errors: []
=> warnings: []
=> features: order / refund / subscription
=> actual handlers found:
   onPayment
   onRefund
   onSubscriptionStatus
   onSubscriptionPeriodChanged
```

validator 同时确认 live `WAFFO_DECISION_REQUIRED` stub 仍在 `apps/mvp-server/src/config.js`。以下 decision 继续保持 unresolved：`userTerminal`、`iframeDeviceWalletHandling`、Go-Live Q1–Q8、`complianceExemption`、`subscriptionMode`、`subscriptionRetryConfig`。因此当前只能说明**机械 SDK 集成检查通过**，不能生成正式 Waffo integration report，也不能宣称 Sandbox/生产支付通过。

#### 15.8.4 只读安全/正确性审查

在双轮门禁后审查当前 diff，未发现新的 BLOCKER/MAJOR。重点核对结果：

- 资金 write 仍满足 `local mutation/request-id -> await persist() -> provider write`；
- UnknownStatus 只使用同一 request ID inquiry，inquiry 不能证明 mutation 成功时保持 `WAFFO_STATUS_UNCONFIRMED`；
- 正式 Webhook 使用官方 SDK `X-SIGNATURE` 验签与签名响应，未知 event/status/period fail closed；
- subscription payment 不进入一次性 order fulfillment；
- 退款不会为已消费权益或订阅自动制造负权益；
- refund request/读模型可跨重启持久化，账户删除会清理 refunds 及相关 PII；
- 生产配置缺关键 Provider/Waffo 配置或未确认资金 decision 时拒绝启动；
- Waffo SDK logger 不记录 private key/API key/完整 payload；
- diff 未发现 `console.log/debug`、TODO/FIXME/HACK 调试残留，`git diff --check` 通过。

#### 15.8.5 HTTP 与真实 Chrome smoke

使用全新的 `/private/tmp` 数据目录启动开发/Mock API 和 Vite，没有读取或覆盖用户仓库内现有 `.data/`。

HTTP：

```text
GET http://127.0.0.1:8787/health
=> 200, { status: "ok", mode: "mock" }

OPTIONS /api/v1/session
Origin: http://127.0.0.1:5173
=> 204
=> Access-Control-Allow-Origin: http://127.0.0.1:5173
=> Access-Control-Allow-Credentials: true
```

Chrome Headless 使用本机 Chrome + Codex runtime 已存在的 Playwright：

- 375px 匿名冷启动页面正常，`scrollWidth === clientWidth`；冷启动阶段 `/api/v1/session` 的 401 是匿名 fallback 前的预期探测，随后页面正常初始化；
- 使用内存生成的 1 秒无隐私 WAV，UI 从文件选择进入 `Analyze this take`；
- 真实执行 create → binary upload → processing → `/analysis/<id>/report`；
- 最终报告实际渲染 `Speaking rate`、`Filler words`、`Long pauses`，375px 无横向溢出且无 page error；
- 375 / 768 / 1440 三个 viewport 逐一验证 `/`、`/history`、`/pricing`、`/settings/billing`、`/settings/privacy`、`/admin`、`/contact`，全部 `scrollWidth <= clientWidth` 且无 page error；
- 匿名 Billing/Admin 正确显示登录/权限受限状态，没有触发购买或真实支付。

本轮**没有把账户登录/退出写成新的浏览器证据**；认证、Magic Link、OAuth local fake、session/logout 和权限边界仍由当前 account-billing/mvp-server 自动化测试覆盖。不要把这点改写成“浏览器登录已验收”。

本轮启动的 API/Vite 进程均已停止，8787/5173 未留下监听进程。临时 smoke 目录 `/private/tmp/speechoptimizer-smoke.slDjKY` 只包含本轮本地生成的 JSON 状态；安全策略拒绝了 `rm -rf` 清理命令，因此没有绕过策略删除。该目录不在仓库内，不影响 Git，也不包含真实用户音频或外部凭证。

#### 15.8.6 当前 Git 恢复点

```text
branch: main
HEAD: d1432f36fb03899c70bce22fd5284e42632b1412 (d1432f3)
origin/main: behind 0 / ahead 1
working tree: dirty
commit/push/merge/rebase/reset/clean/stash in this session: none
```

工作树包含本轮 Waffo/billing/mvp-server 的 tracked 修改和新增源码/测试；`.data/`、`.pnpm-store/`、`.waffo/` 继续保留，其中 `.waffo/integration-manifest.json` 是必须保留的集成状态。未经用户明确授权，不要执行 commit/push/merge，也不要为获得“干净状态”删除这些目录。

#### 15.8.7 当前结论与下一阶段入口

**本地 MVP 代码实现和本地交付质量链已经收口完成。** 当前没有已知本地代码 BLOCKER/MAJOR。剩余事项不是继续补本地 MVP 业务代码，而是 Waffo 外部验收：

1. owner/Waffo 合同明确 `userTerminal`、subscription mode/retry、Go-Live Q1–Q8、payment method/device wallet 和 compliance；
2. 提供 Sandbox MID/API key/private key/Waffo public key 及 HTTPS notify/success/failed/cancel redirect；
3. 通过**项目 HTTP 端点**进入 Integration Verification，先执行 `payMethodConfig().inquiry()`；
4. 完成 Phase A、B1、B2、C1、C2、D 的 Sandbox order/refund/subscription/Webhook/payment-method 证据；
5. 更新 manifest，并在报告前运行 `waffo-verify.js . --gate report`；只有 gate 通过且 outcome 为 `FULL`/`CONDITIONAL` 时才允许生成正式报告。

如用户下一步要求“提交/推送/PR”，应先复核当前 diff/status，再按 Git 授权边界单独执行；本 checkpoint 本身不授权任何远端写操作。

### 15.9 2026-09-04 16:27 续接会话复核 checkpoint（历史 checkpoint）

本节只更新续接后的当前验证事实，不改变 15.8 已冻结的业务实现、架构决定或浏览器验收结论。当前恢复入口为第 0 节 + 本节；需要了解本地实现收口细节时再回看 15.8。

#### 15.9.1 续接动作与代码状态

- 已读取原 Codex 任务 `完成项目 MVP 剩余工作` 的真实中断状态，并与当前 Git/磁盘事实核对；原任务最后一次失败来自 ChatGPT 浏览器标签关闭，不是代码或测试失败。
- 当前仍为 `main`，HEAD `d1432f36fb03899c70bce22fd5284e42632b1412`，相对 `origin/main` behind 0 / ahead 1；工作树保持 dirty，未执行 commit/push/merge/rebase/reset/clean/stash。
- 本次没有修改业务代码、测试契约、Waffo decision 或 manifest decision 状态；仅更新本 canonical handoff。
- 按 `simplify` 收尾规则复核本次代码范围，没有发现值得为了“简化”继续改动的点，因此没有制造新的代码 diff，也无需因 simplify 重新开启实现循环。

#### 15.9.2 本次重新执行的当前工作树验证

```text
node /Users/bopop/.codex/skills/waffo-integrate/bin/waffo-verify.js . --json
=> errors: []
=> warnings: []
=> actual handlers:
   onPayment
   onRefund
   onSubscriptionStatus
   onSubscriptionPeriodChanged
=> unresolved decisions 继续保持 UNRESOLVED

非 dist src/*.js 长度扫描
=> 无 >300 行文件

git diff --check
=> exit 0

CI=1 node scripts/quality-gate.mjs all --require-feature-tests
=> 全部门禁通过

CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests
=> 全部门禁通过
```

两轮完整门禁中的关键测试继续为：

- prototype 功能定向测试 15/15；Sites Worker 4/4；生产构建通过；
- SDK spike 13/13；
- speech-engine 14/14；
- provider-adapters 38/38；
- core-platform 12/12；
- account-billing 33/33；
- mvp-server 34/34；
- infra 静态检查与契约测试通过，但机器仍无 Compose v2，因此不把它表述为 PostgreSQL/MinIO/Mailpit 容器运行验收。

15.8.5 的 HTTP/真实 Chrome smoke 与当前代码工作树一致，本次续接没有代码修改，所以该浏览器证据继续有效；本次没有为了重复证据而重新启动 API、Vite 或浏览器。

#### 15.9.3 当前唯一剩余入口

本地 MVP 实现、自动化门禁、机械 Waffo SDK validator 和上一轮真实 Chrome 主链路已经完成。当前不应再继续扩展本地 MVP 功能。下一步必须由 owner/Waffo 提供或确认外部事实：

1. `userTerminal`、`subscriptionMode`、`subscriptionRetryConfig`、Go-Live Q1–Q8、payment method/device-wallet、`complianceExemption`；
2. Sandbox MID/API key/private key/Waffo public key；
3. 对外可访问的 HTTPS webhook 与 success/failed/cancel redirect 地址；
4. 目标 payment method 合同状态。

取得这些信息后，按 `waffo-integrate` Step 6 从项目 HTTP 端点开始：先执行 `payMethodConfig().inquiry()`，再完成 Phase A/B1/B2/C1/C2/D，并持续更新 `.waffo/integration-manifest.json`。正式报告前必须通过 `waffo-verify.js . --gate report`；在上述外部事实缺失时，禁止生成正式 payment report 或声称 Sandbox/生产支付验收通过。

### 15.10 2026-09-04 17:02 上线准备与插件初始化 checkpoint（历史 checkpoint）

#### 15.10.1 已落盘的部署脚手架

- `.github/workflows/ci.yml`：PR/main/手动触发，Node 24 + pnpm 11.25.0，逐包 frozen install，常规 + `TZ=UTC` 双轮完整 quality gate；
- `.github/workflows/release.yml`：默认由 `PRODUCTION_DEPLOY_ENABLED` 关闭；启用后仍会重新验证目标 commit，再发布 GHCR API 镜像与 Vercel 前端；
- `prototype/vercel.json`：Vite SPA build/output/SPA rewrite；
- `apps/mvp-server/Dockerfile`：Node 24 bookworm、ffmpeg/ffprobe、固定 pnpm、生产 `/health`、`/var/lib/speechoptimizer` 持久卷契约；
- `.dockerignore`：排除本地数据、`.waffo`、依赖缓存、测试与文档；
- `docs/DEPLOYMENT.md`：记录 Cloudflare + Vercel + 单实例容器 API + Supabase Postgres/S3 的推荐上线拓扑和 P0/P1 gate。

部署脚手架落盘后再次执行：

```text
CI=1 node scripts/quality-gate.mjs all --require-feature-tests
=> 全部门禁通过

CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests
=> 全部门禁通过

Ruby YAML parse: ci.yml / release.yml
=> PASS

prototype/vercel.json JSON parse
=> PASS

git diff --check
=> PASS
```

Docker CLI 已安装，但 `docker build` 当前连接 `/Users/bopop/.colima/default/docker.sock` 失败，因为 Colima daemon 未运行；本轮没有擅自启动虚拟化服务，因此 Dockerfile 目前只有静态/依赖边界证据，没有真实 image build/healthcheck 证据。

#### 15.10.2 插件实际连接状态

- **Cloudflare**：API 可读，账号下有 3 个 active Zone：`bopop.cc.cd`、`bo-pop.top`、`bp1016.icu`；Zone 返回权限当前只看到 DNS/WAF/R2 read，没有 edit。没有替 owner 选择正式域名，也没有写 DNS/WAF/R2；后续写入前需先补齐 Cloudflare edit scope。
- **Supabase**：连接正常，当前只有 `bopopGoSea`（project ref `fsqczucxnrmkzbmsbcqr`，region `us-west-1`）。它不是 SpeechOptimizer，因此没有复用。新建项目必须先按 Supabase 插件规则确认目标 organization 与创建成本。
- **Vercel**：插件连接存在，但 `list_teams` 返回空；本地也没有 `.vercel/project.json`。一次 `deploy_to_vercel` 返回 `INVALID_ARGUMENT`。继续搜索后未发现“创建/链接 Project”工具，因此需要先建立 Project 上下文后才能继续用插件部署。
- **GitHub**：远端仓库是 `https://github.com/abo1016/SpeechOptimizer.git`；插件可读取/操作代码与 workflow 运行，但当前工具面没有 Repository Secrets / Variables / Ruleset 配置动作，本轮也没有 Git push 授权。
- **Railway**：当前工具注册表没有 Railway 项目/服务/卷/环境变量连接器。

#### 15.10.3 下一执行入口

1. owner 确认是否在 Supabase organization `rwzohujdebahkmqfxloy` 下新建独立 `SpeechOptimizer` project；确认后必须先调用成本查询并把结果展示给 owner，再得到成本确认后创建。
2. owner 从现有 Cloudflare Zone 选择正式域名，或提供新域名；确定后先确认 Cloudflare DNS edit scope，再创建 `app.<domain>` / `api.<domain>`，并同步生产 `ALLOWED_ORIGINS`、OAuth redirect、Waffo redirect/webhook。
3. 在 Vercel 建立/链接 Root Directory=`prototype` 的 Project；之后再通过插件执行 Preview/Production deployment 和日志检查。
4. Railway 无插件时可走 Dashboard/CLI；API 第一阶段必须单实例 + `/var/lib/speechoptimizer` 持久卷。完成 Postgres/S3 adapter 前禁止多 replica。
5. 远程资源就绪后执行真实 OpenAI、邮件、Google OAuth 和 staging E2E；最后才进入 production smoke 与 Waffo Sandbox/Go-Live。

本 checkpoint 不授权 commit/push，也不授权创建带费用的 Supabase 项目或替 owner 选择正式域名。

### 15.11 2026-09-04 17:28 部署续接、Railway 诊断与 Docker runtime checkpoint（历史 checkpoint）

本节承接 15.10 的上线准备。恢复时优先读取第 0 节 + 本节；Supabase 创建事实沿用 15.10 后续会话已落盘状态，业务代码验证基线仍参考 15.9/15.10。

#### 15.11.1 Railway 当前真实状态

- Railway connector 现在已经在当前 Codex 工具注册表中暴露，包含 project/service/deployment/variables/domain/status 等动作；15.10 的“Railway 无 connector”结论已 superseded。
- `list_projects` 当前只返回旧项目 `deranged-love`（project id `bfb6c4dc-6e12-4841-978b-c421084caac7`），没有 SpeechOptimizer。
- `whoami` 返回当前用户已 `REGISTERED`，用户名 `abo1016`；旧项目 `get_status` 可读取 production environment 和既有 `ChatGPT Web` service，证明账号读取链正常。
- 创建独立 Railway project 时，以下三种输入均返回 `INVALID_ARGUMENT`，且 `list_projects` 未出现新项目：
  1. `name + description + isPublic + workspaceId`；
  2. `name + workspaceId`；
  3. 仅 `name`。
- 因为最小参数仍失败，本轮没有机械重复更多创建请求，也没有修改/复用旧 `deranged-love`。当前第一根因归类为 Railway connector 的 project-create/账户能力边界，需通过 Railway Dashboard、连接器权限或平台侧错误详情继续定位。
- Railway `create_deployment` 要求明确 GitHub repo。仓库是 `abo1016/SpeechOptimizer`，但当前远端 `origin/main` 不是本地已验证部署状态，因此即使 project-create 恢复，也不应立刻从旧 remote source 首发。

#### 15.11.2 Vercel 与 Cloudflare 当前真实状态

Vercel：

- `list_teams` 仍返回空数组；
- 当前工具面有 list/get/deploy/log 等动作，但未暴露 create/link Project 动作；
- 15.10 已记录一次 `deploy_to_vercel => INVALID_ARGUMENT`，本轮外部状态没有变化，因此没有重复同一失败调用；
- 远端 source 也缺少当前本地 `prototype/vercel.json`，所以建立 Project 前同样必须先解决 source gate。

Cloudflare：

- 使用更窄的 Zone/DNS API 调用已成功读取 `bo-pop.top`，Zone 为 `active`；15.10 的“DNS 读取被安全策略拦截”已 superseded；
- 当前记录包括 `fnos.bo-pop.top`、`www.bo-pop.top`、两个 C2C tunnel 子域等，但没有 `app.bo-pop.top` 或 `api.bo-pop.top`，临时部署域名目前无命名冲突；
- Zone 权限明确包含 `#dns_records:read`，不包含 DNS edit，因此当前不能创建 `app`/`api` 记录；
- 在 Railway/Vercel 最终 target domain 尚未取得前，也不应先写占位 CNAME/A 记录。

#### 15.11.3 GitHub source gate

当前：

```text
branch: main
HEAD: d1432f36fb03899c70bce22fd5284e42632b1412
origin/main...HEAD: behind 0 / ahead 1
working tree: dirty
```

对 `origin/main` 执行路径检查后，远端当前均不存在：

```text
apps/mvp-server/Dockerfile
prototype/vercel.json
docs/DEPLOYMENT.md
.github/workflows/ci.yml
.github/workflows/release.yml
```

本地上述文件全部存在。因此新增部署硬门禁：**GitHub 驱动的 Railway/Vercel 首次部署必须引用包含这些已验证部署脚手架的 commit。** 本会话没有 commit/push 授权，所以没有为了部署擅自提交或推送，也没有发布旧 `origin/main`。

#### 15.11.4 Dockerfile 首次真实 build / runtime 证据

本轮启动了原本停止的 Colima，仅用于验证当前 Dockerfile；验证结束后已停止本轮启动的 Colima。

执行：

```text
docker build -f apps/mvp-server/Dockerfile -t speechoptimizer-mvp-server:local .
=> Successfully built 087f166498ab
=> Successfully tagged speechoptimizer-mvp-server:local
```

首次构建实际拉取 `node:24-bookworm-slim`，安装 `ca-certificates` + `ffmpeg`，再安装固定 `pnpm@11.25.0` 和生产依赖 `@waffo/waffo-node 3.0.1`，所有 Dockerfile 步骤完成。

容器 smoke 使用显式 `NODE_ENV=development`，不注入生产密钥，不把 mock 结果当作真实 Provider evidence：

```text
server.started => host 0.0.0.0 / port 8787 / providerMode mock
GET http://127.0.0.1:18787/health
=> {"data":{"status":"ok","mode":"mock"}}

ffprobe -version
=> ffprobe version 5.1.9-0+deb12u1

docker inspect .State.Health
=> Status: healthy
=> FailingStreak: 0
```

一次带宿主机 bind mount 的 smoke 命令先被安全层拦截；改用 Dockerfile 自带的匿名 volume 后运行成功。这个失败不代表应用或 Dockerfile 失败。

smoke container 已停止并因 `--rm` 清理；Colima 随后停止。没有残留本轮 API 容器监听。

#### 15.11.5 下一最短路径

1. 解决 Railway `create_project => INVALID_ARGUMENT`，但不要修改旧 `deranged-love`；
2. 获得 Git commit/push 授权后，将当前已验证 source 形成清晰 checkpoint commit 并 push 到用于部署的远端分支；
3. 创建 SpeechOptimizer Railway project/service，配置 `apps/mvp-server/Dockerfile`、`/health`、单实例、`/var/lib/speechoptimizer` 持久卷；
4. 在生产密钥尚未准备完整时，优先建立 staging，不用假值绕过 production fail-closed；
5. 建立/链接 Vercel `prototype` Project，并设置公开 `VITE_API_BASE_URL`；
6. Cloudflare token 补 DNS edit 后，再按 Railway/Vercel 实际 target 创建 `api.bo-pop.top` / `app.bo-pop.top`；
7. 完成真实 OpenAI、Magic Link mail、Google OAuth staging E2E；
8. 实现 Supabase Postgres/S3 adapter 后再取消单实例/本地卷限制；
9. Waffo 继续按既有外部 decision + Sandbox/Go-Live Phase A-D 独立验收。

本 checkpoint 不授权 commit/push，也不授权修改旧 Railway project、写 Cloudflare DNS、填写真实密钥或绕过 Waffo/production fail-closed。

### 15.12 2026-09-04 18:43 Railway project/service/volume checkpoint（历史 checkpoint）

本节承接 15.11。恢复时优先读取第 0 节 + 本节；15.11 中关于 `create_project INVALID_ARGUMENT` 的结论保留为历史失败证据，但已被本节当前云端事实 supersede。

#### 15.12.1 Project 创建阻塞已解除

- `list_workspaces` 返回 workspace `DBOB's Projects`，id `7602e971-3e03-4eef-bf3f-c1e2075051b1`。
- `list_projects` 当前已经返回独立 `SpeechOptimizer` project，id `1edca099-a3b8-4b8c-a560-dd59527f0918`，创建时间为 `2026-09-04T09:50:06.208Z`；旧 `deranged-love` 仍保持未修改。
- `SpeechOptimizer` 当前 `production` environment id 为 `149778e4-b9ac-4578-b261-b527d8573375`。
- 已存在 `speechoptimizer-api` service，id `9ad7f1ac-b19a-4112-9602-598535e46f90`。
- 因为当前 project/service 已真实存在，后续禁止再重复调用 `create_project` 或为了部署创建第二个同用途 service。

#### 15.12.2 Service 当前配置与无 deployment 证据

Railway connector `get_service_config` 当前返回：

```text
builder: DOCKERFILE
dockerfilePath: /apps/mvp-server/Dockerfile
healthcheckPath: /health
sleepApplication: true
runtime: V2
region: europe-west4-drams3a
numReplicas: 1
generated domain: speechoptimizer-api-production.up.railway.app
```

当前 service 还没有 source 和首次 deployment：

```text
railway status --json
=> source: null
=> latestDeployment: null

railway list deployments / connector list_deployments
=> []
```

外网探测：

```text
GET https://speechoptimizer-api-production.up.railway.app/health
=> HTTP 404
=> x-railway-fallback: true
=> {"status":"error","code":404,"message":"Application not found",...}
```

这个 404 是 Railway edge 对“当前没有 deployment”的平台 fallback，不是当前应用 `/health` 业务代码返回的 404。

#### 15.12.3 Railway CLI 已登录并链接现有目标

本机已安装 `railway 5.49.1`。恢复初始时 CLI 未登录；本轮启动官方 OAuth browser flow，并成功登录为当前 Railway 账号，随后把工作目录链接到现有资源：

```text
project: SpeechOptimizer
projectId: 1edca099-a3b8-4b8c-a560-dd59527f0918
environment: production
environmentId: 149778e4-b9ac-4578-b261-b527d8573375
service: speechoptimizer-api
serviceId: 9ad7f1ac-b19a-4112-9602-598535e46f90
```

本次 link 没有在仓库中新增可见 `.railway*` 项；不要把本机 OAuth 凭证写入 handoff、Git 或日志。

#### 15.12.4 持久卷已创建并验证

按照当前本地 JSON snapshot + 音频目录架构的单实例要求，本轮通过已登录 CLI 创建持久卷：

```text
railway volume add --mount-path /var/lib/speechoptimizer --json
=> volume id: 3f052128-b555-40d2-bff0-2e9dce6ea103
=> name: speechoptimizer-api-volume
```

随后 `railway volume list --json` 与 `railway status --json` 均确认：

```text
mountPath: /var/lib/speechoptimizer
sizeMB: 500
currentSizeMB: 0
status/state: Ready / READY
service: speechoptimizer-api
environment: production
```

在 Supabase Postgres/S3 adapter 完成前继续保持单 replica，不得移除该卷或扩多实例。

#### 15.12.5 当前 source gate 与为什么没有触发首次部署

本轮重新执行 `git fetch origin main` 后：

```text
git rev-list --left-right --count origin/main...HEAD
=> 0  1
```

同时 `git ls-tree -r --name-only origin/main` 仍找不到这些当前本地部署入口：

```text
apps/mvp-server/Dockerfile
prototype/vercel.json
docs/DEPLOYMENT.md
.github/workflows/ci.yml
.github/workflows/release.yml
```

因此虽然 CLI 现在已经支持：

```text
railway service source connect --repo owner/repo --branch branch
railway up
```

本轮仍**没有**执行 source connect 或 `railway up`：

- 连接当前旧 `origin/main` 会让 Railway 首次 source 指向缺部署脚手架的历史状态；
- 直接从当前 dirty 工作树 `railway up` 到 `production` 会产生不可审计、不可由明确 Git checkpoint 恢复的 production source；
- 当前生产 Provider/Waffo/SMTP/OAuth secrets 与人工 decision 也尚不完整，不能通过假值绕过 `NODE_ENV=production` fail-closed。

下一步必须先取得 commit/push 授权，把当前已验证 source 形成明确 Git checkpoint 并 push 到部署 branch，再将**现有** `speechoptimizer-api` 连接到该 branch。

#### 15.12.6 连接器失败尝试与当前工具选择

- 一次 Railway `railway_agent` 只读诊断请求返回 `INVALID_ARGUMENT`；因为具体 connector 工具和 CLI 都可以获得更精确证据，本轮没有重复该 agent 请求。
- Railway connector 当前可以读写 project/service/config/variables/deployment/domain，但没有暴露现有 service 的 source-connect 与 volume create 专用动作；这两项改走已安装官方 CLI。
- CLI OAuth/login/link/volume 路径已成功，因此 Railway 当前问题不再归类为“账号未连接”或“Project 创建失败”。

#### 15.12.7 下一最短路径

1. 获取当前工作树的 commit/push 授权，并在提交前按 Change Delivery Gate 重新确认受影响验证与最终 diff；
2. 将包含 Dockerfile、CI/Release、部署文档与当前 MVP/Waffo 改动的明确 checkpoint push 到部署 branch；
3. `railway service source connect --repo abo1016/SpeechOptimizer --branch <已验证分支>`，目标必须是当前 `speechoptimizer-api`；
4. 配置真实 staging/production Railway variables/secrets，不记录秘密值到 handoff；Waffo 未决 decision 继续 fail closed；
5. 触发首次 deployment，检查 build logs、runtime logs、`/health`、volume mount 和 restart 后持久化；
6. 根据真实流量/成本要求再决定是否关闭 `sleepApplication`、是否把 region 调整到更靠近 Supabase `us-west-1` 的区域；这些不是本轮擅自修改的默认项；
7. Railway health 稳定后再配置 `api.bo-pop.top`，随后继续 Vercel、Cloudflare、真实 Provider E2E 与 Supabase adapter。

本 checkpoint 未执行 commit/push/source-connect/deployment，也未写入任何生产 secret、Cloudflare DNS 或 Waffo 人工 decision。

### 15.13 2026-09-04 19:12 CI/CD workflow 补齐与双轮验收 checkpoint（历史 checkpoint）

#### 15.13.1 磁盘事实纠偏与实现

恢复时发现 `.github/workflows/` 实际只有 `ci.yml`，与 15.10/15.12 所称 `release.yml` 已落盘不一致。本轮以磁盘为准创建 `release.yml`，并对 `ci.yml` 做最小安全收紧：

- CI 保持 PR、main push、手动触发，Node 24 + pnpm 11.25.0、逐包 frozen install、常规与 UTC 双轮完整门禁；
- 所有 checkout 设置 `persist-credentials: false`；
- Release 默认由 `PRODUCTION_DEPLOY_ENABLED` 关闭；
- 自动发布只接受 `CI` 的 successful main push，人工发布只接受 main；
- 发布 commit 固定为 CI `head_sha`，Release 自身再次跑双轮完整门禁；
- GHCR job 独占 `packages: write`，发布 SHA 与 latest 两个标签；
- Vercel job 校验三项 secret，使用固定 CLI `59.11.2`，执行 `pull -> build --prod -> deploy --prebuilt --prod`；
- 单一 production concurrency group 禁止发布并行交叉覆盖。

#### 15.13.2 主控/子代理结果

owner 要求由主控监督并派发 Luna。已使用 `gpt-5.6-luna` / `max` 派发任务 `agt_5325c707`，但它长期只返回 `running` 且未产生任何文件。随后同一协调环境中 `devspace` 命令不可用；`ps` 未发现遗留 devspace/agent 进程。主控据此接管实现，避免无限等待。该任务必须记录为 **not landed / failed coordination channel**，不能算作子代理交付。

#### 15.13.3 当前验证证据

```text
ruby YAML parse ci.yml + release.yml
=> PASS

Release trigger/SHA/permissions/Vercel chain 静态断言
=> PASS

CI=1 node scripts/quality-gate.mjs all --require-feature-tests
=> exit 0；全部门禁通过；MVP HTTP 34/34

CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests
=> exit 0；全部门禁通过；MVP HTTP 34/34

git diff --check
=> PASS
```

两轮 infra 均明确记录本机未检测到 Compose v2，因此跳过 `docker compose config`；这不是 Docker/Compose 运行验收。GitHub Actions 真实 Runner 尚未运行，不能用本地 YAML parse 替代远端 workflow 证据。

#### 15.13.4 远端状态与下一步

- GitHub：远端 0 workflow、0 Repository Secret、0 Repository Variable、0 ruleset，main 未保护；
- Railway：现有 `speechoptimizer-api` 仍为 `latestDeployment: null`；
- Vercel：`list_teams` 仍为空，无法定位/创建目标 Project；
- Cloudflare：在 Railway/Vercel target 出现前不写无目标 DNS。

下一最短路径仍是先取得明确 commit/push 授权，为当前已验证工作树建立 Git checkpoint 并推到部署 branch。首次 CI 跑绿后再设置 required check；Vercel Project 与真实 secrets 就绪前保持 `PRODUCTION_DEPLOY_ENABLED` 不存在。之后连接现有 Railway Service、配置真实变量并执行首次 deployment。禁止用占位 secret、未确认 Waffo decision 或旧 `origin/main` 绕过 gate。

本轮另观察到 tracked 根 `AGENTS.md` 在任务外被删除；开始状态中没有该删除，本轮未执行删除或恢复。后续 commit 前必须由 owner 确认该删除是否有意，不能把它静默混入 CI/CD checkpoint。

### 15.14 2026-09-04 19:26 Git checkpoint、PR 与首轮 GitHub CI checkpoint（历史 checkpoint）

owner 明确授权下一步后，主控执行了以下可审计操作：

```text
branch: codex/cicd-bootstrap
commit: a836b7287622dafda2238772c45a8312c686e2fa
message: feat(mvp): 完成可部署源码检查点
push: origin/codex/cicd-bootstrap
PR: https://github.com/abo1016/SpeechOptimizer/pull/1
```

提交前 staged-only 审查确认：46 个源码/测试/部署/文档文件进入 checkpoint；`.data/`、`.pnpm-store/` 已加入 ignore；常见真实凭证格式扫描未命中；`.env.example` 只含 replace/example 占位值；任务外 `AGENTS.md` 删除是唯一未暂存差异，未进入 commit。

PR 创建后触发了真实 GitHub Actions：

```text
run: 33867873645
job: 101006745249
check: MVP quality gate
result: SUCCESS
duration: 53s
```

这份证据覆盖 GitHub Ubuntu Runner 上的 checkout、Node 24、pnpm 11.25.0、逐包 frozen install、常规/UTC 双轮 quality gate 与 diff check。它不覆盖生产 Release，因为 `PRODUCTION_DEPLOY_ENABLED` 与 Vercel secrets 均未配置；也不覆盖 GHCR push、Railway/Vercel deployment 或 Cloudflare DNS。

当前 PR 尚未合并，main 无 ruleset/branch protection。下一步应先由 owner 授权 main 保护规则与合并策略；配置 required `MVP quality gate` 后再合并，并验证 main CI。生产目标和真实 secrets 就绪前继续保持 Release disabled。

### 15.15 2026-09-04 19:36 Actions Node 24 runtime 纠偏 checkpoint（历史 checkpoint）

PR 首轮 run `33867873645` 虽然成功，但产生 annotation：checkout/setup-node/pnpm action 仍基于 Node 20，被 Runner 强制到 Node 24。主控读取官方仓库 release 与各 action.yml 后确认当前 Node 24 runtime 主版本：

- `actions/checkout@v7`；
- `pnpm/setup@v2`（`pnpm/action-setup` 的官方 successor）；
- `docker/setup-buildx-action@v4`；
- `docker/login-action@v4`；
- `docker/build-push-action@v7`。

第一次尝试把旧 `pnpm/action-setup` 升到 v6，run `33868265419` 在 Setup pnpm 阶段超过两分钟无进展。官方 v6 release 明确指向 successor，因此主控取消该 run，删除独立 setup-node 步骤，改用 `pnpm/setup@v2` 一次安装 `pnpm 11.25.0` 与 `node@24`，并设置 `install: false`，继续由下一步逐包 frozen install。

最终证据：

```text
workflow commit: 5cbca77bcb08f7807d9145da7a9b37a8c2fef798
run: 33868583632
job: 101008967159
result: SUCCESS
duration: 1m8s
annotations: []
```

所有 setup、逐包依赖安装、常规门禁、UTC 门禁和 diff check 均通过。Release workflow 没有被执行，因为 production variable 仍不存在；Docker action 的实际 push 与 Vercel CLI 部署仍需未来受控 Release 验证。

### 15.16 2026-09-04 Sites + Railway Demo/Mock 部署与 PR #2 源码同步 checkpoint（当前最新）

本节 supersede 前文所有关于“PR #1 尚未合并、Railway 尚未部署、Sites/域名未上线、`active_redeploying`、公网 404、`3a912b7` 尚未合入 `main` 或等待 owner 决定同步路径”的当前状态描述。前文保留为按时间记录的历史证据；恢复任务时优先读取第 0 节、本节和 `docs/DEPLOYMENT.md` 的当前状态章节。

#### 15.16.1 线上部署事实

- Sites 主站已部署成功并启用 owner-only 访问：<https://speechoptimizer.dengbodev.chatgpt.site/>。浏览器验收需要使用当前 ChatGPT 账号登录。
- Sites 项目为 `appgprj_6a9ab0d858c08191b9891e7aa6ce315c`，版本为 `appgver_7bd145986cc08191925ac77783dd005e`，部署为 `appgdep_6a9ab1ed04648191b0f00ed8a7387ab6`，源码快照为 `deb46218db3f59d4e52f0e54d94725b1d019e792`。
- Sites 同源转发已将 `/api/*` 与 `/health` 代理到 Railway API；前端、API、同源代理和 Railway 持久卷均已上线。
- Railway 服务为 `speechoptimizer-api`，区域为美国西部；数据目录为 `/var/lib/speechoptimizer`，当前使用单实例 500 MB 持久卷。
- Railway API 当前为 `mock` 模式，健康检查 <https://speechoptimizer-api-production.up.railway.app/health> 返回 HTTP 200，响应中的 `status` 为 `ok`、`mode` 为 `mock`。模型、支付、邮件等外部依赖尚未接入，不得将 Mock 结果表述为真实 Provider 生产证据。
- 自定义域名 <https://app.bo-pop.top/> 的 Sites 域名对象为 `appgdom_6a9ab280354881918e2625eba7f9afd2`；当前 `status=active`、`provider_status=active`、`ssl_status=active`，`last_error=null`。公网匿名访问返回 HTTP 401 登录门槛，不再是平台 404；无需继续修改 DNS。
- 浏览器端报告已生成：<https://speechoptimizer.dengbodev.chatgpt.site/analysis/5c78b3c8-39b1-4a7c-a317-b28cb74a7b5f/report>。既有真实 Chrome 验收覆盖打开主站、上传合成 WAV、发起分析、跳转报告和展示语速/填充词/长停顿/有效语音指标。

#### 15.16.2 源码、PR 与分支边界

- PR #1 已于 2026-09-04 合并，合并提交为 `1c38e65a6c88212225fea4c70587b33a3f9ffb78`。
- 线上部署需要的 4 个文件变更由提交 `3a912b799ae1e01f5cae6fd5c6d0d87a39c9f82a`（短 SHA `3a912b7`，消息 `fix(deploy): 完善 Railway 与 Sites 部署配置`）承载，交接文档回写由 `deeeca308d9fb4fe6bfa52048dc7c78e1ef5b105`（短 SHA `deeeca3`）承载，均已推送到 `origin/codex/cicd-bootstrap`；PR #2 是同步到 `main` 的既定路径，合并后 `main` 将包含部署与文档提交。这 4 个文件是：
  - `apps/mvp-server/Dockerfile`
  - `prototype/.openai/hosting.json`
  - `prototype/worker/index.js`
  - `prototype/tests/sites-worker.test.mjs`
- `API_ORIGIN`、生产 CORS/允许来源、Sites 同源代理目标以及 Railway volume 挂载属于平台侧配置；源码和 Git diff 只能说明支持这些配置，不能单独证明平台配置已经生效。当前线上状态以平台健康检查、Sites 部署状态、域名状态和浏览器报告为证。
- 根目录 `AGENTS.md` 的删除属于用户已有的任务外工作区改动，仍不得暂存、提交或恢复。

#### 15.16.3 验收与后续边界

历史部署验收已通过主质量门禁 `165/165`、UTC 时区质量门禁 `165/165`、约 163 项项目测试、Sites Worker `6/6`、前端生产构建、`git diff --check`、Railway API 全链路（匿名会话、分析任务、WAV 上传、报告获取、删除测试数据）以及真实 Chrome 主链路。本次 PR #2 重新通过常规与 UTC 完整质量门禁、前端生产构建、`git diff --check`，并将 Sites Worker 覆盖提升至 `8/8`。当前仍为 Demo/Mock 部署；PR #2 合并后，`main` 将包含 `3a912b7` 部署变更与 `deeeca3` 文档回写。下一阶段另行准备 OpenAI、支付、邮件、Google OAuth、生产数据库/对象存储、备份和可观测性。

现有 `.github/workflows/release.yml` 仍包含 Vercel production release 流程；它是遗留/备用路径，不代表当前 Sites 主站的发布路径。未经 owner 明确决策，不修改、启用或替换该 Vercel 流程。
