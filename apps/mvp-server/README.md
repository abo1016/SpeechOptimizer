# SpeechOptimizer MVP Server

该服务把核心任务、语音分析、账户计费和 Waffo SDK 边界组合成一个本地可运行的 HTTP API。完整路由见 `CONTRACT.md`。

## 本地运行

开发模式使用明确标记的本地 Google、STT、反馈、邮件和 Waffo Mock，不会访问外网，也不代表真实供应商联调通过。

```bash
node src/index.js
```

默认监听 `http://127.0.0.1:8787`。浏览器前端默认允许来源为 `http://localhost:5173`。MP3、M4A 和 WebM 上传需要本机安装 `ffprobe`；WAV 由核心平台直接解析。

## 生产配置

复制 `.env.example` 中列出的配置到受控的服务端环境。`NODE_ENV=production` 下缺少 STT、结构化反馈、Google OAuth、邮件、Waffo、Webhook 来源或密钥时，服务会拒绝启动，不会降级到 Mock。Waffo 需要 API key、商户私钥、Waffo 公钥、商户 ID、`SANDBOX/PRODUCTION`、通知 URL、成功/失败/取消回跳 URL、商品名称/URL 及已人工确认的 `userTerminal`。

当前仓库尚无可核验的 Waffo Sandbox 凭证和完整的上线决策证据；本地 SDK 签名测试不能替代真实 Sandbox 联调，也不能据此宣称支付已完成。

## 门禁

```bash
node scripts/check.mjs
node --test test/*.test.js
node scripts/build.mjs
```

`build` 会复制运行所需的仓库内模块并验证构建入口可导入。构建后入口为 `dist/apps/mvp-server/src/index.js`。
