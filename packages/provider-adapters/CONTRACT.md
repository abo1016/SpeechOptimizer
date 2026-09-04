# Provider Adapters Contract

更新日期：2026-09-01

## 范围

`@speechoptimizer/provider-adapters` 提供服务端 OpenAI、系统媒体探测、Waffo 与 Magic Link 邮件边界。公共入口为 `src/index.js`。包内测试全部使用注入 transport，不发送真实网络请求，不读取真实密钥，也不创建订单。

## OpenAI STT

- `createOpenAiSttProvider` 实现 `speech-engine` 的 `{ name, transcribe }` 端口。
- 根据 OpenAI 官方当前文档，逐词时间戳必须使用 `whisper-1`、`verbose_json` 与 `timestamp_granularities[]=word`。
- 输入为 `Buffer` 或 `{ bytes, mime, filename }`；输出包含英语语言标签、时长、逐词时间戳、置信度、成本与处理耗时。
- 官方逐词对象不提供 word confidence。适配器优先用同一 segment 的 `exp(avg_logprob)` 生成保守近似；segment 缺失时默认置信度为 `0`，可显式配置 `missingConfidence`。
- `pricePerMinuteUsd` 必须由部署方按当前价格注入；默认 `0` 表示成本价格尚未配置，避免硬编码易变价格。
- OpenAI 官方资料：https://developers.openai.com/api/docs/guides/speech-to-text

## OpenAI 结构化反馈

- `createOpenAiFeedbackProvider` 实现 `{ name, generate }` 端口。
- 使用 Responses API 的 `text.format` 严格 JSON Schema，最多返回三条反馈。
- API Key 只进入 Authorization 请求头；日志只记录模型、数量、重试次数等安全元数据。
- token 单价由部署方注入，未配置时估算成本为 `0`。
- OpenAI 官方资料：https://developers.openai.com/api/docs/guides/structured-outputs

## 媒体探测

- `createFfprobeMediaAdapter().inspect(bytes)` 返回 `{ mime, extension, durationMs }`。
- `durationResolver({ bytes, mime })` 可直接注入 `core-platform`。
- MIME 只根据文件签名识别 MP3、M4A、WAV、WebM，不信任上传 Content-Type。
- ffprobe 还必须确认容器至少包含一个 audio stream，防止把纯视频 MP4 误当 M4A 音频。
- 生产模式严格要求真实 `ffprobe` 探测；系统缺少 ffprobe 时返回 `MEDIA_PROBE_UNAVAILABLE`，不得降级。
- 开发/测试模式在 macOS 且 ffprobe 不可执行时受控 fallback 到 `afinfo`；命令失败、输出非法、时长非法分别使用稳定错误码。
- 临时文件位于系统临时目录，成功或失败都会清理；命令使用 `execFile`，不经过 shell。

## Waffo

- 适配官方 `@waffo/waffo-node` 3.0.1 的 `order()`、`subscription()` 与 `refund()` resource；本包不新增 SDK 依赖，client 和 UnknownStatus predicate 由组合根注入。
- 对外只暴露 provider-agnostic port：`createOrder`、`inquiryOrder`、`refundOrder`、`createSubscription`、`inquirySubscription`、`cancelSubscription`、`inquiryRefund`。
- create 结果字段冻结为 `{ acquiringOrderId, checkoutUrl }` 与 `{ externalSubscriptionId, checkoutUrl }`；退款结果只返回可用的 `acquiringRefundOrderId`；订阅取消和 inquiry 只返回归一化 ID、`status` 与可用 checkout URL。
- 订单使用 SDK 的 `paymentRequestId/orderCurrency/orderAmount`，订阅使用 `subscriptionRequest/currency/amount`，退款使用 `refundRequestId/acquiringOrderId/refundAmount/refundReason`；不会向退款接口发送不存在的 `currency` 字段。
- MVP 仅接受 USD 正整数最小货币单位，全部金额通过单一 helper 转为 SDK decimal string；其他币种、零值、负值、小数和非安全整数均稳定返回错误。
- SDK `ApiResponse` 必须先检查 `isSuccess()`，再读取 `getData()`；非成功响应统一为 `WAFFO_API_ERROR`，成功但缺少必要 ID/action 的响应统一为 `WAFFO_INVALID_RESPONSE`。
- Hosted Checkout 只从 `orderAction/subscriptionAction` 的 JSON（也接受已解析对象）读取 `webUrl`；缺失或不可解析时 fail closed。
- order、subscription、refund、cancel 的 UnknownStatus 均只使用原写请求的同一 key inquiry；同键查询仍失败时统一返回可重试的 `WAFFO_STATUS_UNCONFIRMED`，绝不二次 write。
- `createUnavailableWaffoGateway` 覆盖全部新 port，缺少 SDK、凭证或 Sandbox 时所有操作均明确失败。
- 日志只记录 operation、非敏感 request ID、商品代码和外部 ID，不记录 Waffo API key、private key、签名或完整 payload。
- Waffo API 字段依据包内 `waffo-integrate` skill 的 OpenAPI 摘要及已安装 SDK 3.0.1 类型/README；真实 Sandbox/生产网络不在本包测试范围内。

## Magic Link 邮件

- `LocalCaptureMagicLinkSender` 只在内存捕获邮件，供本地开发与测试读取。
- `SmtpMagicLinkSender` 依赖注入的 `transport.sendMail`，可由应用层接入 nodemailer 或其他 SMTP 客户端。
- token 只存在邮件正文，不出现在日志；日志只记录 message ID。

## 配置与错误

- `.env.example` 只包含空秘密与安全默认值。
- `readProviderEnvironment` 不记录配置。
- 所有外部错误统一为 `ProviderError`，通过稳定 `code` 和 `retryable` 供业务层决策。
- OpenAI 对网络错误、408、409、429 和 5xx 做有限退避重试；中止信号会立即停止后续请求。
- STT 与反馈每次请求分别默认限制为 30 秒与 10 秒；部署方可通过 `requestTimeoutMs` 收紧，超时返回可重试的稳定错误码。

## 本地门禁

```bash
npm run check
npm test
npm run build
```
