# SpeechOptimizer MVP 上线与部署准备

> 状态：本地部署脚手架已落盘并通过当前工作树双轮质量门禁；Supabase 与 Railway 基础资源已经创建，但 GitHub workflow 尚未推送，Vercel Project、生产密钥、首次 deployment 和 Cloudflare DNS 仍未完成。远端状态以第 11 节为准。

## 1. 推荐部署拓扑

当前代码并不适合把全部组件部署到同一个 Serverless 平台。前端是无状态 Vite SPA，可以直接放在 Vercel；`mvp-server` 仍使用本地 JSON 快照、本地音频目录和 `ffprobe`，因此现阶段应运行在支持长期 Node 进程、Docker 与持久卷的平台。

推荐第一版拓扑：

| 层 | 推荐服务 | 当前用途 | 是否可立即接入 |
| --- | --- | --- | --- |
| DNS / TLS / WAF | Cloudflare | 域名解析、HTTPS、WAF、DDoS、API 入口保护 | 是，账号与域名准备好即可 |
| Web 前端 | Vercel | `prototype/` Vite SPA、Preview/Production Deployment | 是，仓库已准备 `vercel.json` 与 GitHub Actions |
| API Runtime | Railway（首选）或同类 Docker 平台 | 运行 Node 24、`ffprobe`、健康检查、单实例持久卷 | 是，仓库已准备 Dockerfile；需要生产环境变量 |
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

当前临时域名方案（后续更换正式域名时整体替换）：

```text
app.bo-pop.top  -> Vercel 前端
api.bo-pop.top  -> Railway API（Cloudflare Proxy）
```

Cloudflare 建议：

- `api.example.com` 使用 Proxied 记录，让 API 经过 Cloudflare WAF / DDoS 防护；
- Vercel 自定义域名按 Vercel 域名验证要求创建 DNS 记录；验证用 TXT/CNAME 不要代理；
- Production API 的 `ALLOWED_ORIGINS` 只允许真实前端 Origin，不保留 localhost；
- Webhook 路径不要缓存；对普通 API 默认禁用 CDN 缓存，静态前端由 Vercel 自己负责缓存。

## 3. GitHub Actions 已初始化的工作流

### CI：`.github/workflows/ci.yml`

PR、`main` push 和手动运行都会执行：

1. Node.js 24 + pnpm 11.25.0；
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

Release 还会执行以下安全门禁：

- 自动触发只接受成功的 `CI` 对 `main` 的 push，人工触发也只接受 `main`；
- checkout 固定到已经通过 CI 的精确 commit SHA，并重新运行常规与 `TZ=UTC` 双轮完整门禁；
- 所有 checkout 都关闭凭证持久化，GHCR 的 `packages: write` 只授予镜像发布 job；
- Vercel CLI 固定为 `59.11.2`，三个 Vercel Secret 缺少任意一个都会显式失败且不输出值；
- 生产 release 使用单一 concurrency group，避免并行发布交叉覆盖。

## 4. GitHub / Vercel 初始化参数

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

`VITE_` 变量会进入浏览器 bundle，只允许放公开配置，禁止放 API key、数据库密码或其他服务端秘密。

建议配置顺序：

1. 先保持 `PRODUCTION_DEPLOY_ENABLED` 不存在或为 `false`；
2. 建立 Vercel project 并完成 Preview 部署；
3. 设置 `VITE_API_BASE_URL`；
4. API Staging 健康后再启用生产 release；
5. 最后把 GitHub CI 设置成 Vercel Production Deployment Check / GitHub required check。

## 5. API Docker / Railway 初始化

Docker build context 必须使用仓库根目录：

```bash
docker build -f apps/mvp-server/Dockerfile -t speechoptimizer-mvp-server:local .
```

Railway 目前建议通过 Dashboard 创建新服务并连接 GitHub 仓库或镜像。当前仓库的推荐设置：

```text
Dockerfile path: apps/mvp-server/Dockerfile
Healthcheck path: /health
Persistent volume mount: /var/lib/speechoptimizer
Replicas: 1
```

不要在仍使用本地 JSON snapshot 的阶段把 API 扩为多个 replica。多个实例会各自持有不同本地状态，并且 Webhook 单进程 claim 不具备跨实例互斥。

Railway 会注入 `PORT`；Docker 镜像已经将 `HOST=0.0.0.0`，应用会读取平台注入的端口。

## 6. API Production 环境变量

以 `apps/mvp-server/.env.example` 为完整键列表。生产环境至少需要分为四组管理：

### 应用安全

```text
NODE_ENV=production
HOST=0.0.0.0
MVP_DATA_DIRECTORY=/var/lib/speechoptimizer
ALLOWED_ORIGINS=https://app.bo-pop.top
COOKIE_SECRET=<至少 24 字符的高熵随机值>
```

### OpenAI

```text
OPENAI_API_KEY
OPENAI_STT_URL
OPENAI_FEEDBACK_URL
OPENAI_FEEDBACK_MODEL
```

### Auth / 邮件

```text
GOOGLE_AUTHORIZE_URL
GOOGLE_TOKEN_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MAGIC_LINK_FROM
```

注意：当前 `smtpFrom` 配置已经存在，但真实 SMTP transport 仍需要完成 provider 接线；不能仅靠设置 `MAGIC_LINK_FROM` 就认为真实邮件已上线。

### Waffo

支付上线前继续遵守 `.waffo/integration-manifest.json` 和 canonical handoff。未决人工 decision、Sandbox/Go-Live 未完成时，不得把占位符替换成 AI 猜测值。

当前 `NODE_ENV=production` 会对 Waffo 配置 fail closed；若首版明确要以“支付完全关闭”方式上线，应单独实现并验证 `PAYMENTS_ENABLED=false` 产品能力，而不是把 Sandbox/假密钥当生产配置。

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
- Vercel production 项目和真实域名；
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

## 10. 当前仍未执行或未完成的远程动作

截至 2026-09-04 18:43，Railway Project/Service/generated domain 和 `/var/lib/speechoptimizer` 持久卷、Supabase Project 已经创建；以下远程动作仍未完成：

- 创建 Cloudflare zone / DNS record；
- 创建 Vercel Project 或写入 Vercel secrets；
- 为现有 Railway `speechoptimizer-api` 连接已验证 Git source，并触发首次 deployment；
- 配置 Railway staging/production 真实 variables/secrets，并完成外网 `/health` smoke；
- 创建 Supabase schema / private bucket 并接入运行时 adapter；
- 创建 GitHub Repository Secrets / Variables；
- push 当前工作树或触发 release；
- 创建真实订单或支付。

这些动作需要对应账号、组织/项目选择、域名和密钥，准备好后再进入远程初始化阶段。

## 11. 2026-09-04 插件连接与远程初始化状态

本轮已实际通过已连接插件读取云端状态，而不是只停留在文档规划：

| 服务 | 插件状态 | 已确认事实 | 当前动作边界 |
| --- | --- | --- | --- |
| Cloudflare | 连接存在；历史读取可见 Zone，但本次更窄的 DNS 读取请求被插件安全策略拦截 | owner 已选择临时使用 `bo-pop.top`；预留 `app.bo-pop.top` / `api.bo-pop.top` | 先取得可执行的 DNS read/write 工具或补齐授权，再在 Vercel/Railway 目标地址确定后创建记录，避免写入无目标占位记录 |
| Supabase | 已连接，可管理项目 | 已在 organization `rwzohujdebahkmqfxloy` 创建独立 `SpeechOptimizer`，project ref `qnmxxvnypmfzwclyyfhr`，region `us-west-1`，状态 `ACTIVE_HEALTHY`；插件返回创建成本 `$0/month` | 当前只完成项目资源创建；业务 Postgres schema/adapter 与对象存储 adapter 尚未实现，因此不把“项目已创建”表述为生产持久化已切换 |
| Vercel | 已连接，但当前无可列出的 Team/Project 上下文 | 2026-09-04 19:12 再次确认 `list_teams` 返回空；直接调用当前项目部署的历史结果为 `INVALID_ARGUMENT` | 插件没有暴露“创建/链接 Project”动作；需要先在 Vercel 创建/链接 `prototype` 项目，之后才能继续用插件管理 deployment |
| GitHub | `gh` 已认证，具备 `repo` / `workflow` scope | 已推送 `codex/cicd-bootstrap` 并创建 PR #1；Actions run `33867873645` 的 `MVP quality gate` 于 2026-09-04 19:26 真实通过。Repository Secret/Variable/ruleset 仍为空，`main` 未保护 | 在合并前确认是否启用 required check；Vercel secrets 和 `PRODUCTION_DEPLOY_ENABLED` 必须在部署目标就绪后配置，不能写占位值。当前不得启用生产 Release |
| Railway | connector 已暴露，且本机 `railway 5.49.1` 已完成 OAuth 登录并链接现有资源 | 已存在独立 `SpeechOptimizer` project、`production`、`speechoptimizer-api`、generated domain；500 MB volume 已 Ready 并挂载 `/var/lib/speechoptimizer`。2026-09-04 19:12 插件再次确认 `latestDeployment: null` | `origin/main` 仍缺当前 Dockerfile/CI/Release 等部署脚手架，禁止连接旧 remote source。先形成并 push 可审计 Git checkpoint，再把**现有** Service 连接到对应 branch，配置真实 secrets 后首次部署；不创建第二个同用途 Service |

### 11.1 下一次远程初始化所需的最少人工确认

owner 已完成本阶段两个关键选择：Supabase 使用当前 organization 下的独立 `SpeechOptimizer` project；临时域名使用 `bo-pop.top`，并采用 `app.bo-pop.top` / `api.bo-pop.top` 分离 Web 与 API。

下一步执行顺序：

1. Railway project/service/domain/volume 已完成；下一步先把当前已验证 source 形成明确 Git checkpoint 并 push，再将现有 `speechoptimizer-api` 连接到该 branch、配置真实变量并触发首次 deployment；
2. 在 Vercel 建立/链接 Root Directory=`prototype` 的 Project，并取得前端 deployment target；
3. Cloudflare 获得可执行 DNS read/write 后再创建 `app.bo-pop.top` / `api.bo-pop.top` 记录，不提前写无目标 DNS；
4. 将生产 CORS、OAuth redirect、Waffo webhook/redirect 与 Vercel `VITE_API_BASE_URL` 统一切到上述临时域名；
5. Supabase 后续先实现并验证 Postgres/S3 adapter，再把运行时从本地 JSON/对象目录迁移到新项目，不能仅凭 project 已创建就移除 Railway persistent volume。
