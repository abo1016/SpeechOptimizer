/**
 * 从环境读取 provider 配置。此函数不打印配置，防止密钥出现在日志或错误追踪中。
 */
export function readProviderEnvironment(env = process.env) {
  return Object.freeze({
    // mode：媒体探测等 provider 能力据此区分开发降级与生产严格策略。
    mode: env.NODE_ENV ?? "development",
    // openAiApiKey：OpenAI 服务端密钥；缺失时对应 provider 构造函数会明确失败。
    openAiApiKey: env.OPENAI_API_KEY,
    // openAiFeedbackModel：结构化反馈模型，可按部署环境独立切换。
    openAiFeedbackModel: env.OPENAI_FEEDBACK_MODEL ?? "gpt-4o-mini",
    // waffoMerchantId：Waffo Merchant ID，不得误用 Store ID。
    waffoMerchantId: env.WAFFO_MERCHANT_ID,
    // waffoPrivateKey：Waffo RSA 私钥，仅供组合根创建官方 SDK 客户端。
    waffoPrivateKey: env.WAFFO_PRIVATE_KEY,
    // smtpHost/smtpPort：本地捕获或生产 SMTP transport 的连接参数。
    smtpHost: env.SMTP_HOST ?? "localhost",
    smtpPort: Number(env.SMTP_PORT ?? 1025),
    // magicLinkFrom：Magic Link 邮件的已验证发件地址。
    magicLinkFrom: env.MAGIC_LINK_FROM ?? "no-reply@example.invalid",
  });
}
