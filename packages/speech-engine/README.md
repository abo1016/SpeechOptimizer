# SpeechOptimizer Speech Engine

MVP 语音分析的独立零依赖 ESM 包。固定英语 fixture 用于离线、可重复的测试；真实 STT 和结构化反馈服务只能通过服务端适配器注入。

公共接口和配置字段见 [CONTRACT.md](./CONTRACT.md)。

```bash
npm run check
npm test
npm run build
```

脚本说明：`check` 检查包内全部 JavaScript 语法；`test` 执行确定性和错误路径测试；`build` 生成 `dist`，不会发起网络请求。
