import test from "node:test";
import assert from "node:assert/strict";
import { LocalCaptureMagicLinkSender, ResendMagicLinkSender, SmtpMagicLinkSender,
  readProviderEnvironment } from "../src/index.js";

test("本地邮件捕获器保存 Magic Link 且不访问网络", async () => {
  const sender = new LocalCaptureMagicLinkSender({ clock: () => 100, logger: { info() {} } });
  const result = await sender.sendMagicLink({ email: "user@example.com", token: "secret-token", redirectUri: "http://localhost/auth" });
  assert.equal(result.captured, true);
  assert.match(sender.messages[0].text, /token=secret-token/);
});

test("SMTP sender 只调用注入 transport", async () => {
  let mail;
  const sender = new SmtpMagicLinkSender({
    from: "no-reply@example.com", logger: { info() {} },
    transport: { async sendMail(value) { mail = value; return { messageId: "smtp-1" }; } },
  });
  const result = await sender.sendMagicLink({ email: "user@example.com", token: "token", redirectUri: "https://app.example/auth" });
  assert.equal(mail.to, "user@example.com");
  assert.equal(result.messageId, "smtp-1");
});

test("Resend sender 使用服务端 Bearer Key 投递 Magic Link", async () => {
  let request;
  const sender = new ResendMagicLinkSender({
    apiKey: "resend-secret", from: "SpeechOptimizer <noreply@example.com>", logger: { info() {} },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({ id: "resend-1" });
    },
  });
  const result = await sender.sendMagicLink({ email: "user@example.com", token: "magic-token",
    redirectUri: "https://app.example.com/auth/callback" });
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers.authorization, "Bearer resend-secret");
  assert.deepEqual(body.to, ["user@example.com"]);
  assert.match(body.text, /token=magic-token/);
  assert.equal(result.messageId, "resend-1");
});

test("环境配置使用稳定默认值且不改写密钥", () => {
  const config = readProviderEnvironment({ OPENAI_API_KEY: "openai-secret", WAFFO_PRIVATE_KEY: "waffo-secret" });
  assert.equal(config.openAiApiKey, "openai-secret");
  assert.equal(config.waffoPrivateKey, "waffo-secret");
  assert.equal(config.smtpPort, 1025);
});
