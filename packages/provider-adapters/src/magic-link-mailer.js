import { ProviderError } from "./errors.js";

/** 本地邮件捕获器：保存可断言的消息，但不产生网络连接。 */
export class LocalCaptureMagicLinkSender {
  constructor({ logger = console, clock = () => Date.now() } = {}) {
    this.messages = [];
    this.logger = logger;
    this.clock = clock;
  }

  async sendMagicLink(input) {
    const message = createMessage(input, "local@example.invalid", this.clock());
    this.messages.push(structuredClone(message));
    this.logger.info?.("[mail] Magic Link 已捕获", { messageId: message.id });
    return { messageId: message.id, captured: true };
  }
}

/**
 * SMTP 边界。transport 应由 nodemailer 等基础设施在组合根注入，本包不新增依赖。
 */
export class SmtpMagicLinkSender {
  constructor({ transport, from, logger = console, clock = () => Date.now() }) {
    if (typeof transport?.sendMail !== "function") throw new ProviderError("SMTP_NOT_CONFIGURED", "SMTP transport 需要 sendMail");
    if (!from) throw new ProviderError("SMTP_FROM_REQUIRED", "SMTP 需要发件地址");
    this.transport = transport;
    this.from = from;
    this.logger = logger;
    this.clock = clock;
  }

  async sendMagicLink(input) {
    const message = createMessage(input, this.from, this.clock());
    let result;
    try {
      result = await this.transport.sendMail({ from: message.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    } catch (cause) {
      throw new ProviderError("SMTP_SEND_FAILED", "Magic Link 邮件发送失败", { retryable: true, cause });
    }
    this.logger.info?.("[mail] Magic Link 已提交 SMTP", { messageId: result?.messageId ?? message.id });
    return { messageId: result?.messageId ?? message.id };
  }
}

function createMessage({ email, token, redirectUri }, from, now) {
  if (!email || !token || !redirectUri) throw new ProviderError("INVALID_MAGIC_LINK_MESSAGE", "Magic Link 邮件参数不完整");
  const url = new URL(redirectUri);
  url.searchParams.set("token", token);
  const id = `magic-${now}`;
  return {
    id, from, to: email, subject: "Sign in to SpeechOptimizer",
    text: `Open this one-time sign-in link: ${url}`,
    html: `<p>Open this one-time sign-in link:</p><p><a href="${escapeHtml(String(url))}">Sign in</a></p>`,
  };
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
