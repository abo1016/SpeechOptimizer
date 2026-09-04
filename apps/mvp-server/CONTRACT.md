# MVP Server HTTP Contract

更新日期：2026-09-01

## 1. 服务定位

`apps/mvp-server` 是 SpeechOptimizer MVP 的 HTTP 组合层，只负责编排现有领域模块、身份 Cookie、异步任务、本地开发 Provider、请求限制和安全响应。任务状态、语音指标、认证、权益及支付规则继续由各自领域模块负责。

- 开发模式仅使用明确标记的本地 Mock Provider，不宣称真实 Google、STT、LLM 或 Waffo 联调完成。
- 生产模式缺少外部服务配置时拒绝启动，禁止静默回退到 Mock。
- JSON 请求默认上限 64 KiB，音频上传默认上限 25 MiB，所有业务错误响应包含稳定 `code`。
- 浏览器身份保存在 `so_session` 或签名 `so_anonymous` Cookie；客户端不能指定 owner。

## 2. 通用约定

- API 前缀为 `/api/v1`，健康检查为 `GET /health`。
- JSON 响应固定为 `{ "data": ... }`；错误响应为 `{ "error": { "code", "message", "details?" } }`。
- 写请求支持同源或配置允许列表中的 CORS Origin；预检使用 `OPTIONS`。
- 登录接口成功后设置 `HttpOnly` Cookie；`POST /api/v1/auth/logout` 撤销当前会话并清理 Cookie。
- 音频上传使用 `application/octet-stream`，服务端自行检查媒体类型和真实时长。
- 创建分析必须携带 `Idempotency-Key`；成功返回 `202`，任务由本地 runner 异步推进。

## 3. 认证与账户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/anonymous/session` | 创建或恢复签名匿名会话 |
| `POST` | `/api/v1/auth/magic-link` | 请求 Magic Link；开发模式可返回 `previewToken` |
| `POST` | `/api/v1/auth/magic-link/consume` | 消费一次性 token 并建立登录 Cookie |
| `GET` | `/api/v1/auth/google/start?redirectUri=` | 返回注入式 Google OAuth 授权地址 |
| `POST` | `/api/v1/auth/google/complete` | 消费 `state/code` 并建立登录 Cookie |
| `GET` | `/api/v1/session` | 返回当前匿名或账户身份及账户概要 |
| `POST` | `/api/v1/auth/logout` | 撤销账户会话并清理 Cookie |
| `DELETE` | `/api/v1/account` | 删除当前账户的分析数据并禁用账户 |

## 4. 分析、报告与隐私

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/analyses` | 创建任务；Body `{ retainAudio? }` |
| `PUT` | `/api/v1/analyses/:id/audio` | 上传原始音频并触发异步 runner |
| `GET` | `/api/v1/analyses/:id` | 查询可恢复任务状态 |
| `POST` | `/api/v1/analyses/:id/cancel` | 取消未完成任务并返还预扣权益 |
| `POST` | `/api/v1/analyses/:id/retry` | 重试保留音频的失败任务 |
| `DELETE` | `/api/v1/analyses/:id` | 删除任务、报告与音频 |
| `GET` | `/api/v1/analyses` | 当前身份的历史列表，支持 `status/limit/cursor` |
| `GET` | `/api/v1/analyses/:id/report` | 读取已完成报告 |
| `POST` | `/api/v1/comparisons` | 比较两个属于当前身份的已完成任务 |
| `GET` | `/api/v1/privacy` | 返回当前音频保留偏好 |
| `PUT` | `/api/v1/privacy` | 更新默认保留偏好；匿名身份始终为 `false` |

任务状态：`created -> uploaded -> transcribing -> analyzing -> completed`，可进入 `failed` 或 `cancelled`。服务刷新后从同一本地目录恢复任务；启动时只重新排队 `uploaded` 任务，处理中断的任务由恢复逻辑转为可重试失败状态。

## 5. 套餐、权益与支付

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/plans` | 返回服务端可信产品目录 |
| `GET` | `/api/v1/billing/balance` | 返回分钟/报告余额 |
| `GET` | `/api/v1/billing/ledger` | 返回当前账户权益流水 |
| `POST` | `/api/v1/billing/orders` | 按 `productCode` 创建订单，金额由服务端目录确定 |
| `GET` | `/api/v1/billing/orders` | 返回当前账户订单 |
| `GET` | `/api/v1/billing/subscriptions` | 返回当前账户订阅状态 |
| `POST` | `/api/v1/billing/subscriptions/:id/cancel` | 请求取消订阅 |
| `POST` | `/api/v1/billing/orders/:id/refund` | 请求订单退款 |
| `POST` | `/api/v1/webhooks/waffo` | 使用原始请求体验签并处理幂等事件 |

开发模式订单返回 `localhost` Mock Checkout；Webhook 必须携带 `x-waffo-signature`，签名算法和事件版本由服务端适配器校验。

## 6. 管理接口

以下接口全部要求当前账户角色为 `admin`，不能只依赖前端隐藏操作。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/users/:id` | 查询用户、任务、订阅和权益流水 |
| `POST` | `/api/v1/admin/users/:id/disable` | 禁用账户并撤销会话 |
| `POST` | `/api/v1/admin/users/:id/return-minutes` | 人工返还分钟并记录审计 |
| `POST` | `/api/v1/admin/analyses/:id/retry` | 对失败任务执行受审计重试 |
| `GET` | `/api/v1/admin/observability` | 查询 Webhook、失败任务和管理员审计状态 |

## 7. 关键错误码

- 身份：`AUTHENTICATION_REQUIRED`、`INVALID_SESSION`、`FORBIDDEN`、`ACCOUNT_DISABLED`。
- 请求：`INVALID_JSON`、`PAYLOAD_TOO_LARGE`、`UNSUPPORTED_MEDIA_TYPE`、`MISSING_IDEMPOTENCY_KEY`。
- 分析：沿用核心平台的 `ANALYSIS_NOT_FOUND`、`INVALID_STATE_TRANSITION`、`ANALYSIS_NOT_RETRYABLE`、音频校验错误码。
- 权益：`ANONYMOUS_TRIAL_USED`、`ANONYMOUS_DURATION_EXCEEDED`、`INSUFFICIENT_ENTITLEMENT`。
- 支付：沿用账户计费模块的订单、订阅、Webhook 稳定错误码。
- 未知异常只返回 `INTERNAL_ERROR`，日志使用请求 ID 关联，不记录音频、完整转写、Cookie、token 或密钥。
