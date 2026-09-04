# SpeechOptimizer MVP 详细交接文档

> 交接日期：2026-09-02（Asia/Shanghai）
> 工作区：`/Users/bopop/Documents/SpeechOptimizer`
> Git 基线：`main` @ `17e4cae`（`feat: 初始化语音优化产品原型`）
> 当前阶段：MVP 实现收尾，处于自动化双重质量门禁之前
> 结论：**不得声明完成、不得合并、不得提交或推送。**

## 1. 目标与硬约束

### 1.1 目标

完成 SpeechOptimizer MVP 的真实本地全栈闭环，并以可重复证据证明以下能力可用：

1. 匿名与账户身份、认证、授权和管理员权限。
2. 音频录制/上传、服务端格式与时长校验、本地对象存储。
3. 转写、指标计算、结构化反馈、异步分析状态机和故障恢复。
4. 历史、报告、前后比较、取消、重试、删除和账户级数据删除。
5. Waffo 订单、Webhook、分钟权益、订阅、退款边界和管理审计。
6. 前端到本地 HTTP 服务的真实闭环，以及用户最后进行的浏览器使用验收。

### 1.2 用户要求的执行规则

- 主控代理只做监督：运行门禁、收集证据、把缺陷退回实施进程、回测和代码审查；不直接编写业务代码。
- 任务按边界交给独立实施代理；不要让两个实施代理同时修改同一文件或同一共享契约。
- 用户要求实施代理使用 `sol / medium`。当前运行环境没有暴露 Sol，历史实施只能使用平台可用的 `gpt-5.6-luna / medium`；这一点已明确记录，不能虚报为 Sol。
- 所有功能必须先通过**两次独立的全量质量门禁**，然后才可以代码审查、提交或合并。
- 用户只做最终浏览器使用验收；不得把自动化测试、构建或 API 验收工作转嫁给用户。
- 未经用户明确授权，不执行 `commit`、`merge`、`push`、`rebase`、`reset` 或清理工作树。

## 2. 当前工作树与运行环境

### 2.1 工作树状态

- 基线分支是 `main`，目前为大量未提交的 MVP 实现。
- 既有改动包含已修改的原型文件，以及新增的 `apps/`、`services/`、`packages/`、`infra/`、`spikes/`、`scripts/` 和前端模块。
- 不要用 `git reset --hard`、`git checkout --` 或删除未跟踪目录来“清理”工作树；这些内容就是待验收的 MVP 实现。
- 最近检查中 `git diff --check` 已通过，没有空白符错误。这不是功能门禁通过的替代品。
- `.data/` 和 `apps/mvp-server/.data/` 是本地运行时状态/测试产物。测试和服务启动会写入它们，不能把它们误认为正式业务源码或提交依据。

### 2.2 Node 与命令路径

默认 shell 中可能找不到 `node`。已验证可用的运行时路径为：

```bash
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
```

所有 Node/pnpm 门禁应在该 PATH 下运行。缺少的是 PATH 暴露而不是项目依赖；不要因为 shell 报 `node: command not found` 就修改锁文件或无依据地安装重复依赖。

## 3. 已实现的能力

下列项目来自当前源码、已通过的定向测试和实施代理报告。它们表示实现已存在，不表示最终验收已经完成。

### 3.1 前端与真实本地闭环

- 首页提供录音或上传入口，前端通过 API 客户端请求本地 MVP 服务。
- 首次没有 `so_anonymous` Cookie 时，前端先初始化匿名会话，再重试 `/api/v1/session`，避免首页被 401 阻塞。
- 已覆盖异步分析状态轮询、处理进度、完成报告、历史、比较、取消、删除、定价、计费、隐私和认证交互。
- 原型生产构建会生成 Sites Worker 所需产物，静态资产和 SPA fallback 有自动测试。

关键位置：

- `prototype/src/state/sessionBootstrap.js`
- `prototype/src/api/`
- `prototype/src/lib/analysisFlow.js`
- `prototype/tests/session-bootstrap.test.mjs`
- `prototype/tests/analysis-flow.test.mjs`

### 3.2 身份、权限与隐私

- 匿名体验由签名 Cookie 表示，并限制一次、最长 60 秒。
- Magic Link、Google OAuth 注入式流程、角色权限、禁用账户阻断和会话撤销均由账户领域层约束。
- 账户删除清理身份、分析、权益、订单、订阅、审计关联数据；单次分析删除同时删除原始音频。
- 原始音频默认不保留；匿名任务完成后删除原始音频，账户用户只有显式选择时才保留。

关键位置：

- `services/account-billing/src/auth-service.js`
- `apps/mvp-server/src/routes-auth.js`
- `services/core-platform/src/core-platform-service.js`
- `apps/mvp-server/src/application.js`

### 3.3 音频、分析与状态机

- 服务端按文件内容识别受支持音频 MIME，而非信任浏览器传入 MIME。
- 核心层校验音频大小、最小时长和最大时长，完成后使用逐词转写、指标和三条可执行反馈。
- 支持 `created -> uploaded -> transcribing -> analyzing -> completed/failed/cancelled` 生命周期。
- 支持失败后在保留原始音频的前提下重试；处理中取消不会被异步返回结果复活。
- 有安全边界防止心理、人格或医疗判断类反馈进入结果。

关键位置：

- `services/core-platform/src/core-platform-service.js`
- `services/core-platform/src/state-machine.js`
- `services/core-platform/src/media-inspector.js`
- `packages/speech-engine/src/`
- `packages/provider-adapters/src/`

### 3.4 异步恢复和双持久化层

- 核心任务事实源是 `services/core-platform` 的 JSON repository。
- `apps/mvp-server` 的 `PersistentStore` 是 HTTP 查询/账户计费的组合快照，不再作为恢复时唯一索引。
- 启动恢复 `recoverPendingAnalyses()` 会从核心 repository 扫描：
  - `uploaded`：重建组合层索引并重新调度 runner。
  - `transcribing` / `analyzing`：转换为 `failed`，写入 `PROCESS_INTERRUPTED` 和 `retryable: true`，释放仍处于 `reserved` 的权益预扣，并留下 `analysis.recovered_as_failed` 审计记录。
- 已新增回归用例：核心 JSON 数据库已上传但组合快照没有该任务时，恢复仍能发现任务、重建索引、调度，并最终完成。

关键位置：

- `apps/mvp-server/src/application.js` 的 `recoverPendingAnalyses()`
- `apps/mvp-server/src/persistent-store.js`
- `apps/mvp-server/test/http-flow.test.js`

### 3.5 计费、Webhook 与管理

- 支持 Free、Pro、分钟包和单次深度报告目录；权益按最早到期批次预扣、确认、释放、过期和审计。
- Waffo 事件要求版本和事件类型显式合法；重复 Webhook 保持幂等。
- 已修复同一订单的不同 Webhook 事件并发交错问题：完整处理临界区通过进程内串行队列保护，旧事件会标记 `ignored_stale`，不能把 `lastEventAt` 回写为更早时间或重复发权益。
- 管理员用户概览可以按 `userId`、订单归属或订阅归属找到 Webhook；事件记录现在保存 `orderId`、`subscriptionId`、`userId`。
- 管理员重试与人工返还分钟写入审计和日志。

关键位置：

- `services/account-billing/src/billing-service.js`
- `services/account-billing/src/admin-service.js`
- `services/account-billing/test/billing-admin.test.js`
- `apps/mvp-server/src/routes-account.js`

### 3.6 外接 SDK / Waffo 衔接

- Webhook 先同步占用事件键，再执行业务 sink；同一事件并发只执行一次。
- 非法 JSON 或 sink 失败会释放事件键，以允许后续重试。
- 支持注入 `claim(eventId)` / `release(eventId)` 实现；默认 `Set` 只保证单进程语义。
- `purchaseMinutes()` 拒绝零、负数或非法币种，不创建本地订单，也不调用 Waffo。
- 缺少 `transport.request` 时返回稳定 `WAFFO_NOT_CONFIGURED`。
- Waffo 退款缺少正式契约字段时明确返回 `WAFFO_REFUND_CONTRACT_UNAVAILABLE`，不会伪造退款成功。
- `UnknownStatusError` 后调用 `inquiryOrder()` 失败时，本地订单更新为 `failed`，记录稳定错误码并继续抛出可重试原始错误；重试复用原 `requestId`。
- 日志测试确认不泄漏 transport 配置中的敏感字段。

关键位置：

- `spikes/sdk-integrations/src/webhook.js`
- `spikes/sdk-integrations/src/payment-service.js`
- `spikes/sdk-integrations/src/waffo-client.js`
- `spikes/sdk-integrations/test/sdk.test.js`

## 4. 已获得的测试证据

### 4.1 已通过的局部检查

| 范围 | 已通过的检查 | 结果 |
|---|---|---|
| `prototype` | 生产构建、Sites Worker | 构建通过；Worker `4/4` |
| `prototype/tests` | 功能定向测试 | `14/14` |
| `spikes/sdk-integrations` | `check`、`test`、`build` | `13/13`，均通过 |
| `packages/speech-engine` | `check`、`test`、`build` | `14/14`，均通过 |
| `packages/provider-adapters` | `check`、`test`、`build` | `24/24`，均通过 |
| `services/core-platform` | `check`、`test`、`build` | `12/12`，均通过 |
| `services/account-billing` | `check`、`test`、`build` | `26/26`，均通过 |
| `apps/mvp-server`（恢复用例修正后） | `check`、`test`、`build` | `13/13`，均通过 |
| `infra/local` | 静态检查、契约测试 | 均通过 |
| 整体差异 | `git diff --check` | 通过 |

### 4.2 已执行但未通过的第一轮全量门禁

曾执行：

```bash
PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH" \
node scripts/quality-gate.mjs all --require-feature-tests
```

当时结果：除 MVP HTTP 服务外均通过；`apps/mvp-server` 为 `12/13`。

失败的不是产品行为，而是新恢复用例调用 `CorePlatformService.createAnalysis()` 时错误使用了 `actor` 字段；公共契约要求 `owner`，因此产生 `owner.type 无效`。该用例现已由实施代理修正为 `owner: actor`，并增加允许 runner 立即把恢复任务从 `uploaded` 推进到 `transcribing` 的稳定断言，最终断言仍是 `completed`。

修复后已经尝试重新运行第一轮全量门禁，但当前监督进程所处的受限沙箱禁止测试绑定 `127.0.0.1`，导致 MVP HTTP 用例统一报 `listen EPERM: operation not permitted 127.0.0.1`；核心 HTTP 进程同时出现 Node 运行时断言。此前同一套测试在可监听的环境中已通过，故这次输出**不能判定为代码回归**，也不能计为门禁通过。

已按环境流程两次请求在受限沙箱外运行相同全量命令；自动权限审核均在截止时间前超时，未产生“批准”或“拒绝”的结论。接手者必须在允许本地 loopback 监听的环境再次运行 Step 2，才可获得新的第一轮有效证据。

## 5. 当前阻塞与未关闭风险

### 5.1 当前硬阻塞：质量门禁尚未满足

在完成如下顺序前，状态必须保持“未完成”：

1. 在当前工作树运行修复后的第一轮全量门禁。
2. 第一轮成功后，以独立环境变量运行第二轮全量门禁。
3. 两轮都成功后进行最终代码审查；审查发现缺陷则回到实施、局部验证、重新跑两轮全量门禁。
4. 审查没有阻断问题后才启动本地服务，请用户进行浏览器使用验收。
5. 用户浏览器验收通过且没有新增缺陷后，才可请求提交/合并授权。

### 5.2 业务残余风险：跨持久化事务窗口

核心任务和组合层账户/权益快照是两个持久化层。当前恢复逻辑能保证“核心任务已上传但组合快照未落盘”时任务不丢失；但在以下顺序中仍存在设计层面的跨库一致性窗口：

```text
核心音频上传成功
  -> 账户权益预扣或匿名试用消费
  -> 组合快照 flush 前进程崩溃
```

当前实现可以恢复核心任务，但是否需要对账户权益预扣/匿名试用消费做强事务补偿，尚未有专门的故障注入测试覆盖。接手者应在代码审查阶段判定：

- 若 MVP 的付费一致性要求此窗口严格原子，需要实施代理补偿/幂等重算设计与回归测试。
- 若产品明确接受本地单实例 MVP 的有限崩溃窗口，应把该限制写入运行说明和上线前风险清单，不能静默忽略。

### 5.3 并发模型边界

- `BillingService` 的 Webhook 队列只保证**单进程内**串行。
- SDK 默认 `Set` claim 也只保证**单进程内**幂等。
- 若未来部署到多进程/多实例，必须替换为共享数据库事务、唯一键约束、Redis 原子 claim 或消息队列；当前代码和测试不能宣称跨实例 exactly-once。

### 5.4 基础设施验证边界

`infra/local` 的静态检查和契约测试已经通过；历史门禁输出显示未检测到 Docker Compose v2 时会跳过 `docker compose config`，其余静态检查仍继续。当前没有把“Docker 容器真实启动成功”当作已经验证的事实。

### 5.5 浏览器验收边界

用户明确保留最终浏览器使用验收。自动化/源码范围已经覆盖桌面与部分移动布局、Cookie 冷启动、上传和异步 API，但这不等同于用户在真实浏览器里确认：

- 麦克风授权、拒绝、撤销和重新录制体验。
- 最终视觉、文案、键盘流程、移动触控和跨页面操作感受。
- 本地服务真实启动后的端到端使用感受。

在双全量门禁和审查完成之前，不应要求用户进行这一步。

## 6. 代理交接状态

### 6.1 已完成的实施任务

| 任务 | 状态 | 交接结论 |
|---|---|---|
| 核心 MVP 实现 | 已完成一轮 | 完成 CORS、演示处理路由、恢复逻辑、管理员观测、冷启动会话、审计和 Webhook 并发修复。 |
| SDK 与业务衔接 | 已完成 | SDK 局部门禁 `13/13` 通过，UnknownStatus 查询失败缺陷已修复。 |
| 核心恢复专项 | 已完成 | 修复测试字段错误，验证核心 repository 扫描、组合索引重建与重新调度，MVP HTTP 局部 `13/13` 通过。 |

### 6.2 失败但不计入项目缺陷的辅助任务

- 一个只读代码审查代理因平台请求协议错误失败：`function_call_output requires call_id ...`。
- 一个重复启动的核心恢复任务也因相同平台协议错误失败。
- 这两个失败没有被视为代码审查通过，也没有发现/写入任何可采纳的项目修改。不要把它们算作项目阻塞缺陷；应重新拉起一个只读审查任务或由监督进程进行审查。

### 6.3 实施代理窗口交接规则

若实施代理接近约 1M token 上下文：

1. 先让该代理输出包含“目标、已改文件、未解决问题、测试命令和结果、风险”的交接摘要。
2. 停止该实施代理，保留其工作树改动。
3. 新代理只接手一个明确范围，并从该摘要和当前文件状态继续。
4. 不要因为上下文切换自动提交、合并或丢弃未提交变更。

## 7. 推荐的接续执行顺序

### Step 1：核实核心恢复修复仍在工作树

```bash
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
cd /Users/bopop/Documents/SpeechOptimizer
pnpm --dir apps/mvp-server run check
pnpm --dir apps/mvp-server run test
pnpm --dir apps/mvp-server run build
git diff --check
```

预期：MVP HTTP 测试 `13/13`，且没有格式错误。若失败，先将完整输出反馈给**核心实施代理**，不要修改业务代码或绕过用例。

### Step 2：第一轮全量质量门禁

```bash
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
cd /Users/bopop/Documents/SpeechOptimizer
node scripts/quality-gate.mjs all --require-feature-tests
```

预期所有范围通过。任何一个 `check`、`test` 或 `build` 失败都使第一轮门禁失败。

### Step 3：第二轮独立全量质量门禁

只在 Step 2 成功后执行：

```bash
export PATH="/Users/bopop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:$PATH"
cd /Users/bopop/Documents/SpeechOptimizer
CI=1 TZ=UTC node scripts/quality-gate.mjs all --require-feature-tests
```

这轮要避免依赖第一轮残留的时区、环境变量或偶然状态。任何代码调整后，两轮都必须从头重跑。

### Step 4：最终代码审查

只读审查必须在双门禁成功后进行，至少检查：

1. Cookie 签名、CORS allowlist、账户/管理员授权、错误响应和日志脱敏。
2. 音频路径、对象删除、取消/重试、匿名数据、账户删除和状态机终态。
3. 任务恢复的双持久化窗口、权益预扣/释放、审计记录和幂等键。
4. Waffo webhook 签名、事件版本、重复/乱序/失败、退款不伪造成功和未知状态恢复。
5. SDK Node/Workers 边界，以及生产配置缺失时是否稳定拒绝启动。
6. 文件范围、根配置、依赖锁文件和未预期的运行时数据文件。

审查输出按严重程度列出问题、文件/行号、触发条件、影响和缺失测试。发现真实问题时，回到对应实施代理，修复后重新执行 Step 1 至 Step 3。

### Step 5：本地服务与用户浏览器验收

只在 Step 4 没有阻断项时进行。按 `apps/mvp-server/README.md` 的本地启动方式运行服务和原型，提供本地 URL 给用户。建议验收路径：

```text
匿名会话 -> 录音/上传 -> 处理 -> 报告 -> 重录 -> 比较
账户登录 -> 历史 -> 删除 -> 隐私设置
分钟不足 / 支付入口 / Webhook 后权益显示
管理员观察与重试
```

用户验收前，监督进程仍应自己完成 HTTP health/API smoke；不要将接口和构建问题留给用户发现。

## 8. 已知关键文件索引

| 主题 | 文件 |
|---|---|
| MVP HTTP 组合与恢复 | `apps/mvp-server/src/application.js` |
| 服务启动顺序 | `apps/mvp-server/src/index.js` |
| 持久化快照 | `apps/mvp-server/src/persistent-store.js` |
| 分析 HTTP 路由 | `apps/mvp-server/src/routes-analysis.js` |
| 认证 HTTP 路由 | `apps/mvp-server/src/routes-auth.js` |
| 账户/管理路由 | `apps/mvp-server/src/routes-account.js` |
| 核心业务状态机 | `services/core-platform/src/core-platform-service.js` |
| 核心 JSON repository | `services/core-platform/src/analysis-repository.js` |
| 核心 JSON 数据库 | `services/core-platform/src/json-database.js` |
| 计费/Webhook | `services/account-billing/src/billing-service.js` |
| 管理聚合 | `services/account-billing/src/admin-service.js` |
| 权益 | `services/account-billing/src/entitlement-service.js` |
| SDK Webhook | `spikes/sdk-integrations/src/webhook.js` |
| SDK 支付业务 | `spikes/sdk-integrations/src/payment-service.js` |
| 统一门禁 | `scripts/quality-gate.mjs` |
| MVP 原始计划 | `docs/MVP_PLAN.md` |

## 9. 完成判定清单

只有以下所有条件同时满足，才可把任务标记为完成：

- [ ] 当前工作树的所有 MVP 功能已按实际契约实现，没有已知未处理的 P0/P1 缺陷。
- [ ] 第一轮 `quality-gate.mjs all --require-feature-tests` 成功。
- [ ] 第二轮 `CI=1 TZ=UTC quality-gate.mjs all --require-feature-tests` 成功。
- [ ] `git diff --check` 成功，且所有局部/回归测试的结果可追溯。
- [ ] 最终代码审查没有阻断项；跨持久化一致性风险已修复或被明确接受并记录。
- [ ] 本地服务/API smoke 通过。
- [ ] 用户已完成最终浏览器使用验收。
- [ ] 用户明确授权后，才执行提交、合并或远端操作。

在本文件生成时，前六项和用户浏览器验收均未全部满足；因此当前状态是**持续实施与验证中**。
