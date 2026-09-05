# SpeechOptimizer MVP 上线与部署准备

> 当前状态（2026-09-05）：正式域名改为已购买并完成 Cloudflare 委派的 `speak-confidently.top`。OpenAI Sites 已绑定该域名，SSL 已激活且路由正在重新部署；Resend 已创建同名发件域名并正在验证 DKIM/SPF。Google OAuth 与 Railway 的 Origin、回调和发件地址均已切换到 `.top`，Railway 仍使用 `skipDeploys=true` 保持现有 Mock 运行态，待平台验证和本地质量门禁完成后统一部署。

## 1. 当前与推荐部署拓扑

当前代码并不适合把全部组件部署到同一个 Serverless 平台。前端是无状态 Vite SPA，当前已托管在 OpenAI Sites；`mvp-server` 仍使用本地 JSON 快照、本地音频目录和 `ffprobe`，因此现阶段运行在支持长期 Node 进程、Docker 与持久卷的 Railway 单实例上。Vercel 仅保留为遗留/备用发布路径，未经 owner 决策不修改或启用为主路径。

推荐第一版拓扑：

| 层 | 推荐服务 | 当前用途 | 是否可立即接入 |
| --- | --- | --- | --- |
| DNS / TLS / WAF | Cloudflare | 域名解析、HTTPS、WAF、DDoS、API 入口保护 | 是，账号与域名准备好即可 |
| Web 前端 | OpenAI Sites（当前） | `prototype/` Vite SPA、同源 `/api/*` 与 `/health` 代理、owner-only 访问 | 已部署并通过浏览器验收；平台侧配置 `API_ORIGIN` |
| Web 前端备用路径 | Vercel（遗留/备用） | `prototype/` Vite SPA、Preview/Production Deployment | 仓库保留 `vercel.json` 与 Release job；是否启用需 owner 单独决策 |
| API Runtime | Railway（当前） | 运行 Node 24、`ffprobe`、健康检查、单实例持久卷 | 已部署；需要平台侧生产变量与持久卷配置 |
| API 镜像 | GitHub Container Registry | 保存经过 CI 验证的 API 容器镜像 | 是，Release workflow 已准备 |
| 关系数据库 | Supabase Postgres | 目标生产持久化层，替换当前 JSON snapshot | **尚不能直接切换**，领域 schema/adapter 还未实现 |
| 音频对象存储 | Supabase Storage 或 Cloudflare R2 | 目标生产音频对象存储，替换本地文件目录 | **尚不能直接切换**，对象存储 adapter 还未实现 |
| 邮件 | Resend / Postmark / SES / 受控 SMTP | Magic Link 与通知邮件 | 需要真实 Provider 接线和投递验证 |
| AI | OpenAI API | STT 与结构化反馈 | 需要生产 Key、预算/限流和真实 smoke |
| 错误监控 | Sentry（推荐） | 浏览器/API 异常、release 关联、告警 | 尚未接线，建议生产前补齐 |
| 可用性监控 | Better Stack / UptimeRobot / Grafana Cloud | `/health` 外部探测与告警 | 云服务创建后配置 |

### 为什么不把 API 直接放 Vercel / Cloudflare Workers

当前 API 具有以下运行时要求：

- `node:http` 长期进程；
- `ffprobe` 系统二进制；
- `MVP_DATA_DIRECTORY` 下的 JSON 与音频文件持久化；
- 当前 Webhook claim/队列是单进程语义；
- 多实例前还需要共享数据库唯一约束/锁或队列。

因此第一版用**单实例 Docker + 持久卷**最接近现有实现。完成 Supabase Postgres / S3 adapter 后，才能安全去掉本地卷并考虑更强的水平扩展。

## 2. 域名建议

当前线上入口：

```text
https://speechoptimizer.dengbodev.chatgpt.site/ -> OpenAI Sites 主站（owner-only）
https://app.bo-pop.top/                    -> OpenAI Sites 自定义域名（owner-only）
https://speechoptimizer-api-production.up.railway.app/health -> Railway API 健康检查
Sites 同源 /api/*、/health                  -> Railway API（平台侧 API_ORIGIN）
```

目标正式入口：

```text
https://speak-confidently.top/              -> OpenAI Sites 正式主站
https://speak-confidently.top/auth/callback -> Google OAuth 与 Magic Link 共用回跳页
https://speak-confidently.top/api/*         -> Sites 同源代理到 Railway API
```

生产域名切换时必须同步更新：Sites custom domain、DNS/验证记录、Railway `ALLOWED_ORIGINS`、Google OAuth authorized domain/redirect URI、Resend DKIM/SPF/DMARC、`MAGIC_LINK_FROM`、Waffo notify/redirect/goods URL，以及前端公开联系邮箱。内部 package 名、测试域名和 localhost 开发契约不随品牌域名迁移。

`api.bo-pop.top` 不是当前验收必需入口；如后续需要独立 API 域名，必须以平台实际 target 为准重新设计 DNS、CORS 和 Webhook 配置。

Cloudflare/OpenAI Sites 当前已确认：`app.bo-pop.top` 的 CNAME 指向 `custom-domains.chatgpt.site`，所有权验证 TXT 与 Cloudflare Custom Hostname 验证 TXT 已配置；Sites 域名对象 `status=active`、`provider_status=active`、`ssl_status=active`，匿名访问返回 HTTP 401，不再是 404。无需继续修改 DNS。

Cloudflare 建议：

- 独立 API 域名只有在 owner 决定启用时才创建；若启用，使用 Proxied 记录让 API 经过 Cloudflare WAF / DDoS 防护；
- Sites 自定义域名验证记录按 Sites 平台要求维护；验证用 TXT/CNAME 不要代理；
- Railway Production API 的 `ALLOWED_ORIGINS` 只允许真实前端 Origin，不保留 localhost；当前同源代理的 `API_ORIGIN` 和目标地址均属于 Sites 平台侧配置；
- Webhook 路径不要缓存；对普通 API 默认禁用 CDN 缓存，静态前端由当前托管平台负责缓存。

## 3. GitHub Actions 已初始化的工作流

### CI：`.github/workflows/ci.yml`

PR、`main` push 和手动运行都会执行：

1. `pnpm/setup@v2` 安装 Node.js 24 + pnpm 11.25.0；
2. 所有独立 package lockfile 的冻结依赖安装；
3. 第一轮完整 `quality-gate`；
4. 独立 `TZ=UTC` 第二轮完整 `quality-gate`；
5. `git diff --check`。

建议在 GitHub Ruleset / Branch Protection 中把 `MVP quality gate` 设为 `main` 的 Required status check。

### Release：`.github/workflows/release.yml`

生产发布默认关闭。只有 Repository variable：

```text
PRODUCTION_DEPLOY_ENABLED=true
```

存在时才会发布。

自动发布只接受：

```text
main push -> CI success -> release
```

Release 会做两件互相独立的事情：

1. 用 `apps/mvp-server/Dockerfile` 构建并推送 `ghcr.io/<owner>/<repo>-mvp-server`；
2. 使用固定版本 Vercel CLI 的 `vercel pull -> vercel build --prod -> vercel deploy --prebuilt --prod` 发布 `prototype/`。

当前线上主站使用 OpenAI Sites，以上 Vercel Release 是仓库中保留的遗留/备用路径，不是本次 Sites 部署的发布链。未经 owner 明确决定，不修改、启用或替换该 Vercel 流程；`PRODUCTION_DEPLOY_ENABLED` 继续保持关闭。

Release 还会执行以下安全门禁：

- 自动触发只接受成功的 `CI` 对 `main` 的 push，人工触发也只接受 `main`；
- checkout 固定到已经通过 CI 的精确 commit SHA，并重新运行常规与 `TZ=UTC` 双轮完整门禁；
- 所有 checkout 都关闭凭证持久化，GHCR 的 `packages: write` 只授予镜像发布 job；
- GitHub checkout 使用 Node 24 runtime 的 `actions/checkout@v7`，pnpm/Node 使用官方 successor `pnpm/setup@v2`；
- Docker 发布 action 使用 Node 24 runtime 的 `setup-buildx@v4`、`login@v4`、`build-push@v7`；
- Vercel CLI 固定为 `59.11.2`，三个 Vercel Secret 缺少任意一个都会显式失败且不输出值；
- 生产 release 使用单一 concurrency group，避免并行发布交叉覆盖。

## 4. 备用 Vercel 路径的初始化参数

本节仅适用于未来 owner 决定启用的 Vercel 遗留/备用路径，不影响当前已上线的 OpenAI Sites 主站。

先在 Vercel 创建项目，Root Directory 选择：

```text
prototype
```

然后在 GitHub Repository Secrets 添加：

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

Vercel Production Environment 至少设置：

```text
VITE_API_BASE_URL=https://api.bo-pop.top
```

上面的 API 地址仅是未来 Vercel/独立 API 域名路径的示例；当前 Sites 主站通过同源 `/api/*` 代理访问 Railway，默认使用相对路径，不依赖 `api.bo-pop.top`。

`VITE_` 变量会进入浏览器 bundle，只允许放公开配置，禁止放 API key、数据库密码或其他服务端秘密。

建议配置顺序：

1. 先保持 `PRODUCTION_DEPLOY_ENABLED` 不存在或为 `false`；
2. 建立 Vercel project 并完成 Preview 部署；
3. 设置 `VITE_API_BASE_URL`；
4. API Staging 健康后再启用生产 release；
5. 最后把 GitHub CI 设置成 Vercel Production Deployment Check / GitHub required check。

## 5. API Docker / Railway 当前部署

Docker build context 必须使用仓库根目录：

```bash
docker build -f apps/mvp-server/Dockerfile -t speechoptimizer-mvp-server:local .
```

Railway 已存在 `SpeechOptimizer` project、`production` environment 和 `speechoptimizer-api` service。本次部署使用该现有 service，禁止为了同一用途创建第二个 service。当前仓库的部署设置：

```text
Dockerfile path: apps/mvp-server/Dockerfile
Healthcheck path: /health
Persistent volume mount: /var/lib/speechoptimizer
Replicas: 1
Region: 美国西部
```

Railway service 已部署并通过 `/health` 验收；当前运行模式为 `mock`。`MVP_DATA_DIRECTORY=/var/lib/speechoptimizer`、volume 挂载、服务端口和 Sites Worker 的 `API_ORIGIN` 都是平台侧运行时配置，源码本身不能单独证明这些配置已在云端生效。

不要在仍使用本地 JSON snapshot 的阶段把 API 扩为多个 replica。多个实例会各自持有不同本地状态，并且 Webhook 单进程 claim 不具备跨实例互斥。

Railway 会注入 `PORT`；Docker 镜像已经将 `HOST=0.0.0.0`，应用会读取平台注入的端口。当前 API 健康检查地址为 <https://speechoptimizer-api-production.up.railway.app/health>。

## 6. API Production 环境变量

以 `apps/mvp-server/.env.example` 为完整键列表。生产环境至少需要分为四组管理：

### 应用安全

```text
NODE_ENV=production
HOST=0.0.0.0
MVP_DATA_DIRECTORY=/var/lib/speechoptimizer
ALLOWED_ORIGINS=https://speechoptimizer.dengbodev.chatgpt.site,https://app.bo-pop.top
COOKIE_SECRET=<至少 24 字符的高熵随机值>
```

`ALLOWED_ORIGINS` 使用逗号分隔的 Origin 列表，服务端会逐项去除首尾空白；两个 Origin 都不带尾部斜杠。

### OpenAI

```text
OPENAI_API_KEY
OPENAI_STT_URL
OPENAI_FEEDBACK_URL
OPENAI_FEEDBACK_MODEL
```

### Auth / 邮件

```text
AUTH_MODE=production
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
RESEND_API_KEY
MAGIC_LINK_FROM
```

`AUTH_MODE=production` 可以在 API 仍为 Mock AI/支付时单独启用真实登录。Google 授权、token 和 userinfo URL 已有官方默认值；如无代理或企业网关需求无需覆盖。Magic Link 通过 Resend HTTP API 投递，`MAGIC_LINK_FROM` 的域名必须先在 Resend 完成验证。真实认证模式还要求显式配置高熵 `COOKIE_SECRET` 与生产 `ALLOWED_ORIGINS`，并自动为账户和匿名 Cookie 添加 `Secure`。

### Waffo

支付上线前继续遵守 `.waffo/integration-manifest.json` 和 canonical handoff。未决人工 decision、Sandbox/Go-Live 未完成时，不得把占位符替换成 AI 猜测值。

当前 `NODE_ENV=production` 会对 Waffo 配置 fail closed；若首版明确要以“支付完全关闭”方式上线，应单独实现并验证 `PAYMENTS_ENABLED=false` 产品能力，而不是把 Sandbox/假密钥当生产配置。

当前 Railway 线上实例仍以 `mock` 模式运行，健康检查和浏览器验收不依赖上述真实 Provider。`ALLOWED_ORIGINS`（API CORS）由 Railway 平台变量管理；Sites Worker 的 `API_ORIGIN` 由 Sites 平台环境配置管理。它们属于部署平台侧配置，不能仅凭源码、`.env.example` 或 Git diff 断言线上值。

## 7. Supabase 的正确接入位置

Supabase 适合作为下一阶段的生产数据层，但现在不能只创建一个 `DATABASE_URL` 就切换，因为运行时代码尚未使用 PostgreSQL。

推荐迁移顺序：

1. 定义 `app` schema 的用户、分析、权益、订单、退款、订阅、Webhook 幂等和审计表；
2. 把 `PersistentStore` / JSON repository 改成 Postgres adapter；
3. 用唯一约束实现 Webhook event id、request id、幂等 key 的跨实例互斥；
4. 为音频实现 S3-compatible object-store adapter；
5. 创建 Supabase 私有 bucket，并保持音频默认私有；
6. 做 JSON -> Postgres / local objects -> Storage 的迁移脚本；
7. 重新执行恢复、删除、退款、权限和隐私测试；
8. 完成后才允许移除 API persistent volume 或增加多个 replica。

当前代码不使用 Supabase Auth，因此第一阶段不建议同时替换现有 Magic Link / Google Auth。先迁移持久化和对象存储可以把上线风险控制在可验证范围。

## 8. 上线环境分层

建议至少建立：

```text
local       本机 mock / fixture
preview     Vercel PR Preview，仅连接隔离 API/测试数据
staging     真实 OpenAI、真实邮件测试域、支付 Sandbox
production  真实用户数据和正式域名
```

禁止 Preview 使用 Production 数据库、Storage service key、Waffo Production key 或生产 OAuth client secret。

## 9. 正式上线前 Gate

### P0：必须完成

- GitHub `main` branch protection + Required CI；
- 前端托管项目和真实域名（当前 Sites 已完成；若采用 Vercel 则另行完成其 production 项目）；
- API Docker Staging 部署，`/health` 外网 200；
- 生产 Cookie/CORS/HTTPS 校验；
- 真实 OpenAI STT + feedback smoke；
- 真实 Magic Link 邮件投递；
- Google OAuth（若首版保留 Google 登录）；
- API 数据持久化方案已明确并完成备份策略；
- 外部 uptime/error alert；
- 生产环境 secrets 全部放平台 Secret Store，不进 Git；
- Production E2E：Web -> API -> 上传 -> STT -> feedback -> report -> history -> delete；
- 对数据删除、音频生命周期和隐私文案做最终人工核对。

### P1：强烈建议

- Supabase Postgres / Storage 迁移完成后再正式扩大流量；
- Sentry release + source map；
- Cloudflare rate-limit / WAF 规则；
- 数据库 PITR / Storage backup/restore 演练；
- staging 与 production 的独立 OAuth / 邮件 / AI / 支付凭证；
- GitHub Environment `production` 增加人工 approval。

## 10. 当前状态与仍未完成事项

截至 2026-09-04，以下部署动作已经完成并有平台侧证据：

- OpenAI Sites 主站部署成功并启用 owner-only 访问；同源 `/api/*` 与 `/health` 代理已上线；
- Railway `speechoptimizer-api` 已部署，`/health` 返回 HTTP 200，运行模式为 `mock`；
- Railway 500 MB 持久卷已挂载到 `/var/lib/speechoptimizer`，当前保持单实例；
- `app.bo-pop.top` 的 Sites 域名对象、DNS 验证和 SSL 已激活，匿名公网访问返回 HTTP 401 登录门槛；
- PR #1 已于 2026-09-04 合并，合并提交为 `1c38e65`；部署源码修复提交 `3a912b7` 与交接文档提交 `deeeca3` 已位于 `codex/cicd-bootstrap`，PR #2 是将二者同步到 `main` 的路径，合并后 `main` 将包含部署与文档提交。

以下事项仍未完成，或不属于本次 Demo/Mock 部署范围：

- PR #2 是既定源码同步路径；合并时 `main` 会包含 `3a912b7` 的 4 个部署文件变更及 `deeeca3` 的文档回写，不需要另行决定另一条同步路径；
- OpenAI 真实 STT/反馈、邮件、Google OAuth、Waffo 支付及其生产凭证/业务决策；
- Supabase schema、Postgres adapter、私有 Storage bucket、对象存储 adapter 和数据迁移；
- 生产备份/恢复演练、错误监控、日志聚合、uptime 告警和容量/成本策略；
- 若 owner 选择启用 Vercel 遗留/备用路径，再创建/链接 Vercel Project、配置 secrets 并单独验收；当前不修改或启用该流程；
- 真实 Provider 接入后的 staging/production E2E、删除/隐私与支付人工验收。

不要把“平台侧配置已生效”从源码单独推断出来：`API_ORIGIN`、CORS `ALLOWED_ORIGINS`、Railway volume 挂载和 Sites 域名路由都必须以平台配置、健康检查和浏览器/HTTP 证据为准。

## 11. 2026-09-04 插件连接与远程初始化状态（含当前交接事实）

本轮已实际通过已连接插件读取云端状态，而不是只停留在文档规划：

| 服务 | 插件状态 | 已确认事实 | 当前动作边界 |
| --- | --- | --- | --- |
| Cloudflare | 连接存在；`bo-pop.top` 记录已按部署需要配置 | `app.bo-pop.top` CNAME 指向 `custom-domains.chatgpt.site`，Sites/OpenAI 与 Cloudflare 验证 TXT 已配置；Sites 域名 `status/provider_status/ssl_status` 均为 `active` | 当前无需继续修改 DNS；`api.bo-pop.top` 不是本次验收必需入口，如后续启用必须重新核对 Railway target、CORS 和 Webhook |
| Supabase | 已连接，可管理项目 | 已在 organization `rwzohujdebahkmqfxloy` 创建独立 `SpeechOptimizer`，project ref `qnmxxvnypmfzwclyyfhr`，region `us-west-1`，状态 `ACTIVE_HEALTHY`；插件返回创建成本 `$0/month` | 当前只完成项目资源创建；业务 Postgres schema/adapter 与对象存储 adapter 尚未实现，因此不把“项目已创建”表述为生产持久化已切换 |
| Vercel | 连接存在，但当前无可列出的 Team/Project 上下文 | Vercel 仅保留为遗留/备用发布路径；当前主站由 OpenAI Sites 托管 | 未经 owner 决策不创建/链接或启用 Vercel production 路径，不修改现有 Release workflow |
| GitHub | `gh` 已认证，具备 `repo` / `workflow` scope | PR #1 已于 2026-09-04 合并，merge commit `1c38e65`；PR #2 是将 `3a912b7` 部署变更和 `deeeca3` 文档回写同步到 `main` 的既定路径，合并后 `main` 将包含二者。生产 Release 仍关闭 | 按 PR #2 的文件边界与检查完成同步；不要把 `AGENTS.md` 删除带入任何提交 |
| Railway | connector 已暴露，且本机 `railway 5.49.1` 已完成 OAuth 登录并链接现有资源 | 已存在独立 `SpeechOptimizer` project、`production`、`speechoptimizer-api`、generated domain；500 MB volume 已 Ready 并挂载 `/var/lib/speechoptimizer`，当前部署为 `mock`，`/health` HTTP 200 | 保持现有 service 与单实例 volume；真实 variables/secrets、Provider、备份和监控按后续生产计划单独配置，不创建第二个同用途 Service |

### 11.1 当前后续工作所需的最少人工确认

owner 已完成本阶段两个关键选择：Supabase 使用当前 organization 下的独立 `SpeechOptimizer` project；Sites 自定义域名使用 `app.bo-pop.top`。当前主站与 API 已上线，API 通过 Sites 同源代理访问；`api.bo-pop.top` 是否需要启用留待后续单独决策。

下一步执行顺序：

1. 通过 PR #2 将线上部署提交 `3a912b7` 与文档提交 `deeeca3` 同步到 `main`；合并后核验 `main` 的 CI，保持 `AGENTS.md` 删除在提交范围之外；
2. 保持现有 Railway `speechoptimizer-api` 单实例和 `/var/lib/speechoptimizer` volume，继续用平台健康检查和浏览器报告做运行态验收；
3. 按生产优先级配置真实 OpenAI、邮件、Google OAuth、Waffo、备份、监控与告警，并在 staging 完成真实 Provider E2E；
4. 实现并验证 Supabase Postgres/S3 adapter 后，再决定是否迁移出 Railway persistent volume 或扩大实例数；
5. 只有在 owner 决定采用 Vercel 备用路径时，才建立/链接 Vercel Project、设置 secrets 并重新验收，不把 Vercel 流程当作当前 Sites 主站发布链。

## 12. 当前线上验收事实（2026-09-04）

本节是部署手册的当前事实入口；第 11 节中较早的初始化记录保留为历史证据，若与本节冲突，以本节为准。

### 12.1 访问入口与平台状态

| 项目 | 当前事实 |
| --- | --- |
| Sites 主站 | [speechoptimizer.dengbodev.chatgpt.site](https://speechoptimizer.dengbodev.chatgpt.site/) 已部署成功，owner-only；浏览器验收需要当前 ChatGPT 账号登录 |
| Sites 部署对象 | project `appgprj_6a9ab0d858c08191b9891e7aa6ce315c`；version `appgver_7bd145986cc08191925ac77783dd005e`；deployment `appgdep_6a9ab1ed04648191b0f00ed8a7387ab6` |
| 自定义域名 | [app.bo-pop.top](https://app.bo-pop.top/) 的 Sites 域名对象 `appgdom_6a9ab280354881918e2625eba7f9afd2` 当前 `status=active`、`provider_status=active`、`ssl_status=active`；匿名公网访问返回 HTTP 401 登录门槛，不再是 404 |
| Railway API | [健康检查](https://speechoptimizer-api-production.up.railway.app/health) HTTP 200；`status=ok`、`mode=mock`；服务 `speechoptimizer-api` 位于美国西部 |
| 持久化 | Railway 500 MB 持久卷挂载 `/var/lib/speechoptimizer`；当前单实例，不应在迁移前扩容 |
| 同源代理 | Sites `/api/*` 和 `/health` 转发到 Railway API；浏览器不依赖第三方 Cookie |

当前已生成的报告可通过 [浏览器端测试报告](https://speechoptimizer.dengbodev.chatgpt.site/analysis/5c78b3c8-39b1-4a7c-a317-b28cb74a7b5f/report) 查看。真实 Chrome 验收覆盖上传合成 WAV、发起分析、跳转报告和展示语速、填充词、长停顿、有效语音等指标。

### 12.2 源码与平台配置边界

- PR #1 已于 2026-09-04 合并，合并提交为 `1c38e65a6c88212225fea4c70587b33a3f9ffb78`。
- 线上部署所需 4 个文件变更由 `3a912b799ae1e01f5cae6fd5c6d0d87a39c9f82a`（短 SHA `3a912b7`）承载，交接文档回写由 `deeeca308d9fb4fe6bfa52048dc7c78e1ef5b105`（短 SHA `deeeca3`）承载；二者均在 `origin/codex/cicd-bootstrap`，PR #2 是同步到 `main` 的既定路径，合并后 `main` 将包含部署与文档提交。部署文件为：`apps/mvp-server/Dockerfile`、`prototype/.openai/hosting.json`、`prototype/worker/index.js`、`prototype/tests/sites-worker.test.mjs`。
- `API_ORIGIN`、Sites 同源代理目标、Railway `ALLOWED_ORIGINS`/CORS、volume 挂载和域名路由属于平台侧配置。源码只能提供配置入口和契约，不能单独证明平台侧配置已生效；当前事实以平台状态、HTTP 检查和浏览器报告为准。
- 当前部署是 Demo/Mock，不等于完整生产模式。模型 API、支付、邮件、Google OAuth、生产数据库/对象存储、备份与可观测性仍待接入。
- `.github/workflows/release.yml` 中的 Vercel production release 是遗留/备用路径；当前主站使用 Sites，未经 owner 决策不得修改、启用或替换该 Vercel 流程。
