# SDK Integrations Spike

该目录提供 SpeechOptimizer 外接服务边界的本地验证实现。`WaffoClient` 通过注入 `transport` 隔离官方 SDK/HTTP 实现，测试全部使用 `fixtures/mock-transport.js`，不会创建真实订单。

运行门禁：

```bash
pnpm run check
pnpm run test
pnpm run build
```

Webhook 去重要求 `seenEvents` 提供同步、原子语义：默认 `Set` 在单进程内先占用事件键，业务成功后保留；JSON 无效或业务 sink 失败会释放事件键，确保失败可重试。多实例部署应注入具备原子 `claim(eventId)` 与 `release(eventId)` 的持久化实现。

支付金额必须是正整数最小货币单位，缺少 Waffo transport 或必要退款契约字段时会明确失败，不伪造成功；日志只记录 request ID 和业务元数据，不记录密钥或完整请求体。

订阅模式仍需业务负责人确认；当前 `subscriptionPreview` 使用 `WAFFO_DECISION_REQUIRED` 明确阻断，避免自行选择 payment-first 或 service-first。
