# SpeechOptimizer Repository Instructions

本文件适用于整个 SpeechOptimizer 仓库。进入存在更具体 `AGENTS.md` 的子目录时，同时遵守该文件；若规则发生冲突，以更具体的子目录规则为准。`prototype/AGENTS.md` 的 UI、浏览器和 Sites 交付规则保持有效，本文件不覆盖它。

## Canonical State Sources

长任务不能依赖聊天上下文作为唯一状态源。聊天记录可能被截断、压缩、跨会话丢失，也可能只记录计划而非真实落盘结果。

恢复或继续工作时，按以下优先级确认事实：

1. 用户当前明确指令；
2. 本仓库中的 `AGENTS.md` / 子目录 `AGENTS.md`；
3. 当前 canonical handoff：`docs/MVP_HANDOFF_2026-09-03.md`；
4. Git 工作树、实际文件内容、锁文件与运行时代码；
5. 当前重新执行的测试、构建、浏览器或外部集成证据；
6. 聊天上下文仅作为辅助线索。

如果聊天描述、旧 handoff 和当前工作树不一致，以当前用户指令和可复现的磁盘/验证事实为准，并立即更新 handoff 说明差异。禁止仅凭“之前说过已经完成”跳过检查。

## Long-Task Checkpoints

长任务必须维护可恢复 checkpoint。默认使用 `docs/MVP_HANDOFF_2026-09-03.md`，不要为了每个会话或阶段新建第二套 handoff。

以下任一情况发生时必须写 checkpoint：

- 一个实现阶段、重构阶段或验证阶段完成；
- 当前测试状态从绿变红、从红变绿，或出现新的环境限制；
- 新增/解除 BLOCKER、MAJOR 风险或外部依赖；
- 做出会影响架构、数据模型、资金/权益、隐私、安全或部署的决定；
- 一次失败尝试产生了需要避免重复踩坑的信息；
- 安装/升级依赖、迁移 SDK、修改 schema、持久化格式或跨模块契约；
- 准备进行高风险或大范围修改前，以及修改完成并验证后；
- 上下文明显变长、准备切换会话、用户要求暂停/交接、或当前工作可能被中断；
- 在向用户声明某阶段“完成”之前。

每个 checkpoint 至少要更新 handoff 中这些 canonical 字段：

- `Goal`
- `Current Phase`
- `Current Objective`
- `Completed`
- `In Progress`
- `Next`
- `Blockers`
- `Architecture Decisions`
- `Failed Attempts`
- `Verification`
- `Git State`
- `Important Files`
- `Session Summary`

已有详细章节时，字段应链接/指向已有章节并更新摘要，不重复复制整套事实。

## Context Recovery Flow

新会话、上下文恢复或长任务中断后，禁止直接根据聊天摘要继续写代码。按顺序执行：

1. 读取根 `AGENTS.md`，以及准备修改目录下的任何 nested `AGENTS.md`。
2. 读取 `docs/MVP_HANDOFF_2026-09-03.md` 的 canonical state 字段、当前阶段、最新 checkpoint 和对应详细章节。
3. 检查当前分支、HEAD、`git status --short`、相关 diff/stat；不要假设 handoff 记录的 Git 状态仍然最新。
4. 读取 `Important Files` 和当前 `In Progress` 直接涉及的实现/测试/契约文件。
5. 如果 handoff 标记当前工作树为红灯、未验证或验证已过期，先运行最小诊断复现当前状态，再修改代码。
6. 从 `Current Objective` / `In Progress` / `Next` 恢复，不重新开始已经有磁盘证据证明完成的工作。
7. 如果发现 handoff 与实际文件不一致，先修正 handoff，再继续大范围实施。

恢复过程中不得删除不认识的未跟踪文件、stash、本地数据目录或其他用户工作来“恢复干净状态”。

## Git Recoverable Points

Git 的目标是让长任务可回退，而不是追求工作树表面干净。

在大重构、依赖升级、schema/持久化变更、跨模块接口调整前，至少记录：

```text
branch
HEAD commit
working-tree status
scoped diff/stat
当前验证状态
```

将这些信息写入 handoff 的 `Git State` / `Verification`。

规则：

- 未经用户明确允许，不执行 `commit`、`push`、`merge`、`rebase`、`reset --hard`、`clean` 或会丢失用户改动的操作。
- 不得擅自 stash 用户改动来获得“干净工作树”；确需 stash 时先说明范围并取得允许。
- 用户允许 commit 时，优先在一个独立阶段完成且关键验证通过后创建小而清晰的 checkpoint commit；不要把未验证红灯状态伪装成完成提交。
- checkpoint commit 不能替代 handoff；即使有 commit，也必须更新 handoff 的阶段、验证和下一步。
- 用户不允许 commit 时，使用 handoff 中记录的 HEAD + status + scoped diff 作为恢复点，并保持修改范围可解释。
- 不把 `.data/`、本地缓存、凭证、真实用户数据或其他机器状态纳入 checkpoint commit。

## Verification Rules

任何“完成”“修复”“可交付”结论必须来自当前工作树的验证，不得只引用历史绿灯。

基本顺序：

1. 修改期间先跑最小相关语法/单元/契约测试，快速定位问题。
2. 当前阶段实现完整后，按 handoff 的 `Step 1` 做定向回归。
3. 定向回归通过后，再执行 handoff 的第一轮完整质量门禁。
4. 第一轮通过后，再执行独立 `TZ=UTC` 第二轮门禁。
5. 任意代码修复发生在 Step 1–3 之后，都必须从 Step 1 重新开始；不能沿用修复前的绿灯。
6. UI/浏览器行为必须遵守 `prototype/AGENTS.md`，并用真实浏览器 smoke 验证关键路径和响应式，不用纯单测替代浏览器事实。
7. 外部 Provider、Waffo Sandbox、支付方式、Webhook 投递、真实邮件/OAuth/STT/LLM 等，只能在真实对应环境证据存在时声明通过；Mock/fixture 只能证明本地契约。
8. 最后运行 `git diff --check`，并审查最终 diff 是否包含无关文件、秘密、调试残留或生成物。

handoff 的 `Verification` 必须区分：

- 当前工作树证据；
- 历史稳定基线；
- 未运行/过期证据；
- 环境导致的失败；
- 真实业务失败。

测试失败时记录精确失败点和当前第一根因。禁止把“语法通过”“部分测试通过”“历史门禁通过”写成当前全绿。

## Handoff Update Rules

`docs/MVP_HANDOFF_2026-09-03.md` 是当前 canonical handoff。除非用户明确要求归档/新版本，或者该文件已经无法承载当前项目状态，否则不要新建 `docs/HANDOFF.md`、新的日期 handoff 或并行状态文件。

阶段结束时必须更新 handoff，至少做到：

- `Completed`：只记录已有磁盘/验证证据的完成项；
- `In Progress`：准确写到文件/函数/测试级别的中断点；
- `Next`：给出下一位接手者可直接执行的最短顺序；
- `Blockers`：区分代码、环境、外部凭证、人工决策；
- `Architecture Decisions`：记录不可从代码推导的关键决定和来源；
- `Failed Attempts`：记录失败原因和为何不要重复同一路径；
- `Verification`：写命令、结果、时间/环境差异以及证据是否仍有效；
- `Git State`：分支、HEAD/远端关系、dirty/untracked 状态、是否有 commit/push；
- `Session Summary`：用少量文字说明本阶段做了什么、停在哪里、为什么。

不要为了更新摘要删掉已有详细历史；对已失效信息标注“historical / superseded”，不要让旧绿灯看起来像当前状态。

## Failure and Interruption Discipline

- 遇到失败先保留证据，再修复；不要先改代码再凭记忆描述原始错误。
- 同一失败尝试两次仍无进展时，更新 `Failed Attempts`，重新检查假设、契约和运行环境，不机械重复命令。
- 用户中断或要求交接时，立即停止继续扩展实现，先记录当前磁盘事实、红/绿状态、未落盘计划与拥有的本地进程。
- 对“准备做”“计划创建”“刚要拆分”但尚未成功写入的内容，必须明确标记为 **not landed**，禁止写成 Completed。
- 只清理本轮自己启动且能确认归属的进程；不要杀掉未知服务。

## Security and Sensitive State

Handoff、日志和 Git checkpoint 只能记录配置键名、状态和脱敏标识，不能写入真实 API key、private key、Cookie、OAuth token、Webhook secret、用户音频、完整转写或其他秘密/私人数据。

涉及支付、权益、隐私、认证或删除的变更，应在阶段 verification 中包含对应的失败边界/幂等/授权测试，而不只验证 happy path。
