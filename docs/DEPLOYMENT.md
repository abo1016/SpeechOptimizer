# SpeechOptimizer 部署运行手册

> 最后更新：2026-09-06（Asia/Shanghai）
>
> 当前状态：**Cloudflare 免费层迁移进行中。Preview D1 `0003`～`0006` 已完成受控应用与复核；浏览器 smoke 在 `c8b7078` 上发现的 `/health` 解包 blocker 已由固定提交 `90ae1976e4212730ce7895411465cf5d71aab6e7` 修复并重新部署到 `speechoptimizer-web-preview`。远端 Queue producer/consumer、Workflow、Cron handler 与 `/health` bindings 均已复核，浏览器 bootstrap 已恢复并能渲染真实 Managed Turnstile。剩余真实 signed upload、Queue/Workflow/STT、认证、删除/清理与 1/5/10 MiB 性能 E2E 需要通过真人 Turnstile Gate 后继续。Production D1 仍待 `0003`～`0006`，Production Worker 不存在，尚未部署或切流。** 本文只描述后续受控发布流程，不把本地测试、`wrangler deploy --dry-run` 或 HTTP smoke 当作 Production 验收。

## 1. 范围与当前事实

当前目标架构是单个 Cloudflare Worker 承载 Vite Static Assets 和同源 API，并使用 D1、Queues、Workflows、Supabase private Storage 与应用 Cron。环境和资源名称以 [apps/cloudflare-worker/wrangler.jsonc](../apps/cloudflare-worker/wrangler.jsonc) 为准：

| 环境 | Worker | D1 | Supabase Storage bucket | Queue / Workflow |
| --- | --- | --- | --- | --- |
| `local` | `speechoptimizer-web-local` | `speechoptimizer-local` | 本地 R2 测试后端 | `speechoptimizer-local-analysis` |
| `preview` | `speechoptimizer-web-preview` | `speechoptimizer-preview` | `speechoptimizer-preview-audio` | `speechoptimizer-preview-analysis` |
| `production` | `speechoptimizer-web` | `speechoptimizer-production` | `speechoptimizer-production-audio` | `speechoptimizer-analysis` |

以下状态来自 [Cloudflare 免费层迁移计划](CLOUDFLARE_FREE_TIER_MIGRATION_PLAN.md) 截至 2026-09-06 的最新 checkpoint，后续执行仍必须重新核验，而不能仅依赖本段文字：

- Phase 1 正式 Preview HTTP smoke 已通过：`/` 为 `200`、`/history` 为 `200`、`/health` 返回 JSON `200`、`POST /health` 返回 JSON `405`、未知 API 返回 JSON `404`。这些证据只覆盖静态资源和路由，不证明本轮功能资源已经上线。
- Preview `speechoptimizer-preview` 的 `0003`～`0006` 首次 `migrations apply` 因 Cloudflare API timeout，post-list 仍显示四项待应用；主控只放行一次受控重试后四项逐个成功，exit `0`，最终 `migrations list` 返回 `No migrations to apply!`。Wrangler 输出未显示 backup/bookmark，不记录或声称存在备份/书签证据。
- Production `speechoptimizer-production` 仍待应用 `0003_analysis_pagination_and_retention.sql`、`0004_account_deletion_and_storage_reservations.sql`、`0005_upload_tickets_and_dispatch_recovery.sql` 与 `0006_dlq_admin_recovery.sql`；本次未触碰 Production，后续仍须重新列出并应用**所有**未应用 migration。
- 四个 Preview/Production Queue 与 DLQ 已存在；`c8b7078` 部署后只读复核显示 Preview 主 Queue `speechoptimizer-preview-analysis` 为 `1 producer / 1 consumer`，Preview Workflow `speechoptimizer-preview-analysis` 已绑定到 `speechoptimizer-web-preview`，Production Queue/DLQ 仍为 `0/0`。DLQ 没有 consumer 属于当前设计，不得据此声称完整业务 E2E 已通过。
- 2026-09-06 已通过 `wrangler secret list --env preview --format json` 只读确认 Preview 的 `SUPABASE_SECRET_KEY` 与 `OPENAI_API_KEY` **名称存在**；该命令不读取、验证、导出或回显值，因此不能证明值可用、是否已轮换或真实 E2E 已通过。Worker 仍应只将它们作为 Secret 使用。AIHubMix 的 `OPENAI_STT_URL`/`OPENAI_STT_MODEL` 已进入审查配置，真实转写兼容性仍须由 E2E 验证。
- `c8b7078c9e379ea3f1b5dd1068a1d9db3993c23a` 曾部署为 Version `7ce40b6f-f8a8-41b8-901a-1f1858f38305`；发布后浏览器 smoke 发现 API client 只解包 `{data}`、而公开 `/health` 返回顶层 JSON，导致 bootstrap 读取 `health.mode` 失败。该问题已由 `90ae1976e4212730ce7895411465cf5d71aab6e7` 修复并部署为 Version `c876e33d-785a-4680-92b2-58984bf2209b`。
- 修复版本的 `/health` 返回完整 `90ae197...` SHA，并报告 assets、D1、Storage、Queue、Workflow 均为可用；HTTP smoke 为 `/` `200`、`/history` `200`、`/health` `200`、`POST /health` `405`、未知 `/api/v1/*` `404`。浏览器 bootstrap 不再报 service connection error，Recent sessions 正常结束初始化，真实 Managed Turnstile 已渲染。常规与 `TZ=UTC` 双轮完整质量门禁均通过，显式 TAP 测试为 `229/229`；Preview dry-run、Preview/Production generated-types、`git diff --check` 与 Preview D1 remote list 也通过。两个 Preview Secret 的名称级 Gate 已关闭，但其有效性、轮换状态及 AIHubMix 音频转写兼容性仍须由通过 Turnstile 后的真实流程证明。Production D1、Production Worker、Production secrets 与公网切流均未触碰。
- Production 的 `wrangler.jsonc` 目标配置已存在，但 Production Worker 不存在；独立 Production secrets、真实 E2E 与公网切流均**未验收**。

旧 OpenAI Sites + Railway Demo/Mock 路径不再是新功能的主发布路径。迁移期间它们只作为回退链保留；不得删除 Railway service、持久卷、Sites 配置或旧数据，也不得把其历史健康检查当作 Cloudflare Production 成功证据。

本轮已执行且只执行 Preview Worker 的固定 SHA 部署；没有执行 Production D1、Production Secret、Production Worker、DNS、Queue/Workflow 管理操作或 Supabase 配置写入。

## 2. 发布不变量

- 每次发布使用经审查的不可变 Git commit SHA；禁止从有未提交修改或未记录来源的工作树发布。
- 本轮高优先级代码纠偏及其直接相关的回归测试必须先通过；不得把 Secret 配置、dry-run 或历史 HTTP smoke 当作替代 Gate。
- 严格先 Preview、后 Production。Preview 的完整真实 E2E 未通过时，不创建 Production 部署、不写入 Production secret、不切换公网入口。
- Preview 和 Production 的 D1、Storage bucket、Queue、Workflow、OAuth client、邮箱发送配置和全部 secrets 必须独立；Preview 禁止读取或写入 Production 数据。
- `PAYMENTS_ENABLED=false` 是当前免费 Beta 的明确边界，不能用 Sandbox 或占位支付凭证冒充生产支付。
- Worker 不接收完整生产音频上传；浏览器通过单对象、短期限的 Supabase signed upload URL 直传 private bucket。
- 所有远端写步骤均由获授权的发布操作者执行并留存证据。本文中的写操作命令只作运行手册示例。

## 3. Preview 资源准备

### 3.1 发布前本地 Gate

在选定的、干净且已审查的 commit 上运行，并先纳入本轮高优先级代码纠偏。任何失败都先修复或明确豁免，不部署本轮 Preview 功能版本：

```bash
pnpm --dir apps/cloudflare-worker run check
pnpm --dir apps/cloudflare-worker run test
pnpm --dir apps/cloudflare-worker run build:prototype
pnpm --dir apps/cloudflare-worker exec wrangler deploy --env preview --dry-run
```

`build:prototype` 生成的 Static Assets 位于 `prototype/dist/client`；该目录由 Wrangler 配置引用。dry-run 只验证构建与配置，不能证明远程绑定、域名可达性或第三方 Provider 可用。

### 3.2 Preview 资源核验

先以只读方式记录以下项目的名称、环境和访问边界，不在终端、截图或工单中输出 secret 值：

- Cloudflare Preview Worker 使用 `speechoptimizer-web-preview`，D1 binding 为 `DB`，且对应 Preview D1 而非 Production D1。
- Preview Supabase bucket 为 private，只允许产品当前支持的 `audio/webm`，单对象最大 10 MiB；不得把 bucket 改为公开，也不得用公开 key 代替 server secret。
- Wrangler 配置要求 Preview 使用独立的 Queue 和 DLQ：`speechoptimizer-preview-analysis` 与 `speechoptimizer-preview-analysis-dlq`；Workflow 名称为 `speechoptimizer-preview-analysis`；Cron 配置为每日 `17 3 * * *`。`90ae197...` 部署后已只读确认 Preview 主 Queue 为 `1 producer / 1 consumer`、Workflow 已绑定；后续每次新版本部署仍必须重新核验这些绑定与消费状态，不能沿用历史结果。
- `ALLOWED_ORIGINS` 只包含确认的 Preview origin；Google OAuth redirect URI、Resend 发件域和 Turnstile hostname 与实际 Preview URL 完全一致。
- `SUPABASE_URL`、`SUPABASE_STORAGE_BUCKET`、`TURNSTILE_SITE_KEY`、`OPENAI_STT_URL`、`OPENAI_STT_MODEL`、大小/时长/免费额度参数是非敏感运行时变量；任何修改都应通过审查后的 Wrangler 配置发布，不应临时在 Dashboard 漂移。

历史记录中曾确认 Preview Turnstile 验证 secret 已写入，但发布前仍应只读确认 secret 名称存在。名称存在不代表完整认证、Storage 或 Provider 流程已经通过。

## 4. D1 migration 与 Secrets Gate

### 4.1 D1 migration

在 Preview 首次部署或源码新增 SQL 后，先查看远端未应用列表。以下命令访问远端，但第一条仅只读；第二条会写入 D1，必须获得发布授权后才执行：

```bash
# 只读：目标 DB 使用 wrangler.jsonc 的 DB binding。
pnpm --dir apps/cloudflare-worker exec wrangler d1 migrations list DB --remote --env preview

# 远端写入：会应用当前目录中全部未应用 migration，并由 Wrangler 提示确认与创建备份。
pnpm --dir apps/cloudflare-worker exec wrangler d1 migrations apply DB --remote --env preview

# 只读复核：应不再显示未应用 migration。
pnpm --dir apps/cloudflare-worker exec wrangler d1 migrations list DB --remote --env preview
```

不要只针对单个 migration 手工执行或假设待应用列表固定，因为当前源码已经包含 `0003`～`0006`。记录执行前后的列表、操作者、时间、目标环境和 Wrangler 输出中的备份信息；不记录 SQL 中的用户数据。

D1 migration 采用向前兼容的 expand/migrate/contract 策略。Worker 版本回滚不会回滚数据库 schema 或数据：迁移失败按 Wrangler 的事务结果处理；已成功应用但需要纠正的 migration 只能通过经过审查的 forward repair 或已验证的恢复方案处理。

### 4.2 Secrets 与运行时配置

下面是当前代码完成完整 Preview 认证、Storage 和 STT E2E 所需的变量集合。它是代码依赖清单，**不是**这些值已在 Cloudflare 配置完成的声明。

| 变量 | 用途 | 管理要求 |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Supabase signed upload、对象 metadata/Range 校验、对象删除 | Preview 独立 server secret；兼容期可改用 `SUPABASE_SERVICE_ROLE_KEY`，两者不要混用为浏览器变量 |
| `OPENAI_STT_URL` | OpenAI-compatible STT 的完整 `POST` endpoint | 非敏感 Wrangler `vars`；只允许 HTTPS，不得包含 userinfo、query、fragment 或 API key；Preview/Production 分别显式配置 |
| `OPENAI_STT_MODEL` | STT multipart 请求中的 `model` 字段 | 非敏感 Wrangler `vars`；必须与目标中转兼容，并支持下述逐词时间戳响应契约 |
| `OPENAI_API_KEY` | 配置的 OpenAI-compatible STT 鉴权 | Preview 专用、可撤销的 Worker Secret；只进入 `Authorization: Bearer`，绝不写入 URL、D1、对象 metadata、日志或 `VITE_*` |
| `COOKIE_SECRET` | 匿名 Cookie、Session 与 OAuth state 绑定签名 | 使用独立高熵值，不与任何旧服务共用 |
| `TURNSTILE_SECRET_KEY` | Magic Link、Google OAuth、匿名分析的人机验证 | 仅 Worker Secret；站点 key 是非敏感变量，不能替代验证 secret |
| `RESEND_API_KEY`、`MAGIC_LINK_FROM` | Magic Link 邮件投递与已验证发件地址 | 使用 Preview 发件身份；不得将邮件 token 记录到日志 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | Google OAuth code exchange | 使用 Preview OAuth client，redirect URI 必须与实际 Preview origin 匹配 |

使用交互式 Secret 写入，避免把值放进 shell history、Git、`.env`、`--var` 或 `--secrets-file`。示例中的 `<SECRET_NAME>` 由获授权操作者逐项替换：

```bash
# 远端写入；交互式粘贴单个值，终端不会把值作为命令参数保存。
pnpm --dir apps/cloudflare-worker exec wrangler secret put <SECRET_NAME> --env preview

# 只读：只核对名称，不显示值。
pnpm --dir apps/cloudflare-worker exec wrangler secret list --env preview --format pretty
```

每项 Secret 写入后只记录“名称存在、环境、写入时间、操作者和轮换标识”。不要将值粘贴到 PR、Issue、聊天记录、部署日志或截图。Production 必须在 Preview E2E Gate 通过后，使用全新的 Production 值重复此流程。

当前 Worker 只接受 OpenAI-compatible 的音频转写契约：向 `OPENAI_STT_URL` 发送 `POST multipart/form-data`，携带 `file`、`model`、`response_format=verbose_json` 与 `timestamp_granularities[]=word`，并使用 Bearer 鉴权。中转响应至少需要提供 `text`、可信 `duration` 与逐词 `words`；最好正确处理 `Idempotency-Key`，避免 Workflow 重试造成重复计费。若中转使用不同路径、鉴权方式、请求字段或响应包装，必须先实现并测试显式 adapter，不能仅修改环境变量后直接部署。

## 5. Preview 部署与 smoke

### 5.1 Preview 部署

确认高优先级代码纠偏、migration、secrets 和非敏感运行时配置均满足 Gate 后，使用同一不可变 commit 发布。部署命令会创建或更新 Worker 配置及绑定，属于远端写操作：

```bash
COMMIT_SHA="$(git rev-parse HEAD)"
pnpm --dir apps/cloudflare-worker exec wrangler deploy \
  --env preview \
  --var "APP_VERSION:${COMMIT_SHA}" \
  --message "preview ${COMMIT_SHA}"

# 只读：记录部署与版本 ID，供回滚使用。
pnpm --dir apps/cloudflare-worker exec wrangler deployments list --env preview
pnpm --dir apps/cloudflare-worker exec wrangler versions list --env preview
```

不要用 Dashboard 手工修改业务代码或临时绑定；不要把 secret 作为 `--var` 传入。默认部署会按版本化配置同步非敏感 vars，而 Secrets 不会被部署删除；若发现 Dashboard 中存在未纳入配置的运行时变量，先完成来源核验，不以 `--keep-vars` 掩盖漂移。

### 5.2 HTTP smoke

Phase 1 已从可达网络完成基础 HTTP smoke：`/`、`/history`、`/health`、`POST /health` 和未知 API 分别得到预期的 `200`、`200`、`200` JSON、`405` JSON、`404` JSON。该结果不覆盖当前分支的 D1、Storage、Queue、Workflow、Cron 或第三方认证/Provider 绑定。每次发布本轮功能版本后，仍须从能正常访问 `workers.dev` 或 Preview 自定义域名的网络重新执行以下 smoke；网络错误只能说明该网络不可达，不能替代应用验收。

以不含凭证的 `PREVIEW_BASE_URL` 执行并保存脱敏结果：

```bash
curl --fail-with-body -i "$PREVIEW_BASE_URL/health"
curl --fail-with-body -i "$PREVIEW_BASE_URL/history"
curl -sS -i -X POST "$PREVIEW_BASE_URL/health"
curl -sS -i "$PREVIEW_BASE_URL/api/v1/not-found"
```

验收点：

- `/health` 返回 `environment=preview`、`mode=cloudflare`，并显示 assets、D1、Storage、Queue、Workflow 的绑定可用；响应不得泄露资源 ID、内部地址或 secret。
- 首页与 `/history` 深链可加载 SPA。
- `POST /health` 稳定返回 JSON `405`，未知 `/api/v1/*` 稳定返回 JSON `404`。
- 响应头中的 Cookie 仅在认证流测试中出现，且不得出现在截图、日志或工单附件中。

健康检查只能证明 binding 在运行时可见，不能替代真实 D1 写入、Supabase signed upload、Queue/Workflow 或 OpenAI 的端到端测试。

## 6. Preview 真实 E2E Gate

使用专用 Preview 测试账号、测试邮箱、测试 Google 账号和无敏感内容的短 `audio/webm`（不超过 10 MiB）。任何一项失败都阻止 Production 发布。

| 流程 | 必须观察到的结果 |
| --- | --- |
| Magic Link | Turnstile 校验、邮件送达、链接只能消费一次、过期/重复消费返回稳定错误、Session Cookie 可建立和注销 |
| Google OAuth | 发起和回调都在同一浏览器完成，state Cookie 绑定有效，错误或完成后旧 state Cookie 被清除 |
| 上传 | 创建分析有 Idempotency-Key；Worker 只签发当前分析的单对象 URL；浏览器直传 private bucket；错误大小、MIME、SHA-256 或 WebM 魔数被拒绝 |
| 分析 | `audio-complete` 后任务进入 Queue/Workflow；配置的 OpenAI-compatible STT 成功后可读报告和历史；重复完成仅接受完全一致的请求，篡改请求返回冲突 |
| 失败和重试 | Provider 超时/拒绝能落为稳定错误状态；可重试任务不重复生成报告或额外消耗额度；不可重试任务不进入无界重试 |
| 隐私和清理 | 删除分析会删除关联对象；账户删除会撤销 Session、删除关联数据与对象；Cron 运行后处理孤儿、过期认证记录和延迟删除 |
| 免费护栏 | `FREE_TIER_GUARD_LEVEL=80/90/95` 的降级行为与代码一致：80 暂停匿名分析，90 暂停新分析，95 进一步暂停新上传，读取路径保持可用 |

对 Cron 和队列处理，必须从 Preview 的实际任务状态、Worker 日志、Queue/DLQ 和 Workflow 结果中取证；本地 `wrangler dev --test-scheduled` 或单元测试不能代替远程 Cron 证据。日志仅保留事件名、状态码、分析 ID 或经过审查的摘要，严禁记录 Cookie、OAuth code/state、Magic Link token、音频内容、转写全文或 Provider 响应体。

完成 E2E 后，发布负责人应记录：commit SHA、部署/版本 ID、D1 migration 列表、secret 名称清单、测试时间、测试账号标识（脱敏）、每项验收结果、错误率与回滚候选版本。只有这些证据齐全，才可进入 Production 变更审批。

## 7. Production 发布 Gate

Production 当前不应执行部署或公网切流。仅当本轮高优先级代码纠偏验收通过、Preview 全部真实 E2E 通过、回滚版本已确定、负责人批准且旧 Sites/Railway 回退链可用时，才按与 Preview 相同的顺序执行：

1. 在 Production D1 上先 `migrations list`，再以确认的 forward-compatible SQL 执行 `migrations apply`，并记录备份信息。
2. 写入完全独立的 Production secrets；不得复制 Preview server secret、OpenAI key、Cookie secret、OAuth client secret 或 Resend key。
3. 用同一个已验收 commit 构建、dry-run、部署 `--env production`，记录版本 ID；先验证 Worker 默认地址，后按单独批准的域名/路由计划切流。
4. 以正式域名重新执行 HTTP smoke、认证、上传、分析、隐私删除和失败路径 E2E。
5. 仅在 Production smoke 成功后才允许变更公网 DNS/路由。DNS 不是日常代码回滚机制。

Production 的 `ALLOWED_ORIGINS`、Google OAuth redirect URI、Resend 发件域和 Turnstile hostname 必须在切流前再次逐项核对。不要假设 `speak-confidently.top` 已经指向 Cloudflare Worker，也不要因 Wrangler 配置存在就宣称已切流。

## 8. 回滚与故障处置

### 8.1 Worker 版本回滚

发布前记录最后一个已验证版本 ID。若新 Worker 导致严重回归，先停止进一步切流，再由获授权操作者回滚到该版本：

```bash
# 远端写入：<KNOWN_GOOD_VERSION_ID> 必须来自部署记录，而不是猜测。
pnpm --dir apps/cloudflare-worker exec wrangler rollback <KNOWN_GOOD_VERSION_ID> \
  --env production \
  --message "rollback to verified version"
```

Preview 故障同样使用 `--env preview`。回滚后重新检查 `/health`、关键读取路径、错误率和 Queue/DLQ。不要删除失败版本、D1、Storage bucket 或 Queue，以保留调查证据。

### 8.2 数据与服务降级

- D1 已应用 migration 时不要将 Worker rollback 当作数据库 rollback；使用已验证备份或前向修复方案。
- 若容量或第三方错误需要立即降级，当前代码支持通过审查后的配置发布提高 `FREE_TIER_GUARD_LEVEL`：`80` 暂停匿名分析，`90` 暂停新分析，`95` 暂停新上传。该机制不是通用维护模式，仍须观察登录、历史和报告读取。
- 保持旧 Sites/Railway Demo/Mock 路径和数据不变，直到 Cloudflare Production 已稳定运行至少 72 小时且 owner 明确批准下线；若需将流量回退到旧路径，DNS/路由变更必须单独获批并留证。

## 9. Production 后 72 小时观察清单

在 Production 切流后，首期保持每日最多 50 次分析的免费 Beta 限额，不提高配额、不下线旧回退链。每个检查周期记录时间、环境、观察者、结论和关联版本 ID。

| 时间点 | 检查项 | 触发动作 |
| --- | --- | --- |
| 切流后 0-2 小时 | Worker HTTP 5xx、`/health`、静态资源、认证失败、Storage 签发/完成、Queue backlog/DLQ、Workflow 成功率 | 严重回归先停止切流或回滚 Worker 版本 |
| 每日 | Workers 请求量/CPU/错误率、D1 行读写/存储、Queue 操作与 DLQ、Workflow 步数/失败、Supabase Storage/egress、当前 STT 中转的错误、限流与成本、Turnstile/邮件/OAuth 异常 | 接近资源阈值时提高 `FREE_TIER_GUARD_LEVEL`，暂停放量并调查 |
| 每日 | 分析删除、账户删除、Cron 清理、孤儿对象与过期认证记录 | 清理失败不删除证据；先修复后以受控任务重试 |
| 72 小时结束 | 所有 E2E 主链仍可复现、无未解释的 DLQ/Workflow 积压、恢复方案可用、无密钥/隐私泄露、资源未越过护栏 | 由 owner 决定是否提高配额、延长观察或开始旧服务下线评估 |

Cloudflare 与 Supabase 的用量控制面是事实源；应用只根据确认的运营读数执行 `FREE_TIER_GUARD_LEVEL` 降级。出现异常时先保留脱敏日志、版本 ID、D1 migration 状态和资源用量快照，再决定修复、降级或回滚。

## 10. 交付证据最小集

每次 Preview 或 Production Gate 至少归档以下非敏感证据：

- 已审查 commit SHA、`git status --porcelain` 为空的记录、`check`/`test`/build/dry-run 结果；
- D1 migration 前后列表和备份记录；
- 各环境 secret **名称**存在的清单，不含值；
- Worker deployment/version ID、时间与回滚候选版本；
- 脱敏的 smoke/E2E 结果、Queue/Workflow/Cron 取证和用量观察；
- 已知失败项、负责人、下一步和是否允许推进到下一 Gate 的明确结论。

迁移计划的完成状态只能在上述真实远程证据产生后更新。本手册不会替代该计划，也不会把未验证事项提前标记为完成。
