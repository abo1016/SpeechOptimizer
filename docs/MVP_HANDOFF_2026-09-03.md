# SpeechOptimizer MVP 当前开发交接

> 交接日期：2026-09-03（Asia/Shanghai）
> 工作区：`/Users/bopop/Documents/SpeechOptimizer`
> Git 分支：`main`
> 远端同步：已执行 `git pull --ff-only`，结果为 `Already up to date.`
> 最近核验：2026-09-04（Asia/Shanghai）；本次仅做状态复核、诊断与 handoff 更新，没有继续修改业务代码。
> 当前状态：本地 MVP 主链路曾完成双轮门禁与 Chrome smoke；2026-09-03 21:xx 开始按 owner 确认方案接入 Waffo 官方 Node SDK，当前停在**支付领域重构中间态**，账户计费测试为红灯。**不能标记为完成、不能提交、不能合并或推送**。

## 0. Canonical Handoff State

本节是长任务恢复入口，只维护“现在是什么状态”和已有详细章节的索引；事实细节仍以链接章节为准，不在这里复制第二套历史。每次阶段完成、验证状态变化、出现 blocker/architecture decision/failed attempt，或会话准备结束时，都必须同步更新本节和对应详细章节。仓库级恢复规则见根目录 `AGENTS.md`。

| Field | Current State |
| --- | --- |
| **Goal** | 完成 SpeechOptimizer MVP，并在不降低现有本地主链路质量的前提下完成 Waffo 官方 Node SDK 集成；先恢复当前支付重构到本地全绿，再在剩余人工决策与 Sandbox 凭证齐备后做真实集成验收。详见第 1、7、10 节。 |
| **Current Phase** | Waffo `@waffo/waffo-node 3.0.1` 接线 / 账户计费领域重构恢复阶段。当前不是 Sandbox 验收阶段。详见第 12 节。 |
| **Current Objective** | 先修复 `services/account-billing` 红灯：补 `refunds` store/persistence、拆分 361 行 `billing-service.js`、补 Mock subscription/refund 契约；随后替换旧 Waffo gateway/Webhook 为官方 SDK 3.0.1。详见 12.3、12.5。 |
| **Completed** | Waffo 重构前的本地 MVP 主链路曾完成 Step 1、常规全量门禁、`TZ=UTC` 独立门禁和 Chrome 主链路 smoke；owner 已确认第 7.2 节核心支付方案；SDK 3.0.1 已核实并安装；`billing-policy.js`、权益生效窗口和部分 Billing 重构已落盘。详见第 4、7.2、11、12.1–12.2 节。 |
| **In Progress** | `billing-service.js` 是已落盘但未完成的中间态；当前读取尚不存在的 `store.refunds`，且计划中的 `billing-webhook-processor.js` **尚未落盘**。Provider gateway、SDK Webhook、正式 client/config、manifest 与新测试仍待完成。`persist()` 还没有从 `MvpApplication` 组合层接到 `store.flush()`。详见 12.2–12.4、14。 |
| **Next** | 先由协调者冻结跨包契约并写 checkpoint，再按第 14 节并行派发 account-billing / provider-adapters / mvp-server；三包定向门禁通过后串行做接口整合，再做 manifest/validator、双轮全量门禁和 smoke。详见 12.5、14。 |
| **Blockers** | 当前代码 blocker：账户计费 `16/26 PASS, 10/26 FAIL`，第一根因是缺少 `store.refunds`，随后还会暴露 Mock subscription、字段契约和组合层持久化问题；上线 blocker：`userTerminal`、subscription mode/retry、Go-Live Q1–Q8、compliance 与 Sandbox/生产凭证仍不完整。详见第 8、12.4、14。 |
| **Architecture Decisions** | Webhook 是支付 Source of Truth；UnknownStatus 使用同一 request ID inquiry；Hosted Checkout + full-page redirect；单币种 USD；月付每周期 60 分钟；年付现金一年一笔但本地 12 个按月 60 分钟窗口；取消到期生效；新周期扣款失败不发新权益；已消费/订阅/已生成 Deep Report 退款转人工；本轮不做 subscription change。详见 7.2、12.2、12.6。 |
| **Failed Attempts** | 当前最小诊断暴露 `#refundFromData` 对 `store.refunds.values()` 的 TypeError；旧测试继续创建 `free_monthly` 支付订单会按新规则得到 `FREE_PRODUCT_NOT_PURCHASABLE`，该测试应更新而非回退业务规则。另已确认受限环境的 `pid_unknown` 不是连接失效，不能据此重复启动/重建连接。历史环境失败另见 6.2。详见 12.4、13。 |
| **Verification** | **当前业务工作树：红灯。** 最近诊断：Billing syntax PASS；`services/account-billing` 16/26 PASS、10/26 FAIL；MVP syntax check PASS；Waffo validator 因 manifest 缺失 FAIL。第 11 节双轮门禁/Chrome 结果只是 Waffo 重构前历史稳定基线，不能代表当前工作树。C2C 环境已于 2026-09-04 独立验证全绿：项目、安全连接和授权入口正常，ChatGPT 已通过 `workspace_info` 识别 `SpeechOptimizer` 并成功读取顶层 `AGENTS.md`；详见第 13 节。 |
| **Git State** | Branch `main`；当前 HEAD `17e4caeb0862`；工作树已有大量 modified/untracked MVP 源码与本地状态，根 `AGENTS.md` 和本 handoff 也是 untracked；当前长任务未 commit/merge/push/rebase/reset。禁止为了“变干净”删除未知 untracked 文件。详见 3.1、12.7。 |
| **Important Files** | `AGENTS.md`；`docs/MVP_HANDOFF_2026-09-03.md`；`services/account-billing/src/{billing-service.js,billing-policy.js,entitlement-service.js,store.js}`；`apps/mvp-server/src/{persistent-store.js,providers.js,routes-billing.js}`；`packages/provider-adapters/src/waffo-gateway.js`；对应 account-billing/provider/MVP HTTP tests。 |
| **Session Summary** | 2026-09-04 已定位并解除 `Codex with ChatGPT · SpeechOptimizer` 的“已连接但不可用”误报：受限命令环境无法探测本地服务，产生 `pid_unknown`，但系统级检查与 ChatGPT 实际读取均已通过；已保存本项目的 ChatGPT 会话绑定，并完成当前项目进度与多 agent 波次规划。本轮只更新交接文档，没有修改 Waffo 业务代码，没有创建 commit，业务红灯状态保持不变。详见第 13–14 节。 |

## 1. 交接结论

当前工作区包含一套完整的本地 SpeechOptimizer MVP 代码。2026-09-03 晚间第一阶段曾达到：**本地代码门禁、独立 UTC 门禁、只读安全审查和匿名上传到报告的真实 Chrome smoke 全部通过**。随后 owner 确认按推荐支付方案继续，已开始把旧 Waffo 注入边界迁移到官方 `@waffo/waffo-node 3.0.1`；该迁移在领域层拆分尚未完成时中断，因此**当前 HEAD 工作树不能再视为上一次绿灯快照**。范围覆盖：

- 匿名会话、Magic Link、Google OAuth 本地替身、Cookie 会话、账户隔离、角色授权和管理员操作；
- 音频录制/上传、服务端 MIME/大小/时长校验、本地对象存储、转写、指标和结构化反馈；
- 异步分析状态机、刷新恢复、失败/取消/重试、历史、报告、比较、单条删除和账户级删除；
- Free/Pro/分钟包/深度报告的权益与流水、Waffo 注入式网关、订单/订阅取消/退款边界、Webhook 验签和幂等；
- React 前端从旧 Demo 页面切换到本地 HTTP API，覆盖工作台、处理页、报告页、比较页、历史、计费、隐私、认证和管理页面；
- 本地 Docker 依赖编排（PostgreSQL、MinIO、Mailpit）及静态契约检查。

这些模块现在都存在于工作区。需要严格区分两个状态：① **Waffo 重构前稳定基线**已完成两轮全量质量门禁和 Chrome Headless 主链路验证；② **当前工作树**已含未完成的 Waffo 领域重构，账户计费测试目前失败，尚未重新进入 Step 1/双轮门禁。因此接手者必须先完成第 12 节的 Waffo 中断项，再从 Step 1 全量重跑。外部 Waffo Sandbox、真实 STT/LLM、真实 Google/邮件服务仍未联调。

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

- 当前分支：`main`。
- 已确认远端：`origin` 指向 `https://github.com/abo1016/SpeechOptimizer.git`。
- 未执行 `commit`、`merge`、`push`、`rebase`、`reset` 或清理操作。
- `prototype/src/App.jsx`、`AppShell.jsx`、`RecorderWorkspace.jsx`、各页面和 `main.jsx` 是已修改的既有文件。
- `apps/`、`packages/`、`services/`、`spikes/`、`infra/`、`scripts/`、部分 `prototype/src/` 与 `prototype/tests/` 是从 stash 恢复的未跟踪源码；它们是本次 MVP 实现，不是应被删除的垃圾文件。
- `.data/`、`apps/mvp-server/.data/` 和 `.pnpm-store/` 是本地运行/测试状态或依赖状态，不应作为代码审查结论，也不要用删除工作区的方式“清理”。
- 在当前快照执行过 `git diff --check`，结果退出码为 0；前端最后改动后仍应在最终门禁前再次执行。

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
- [services/account-billing/src/entitlement-service.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/entitlement-service.js)：原有最早到期预扣/确认/释放仍在；本轮又加入 `startsAt` 生效窗口和 `sourceSummary()`，用于“年付但每月仅 60 分钟、月末清零”和自动退款前判断权益是否已消费。**该改动尚未完成全量回归。**
- [services/account-billing/src/billing-policy.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/billing-policy.js)：本轮新增，统一定义 Free、Pro 月付/年付、分钟包、Deep Report 的 purchase type 与订阅周期；`pro_yearly` 当前设计为 Waffo 12 个月计费周期，同时在本地预建 12 个按月生效/过期的 60 分钟批次。
- [services/account-billing/src/billing-service.js](/Users/bopop/Documents/SpeechOptimizer/services/account-billing/src/billing-service.js)：本轮已重写到中间态，开始持久化 `paymentRequestId` / `subscriptionRequest` / `refundRequestId`，区分一次性订单与订阅，并加入退款“仅完全未消费自动处理”的领域规则。文件当前 **361 行**，超过仓库长度门禁；计划拆出 Webhook processor，但中断前拆分文件未写入。
- [packages/provider-adapters/src/waffo-gateway.js](/Users/bopop/Documents/SpeechOptimizer/packages/provider-adapters/src/waffo-gateway.js)：**仍是旧实现**，继续使用 `checkout.createSession` / `orders.cancelSubscription` 形态，尚未迁移到官方 `@waffo/waffo-node 3.0.1` 的 `order()` / `subscription()` / `refund()` API；这是当前首要待办之一。
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

以下结果来自恢复源码后的定向执行或实施代理报告，不能替代最终门禁：

| 范围 | 证据 | 当前解释 |
| --- | --- | --- |
| 原型测试 | `node --test prototype/tests/*.test.mjs`：18/18 | 在前端最后一轮接线前通过；接线后需重跑 |
| 语音引擎 | check、test 14/14、build | 代理/前置门禁报告通过；需最终轮复核 |
| Provider 适配 | check、test 24/24、build | 代理/前置门禁报告通过；需最终轮复核 |
| 核心平台 | check、build；核心测试曾有 Node 运行时异步断言问题 | loopback 可用环境中代理报告最终 `apps/mvp-server` 相关回归 17/17；需独立复核 |
| 账户计费 | check、test 26/26、build | 代理/前置门禁报告通过；需最终轮复核 |
| MVP HTTP | 核心恢复代理报告 check、test 17/17、build | 报告发生在用户中断前后边界；重试应用层修复后尚无新的主控证据 |
| SDK Spike | check、test 13/13、build | 本地 Mock transport；不代表 Waffo Sandbox |
| Sites Worker | 原型旧模块测试通过 | 前端接线后需重跑 build/test:sites |
| infra/local | 静态检查和契约测试通过 | 未真实启动 Docker 容器 |
| 工作树 | `git diff --check` 退出码 0 | 最终改动后应再次执行 |

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

当前再次执行：

```bash
node /Users/bopop/.codex/skills/waffo-integrate/bin/waffo-verify.js . --json
```

退出码仍为 `1`，因为 `.waffo/integration-manifest.json` **尚未创建**。validator 当前报告 schema/features/decisions 全部缺失。不要把这解释为“owner 仍未确认所有内容”：owner 已确认第 7.2 节范围，但 manifest 尚未来得及把已确认项与第 7.3 节未确认项分开登记。当前也没有生成正式 payment report。

## 8. 当前风险清单

| 等级 | 风险 | 处理/后续 |
| --- | --- | --- |
| 历史已解除 / 当前需重跑 | Waffo 重构前双轮全量质量门禁 | 2026-09-03 晚间曾完成常规与 `TZ=UTC` 两轮全量门禁；**当前支付代码已继续修改，因此该绿灯只作为稳定基线，不代表当前工作树** |
| BLOCKER | 当前 Waffo 领域重构处于红灯中间态 | `services/account-billing` 当前 `16/26` 通过、`10/26` 失败；必须先完成 Store/refund/subscription/webhook 拆分与测试更新，再从 Step 1 重跑 |
| BLOCKER | Waffo 上线人工决策与 Sandbox 环境仍不完整 | feature/核心履约规则已获 owner 确认；`subscriptionMode`、retry contract、userTerminal 人工确认、Go-Live Q1–Q8、compliance、Sandbox/生产凭证仍未完成，因此禁止正式报告/真实收费 |
| 部分解除 | 真实浏览器验收 | Waffo 重构前已完成匿名冷启动、375/768/1440、分析提交和报告主链路；支付 UI/Sandbox checkout 尚未验收 |
| MAJOR | infra compose 只做静态检查，未启动 PostgreSQL/MinIO/Mailpit | 需要本机 Docker 时再执行 `infra/local/scripts/start.sh` 并核对健康状态 |
| MAJOR | STT/LLM/Google/邮件/Waffo 当前都是 Mock 或注入边界 | 生产配置应缺失即拒绝启动；外部 Sandbox 需要凭证和契约后单独验收 |
| MINOR | Webhook claim/队列默认仅单进程 | 多实例部署前换共享数据库唯一键、Redis 原子 claim 或消息队列 |
| MINOR | JSON repository/组合快照不是关系型事务 | 单实例 MVP 已加恢复对账；未来生产需统一事务/Outbox/幂等方案 |
| MINOR | `.data`/`.pnpm-store` 仍是未跟踪本地状态 | 不纳入代码审查，不删除用户数据；最终报告中单独排除 |

## 9. 接续执行顺序

接手后按以下顺序执行，任一步失败都不要跳过：

### Step 1：定向回归

```bash
cd /Users/bopop/Documents/SpeechOptimizer
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
CI=1 node --test prototype/tests/*.test.mjs
pnpm --dir apps/mvp-server run check
pnpm --dir apps/mvp-server run test
pnpm --dir apps/mvp-server run build
git diff --check
```

若 HTTP 测试在受限环境报 `EPERM`，必须申请允许本地 loopback 的运行权限后重试；不能把受限环境失败算作通过。

### Step 2：第一轮完整门禁

```bash
cd /Users/bopop/Documents/SpeechOptimizer
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
CI=1 node scripts/quality-gate.mjs all --require-feature-tests
```

这一步会覆盖 prototype 构建/Sites/功能测试、SDK Spike、语音引擎、Provider、核心平台、账户计费、MVP HTTP 和 infra 静态/契约门禁。

### Step 3：第二轮独立门禁

只有 Step 2 成功后执行：

```bash
cd /Users/bopop/Documents/SpeechOptimizer
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests
```

任意代码修复后，Step 1–3 必须从头重跑。

### Step 4：只读代码审查

门禁双通过后审查：Cookie 签名/CORS/管理员授权、音频路径与删除、取消/重试和权益、恢复/幂等、Webhook 签名/乱序/UnknownStatus、生产配置拒绝启动、日志脱敏、未跟踪文件范围。发现 BLOCKER/MAJOR 时先修复再回到 Step 1。

### Step 5：本地服务与浏览器 smoke

建议分别启动：

```bash
cd /Users/bopop/Documents/SpeechOptimizer/apps/mvp-server
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
node src/index.js
```

另开终端启动：

```bash
cd /Users/bopop/Documents/SpeechOptimizer/prototype
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
CI=1 pnpm run dev -- --host 127.0.0.1
```

先用 `curl http://127.0.0.1:8787/health` 做 smoke，再使用 Playwright/浏览器验证第 5.2 节路径和 375/768/1440px 视口。不要进行真实支付或上传真实私人录音。

### Step 6：继续 Waffo 中断态（当前实际入口）

当前接手时**不要直接跑 Sandbox**。先按第 12 节恢复到本地绿灯，再继续：

1. 完成账户计费领域重构：补 `refunds` 仓储/persistence，补 `createSubscription` gateway 契约，拆出 Webhook processor，把 `billing-service.js` 降回文件长度门禁以内；
2. 用官方 `@waffo/waffo-node 3.0.1` 替换 `packages/provider-adapters/src/waffo-gateway.js` 旧 `checkout.createSession` 实现；每个 write operation 必须处理 `WaffoUnknownStatusError` 并用同一 key inquiry；
3. 正式 Webhook 必须改为 SDK `webhook().onPayment().onRefund().onSubscriptionStatus().onSubscriptionPeriodChanged().handleWebhook()`，使用 `X-SIGNATURE`，返回 SDK `responseBody` 和 `responseSignature`；旧本地 HMAC `x-waffo-signature` 只能继续服务 Mock 测试或被整体替换，不能冒充生产 Waffo 验签；
4. 更新领域/Provider/MVP HTTP 测试，先让账户计费、Provider、MVP 定向测试全绿；
5. 创建 schemaVersion 2 的 `.waffo/integration-manifest.json`：`features=[order, refund, subscription]`，**不要声明 `subscriptionChange`**；把第 7.2 节可确认项登记为 `CONFIRMED_BY_HUMAN`，evidence quote 使用用户原话 `按推荐方案执`；第 7.3 节项目必须保持 `UNRESOLVED`/对应 runtime stub，直到用户明确回答；
6. 运行 `node /Users/bopop/.codex/skills/waffo-integrate/bin/waffo-verify.js .` 清机械错误；
7. 再从本文件 Step 1 → Step 3 完整门禁重跑；
8. 获得 Sandbox 凭证和剩余人工确认后，通过**项目 HTTP 端点**做 Phase A/B/C/D；必须先 `payMethodConfig().inquiry()`，不能直接调用 SDK 自证；
9. 只有 `waffo-verify.js . --gate report` 通过且 outcome 为 `FULL`/`CONDITIONAL` 时，才允许 `--emit report` 生成正式 Waffo 报告。

## 10. 交付边界

当前交接不包含：

- 任何 commit、merge、push、PR 或远程写操作；
- 任何真实 Waffo 收费、退款、订阅变更或生产 Webhook；
- 任何真实用户音频、转写文本或外部 LLM/STT 数据上传；
- 将本地 Docker 静态配置误称为容器已启动；
- 将源码/局部测试/代理报告误称为双轮门禁或浏览器验收通过。

完成判定必须同时满足：最终代码定向测试通过、两轮全量质量门禁通过、只读代码审查无 BLOCKER/MAJOR、本地 HTTP/API smoke 通过、浏览器关键路径通过，以及 Waffo 决策/凭证和其正式 gate 明确完成或由 owner 明确把支付移出本轮范围。

## 11. 2026-09-03 晚间接续结果

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

## 12. 2026-09-03 21:xx Waffo 接线中断快照（本次最新交接点）

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

- 本轮没有 `commit`、`merge`、`push`、`rebase`、`reset`；
- 当前 `git status` 仍包含之前 MVP 大量未跟踪源码和本地 `.data/.pnpm-store`，不要把它们误删；
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
- 本轮没有修改业务代码、没有创建 commit，也没有启动真实 Waffo 请求；只更新了本 handoff，保存了后续可恢复的规划检查点。
- 当前实际工作树仍是 Waffo 重构中间态：`services/account-billing` 最近记录为 `16/26 PASS, 10/26 FAIL`；Billing syntax 与 MVP syntax check 通过；Waffo validator 因缺少 `.waffo/integration-manifest.json` 失败。
- `prototype` 的 tracked diff 主要是 Demo → 真实 API 接线。MVP 主体的 `apps/`、`services/`、`packages/` 等大量文件仍是 untracked，因此普通 `git diff` 不能代表完整 MVP 改动；并行 agent 必须以实际文件和明确 ownership 为准。

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

跨包 contract、shared type、schema、根配置、依赖和 lockfile 不允许由多个 agent 并行修改。实际 `spawn_agent` 时，按根 `AGENTS.md` 的硬约束统一使用 `gpt-5.6-terra` + `max`；tri-agent 的角色名称只用于说明任务性质，不覆盖仓库模型约束。

### 14.3 Wave 1：三个边界清晰的并行 agent

三个 agent 共享当前工作树，但严格按目录 ownership 工作。由于 MVP 核心文件大量 untracked，当前不建议直接新建普通 Git worktree；如果使用 worktree，必须先确保所有需要的 untracked 文件以可恢复方式进入该 worktree，禁止用删除文件换取“干净”。

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
