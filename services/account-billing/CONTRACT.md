# Account Billing Contract

## 定位

本包提供 SpeechOptimizer MVP 的账户、认证、角色权限、通用权益、订单、订阅、Webhook 和最小管理操作。它是纯领域层，不提供 HTTP 路由、数据库迁移、Cookie、真实邮件或真实支付网络实现。

截至 2026-09-01，仓库没有 Waffo Sandbox 凭证、官方事件 Schema 和可核验的订阅/退款能力说明。因此真实 Sandbox 联调是明确阻塞项；本包只接受注入式 gateway，测试使用 `MockWaffoGateway`，不得把本地结果表述为真实支付已通过。

## 配置约束

- `exposeDevTokens`：默认必须为 `false`。仅本地邮件捕获环境可设为 `true`，用于读取 Magic Link 测试 token；生产开启会泄露登录凭证。
- `allowedRedirectOrigins`：认证回跳地址允许列表，默认空列表。必须使用完整 origin 配置，防止 Magic Link 和 OAuth 开放重定向。
- `sessionTtlMs`：会话有效期，默认 30 天。HTTP 层仍需使用 `HttpOnly`、`Secure`、合适的 `SameSite` Cookie。
- `magicLinkTtlMs`：Magic Link 有效期，默认 15 分钟。token 仅存 SHA-256 摘要且只能使用一次。
- `oauthProvider`：Google OAuth 可注入边界，必须实现 `createAuthorizationUrl` 与 `exchangeCode`。本地 mock URL 明确指向 localhost，不模拟 Google 品牌页面。
- `gateway`：Waffo 可注入边界，必须实现 `createOrder`、`cancelSubscription`、`refundOrder`。领域服务不读取或记录支付密钥。
- `clock` 与 `id`：测试可注入；生产必须使用可信服务端时钟和不可预测、全局唯一 ID。

## 认证与授权

- `requestMagicLink({ email, redirectUri })`：统一返回 accepted，避免泄露账户是否存在。
- `consumeMagicLink({ token })`：校验摘要、有效期和单次使用，创建或复用账户并签发会话。
- `beginGoogleOAuth({ redirectUri })` / `completeGoogleOAuth({ state, code })`：使用一次性随机 state，要求 provider 返回已验证邮箱。
- `authenticate(token)`：拒绝过期会话和 `disabled` 账户。
- `authorize(token, roles)`：角色为 `user` 或 `admin`；`disabled` 是账户状态，不是可授权角色。
- `revokeSession(token)`：主动注销当前会话；账户禁用仍需由持久化适配器批量撤销既有会话。
- `useAnonymousTrial({ anonymousId, durationSeconds })`：每个稳定匿名标识一次，时长不超过 60 秒。生产必须在外层增加签名设备标识、限流和滥用检测。

## 权益规则

- 权益单位为通用 `minute` 或 `report`，余额来自未过期 grant 的 remaining 汇总。
- `grant` 以 `source + sourceId + unit` 保持幂等。
- `reserve` 在任务提交时按最早过期批次预扣；相同 `userId + referenceId` 幂等。
- `confirm` 在任务成功结算；`release` 在失败或取消时返还原批次。
- `expire` 清零过期批次并追加流水；`adjust` 用于人工增减；`revokeSource` 用于退款撤销尚未使用部分。
- 流水只追加，类型包括 `grant`、`reserve`、`confirm`、`release`、`expire`、`manual_adjustment`、`refund`。
- 已消费权益退款不会形成负余额；当前只撤销对应订单尚未使用部分，超出部分的现金退款/追偿必须由最终 Waffo 政策确认。

## 暂定产品映射

- `free_monthly`：5 分钟。
- `pro_monthly`：每周期 60 分钟。
- `pro_yearly`：当前按每个权益周期发 60 分钟，年度扣款不等于一次发 720 分钟。
- `minutes_30` / `minutes_100`：分别为 30 / 100 分钟充值包。
- `deep_report`：1 次深度报告。

价格仍由上层产品目录管理，领域层只接受正整数最小货币单位，不信任客户端价格。

## 支付与 Webhook

- 创建订单先保存本地 pending，再调用 gateway；异常记为 failed 并原样抛出。
- 订阅取消先向 gateway 请求，Webhook 确认后变为 canceled；取消不撤销当前周期已发权益。
- 退款请求先变为 `refund_pending`，只有验签成功的 `order.refunded` Webhook 才变为 refunded 并撤销未使用权益。
- 单次订单支付失败进入 `payment_failed`；订阅续费失败进入 `past_due`，不会发放新周期权益，也不会立即撤销已发的当前周期权益。
- 支持事件版本 `1`：`order.paid`、`payment.failed`、`order.refunded`、`subscription.activated`、`subscription.renewed`、`subscription.canceled`。
- `event.id` 唯一保证重复投递幂等；订单按本地订单 ID、订阅权益按 `subscriptionId + periodId/currentPeriodEnd` 防止不同事件 ID 的语义重放；同一订单或订阅按 `occurredAt` 忽略旧事件；事件仅在业务处理成功后记录为 processed。
- 外层 Webhook 适配器必须使用原始请求体验签、限制请求体、校验来源、限流，并在同一数据库事务内落事件与领域变化。

## 管理操作

- `userOverview(userId)` 查询用户、分析任务关联、订阅和权益流水。
- `disableAccount` 禁用账户并追加审计。
- `returnMinutes` 人工返还分钟并追加权益流水与管理审计。
- 调用管理服务前必须通过 `authorize(token, ["admin"])`，适配层不能只依赖前端隐藏按钮。

## 持久化要求

`MemoryStore` 仅用于本地开发和测试。数据库适配器至少需要以下唯一约束和事务边界：

- 用户邮箱规范化后唯一；会话 token 摘要唯一；Magic Link token 摘要唯一。
- Webhook event ID 唯一；订单 ID、订阅 ID、权益 grant ID、hold ID 和流水 ID 唯一。
- grant 幂等键 `(source, source_id, unit)` 唯一；预扣幂等键 `(user_id, reference_id)` 唯一。
- Webhook 事件记录、订单/订阅状态和权益发放必须处于同一事务；预扣和余额校验必须使用行锁或等价原子更新。

## 本地门禁

```bash
npm run check
npm test
npm run build
```
