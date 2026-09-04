/** 本地邮件捕获器只保存邮件，不连接 SMTP，也不会向真实邮箱发送消息。 */
export class LocalMailer {
  constructor() { this.messages = []; }
  async sendMagicLink(message) { this.messages.push(message); }
}

/** Google OAuth 本地替身明确使用 mock URL，避免被误认为真实 Google 登录。 */
export class MockGoogleProvider {
  createAuthorizationUrl({ state, redirectUri }) {
    return `http://localhost/mock-google?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchangeCode({ code }) {
    if (code !== "valid-local-code") throw Object.assign(new Error("本地 OAuth code 无效"), { code: "MOCK_OAUTH_FAILED" });
    return { subject: "mock-google-subject", email: "local@example.com", emailVerified: true };
  }
}

/** Waffo 本地网关只生成模拟结果，不包含网络代码或支付凭证。 */
export class MockWaffoGateway {
  constructor() { this.calls = []; }

  async createOrder(input) {
    this.calls.push({ operation: "createOrder", input });
    return {
      acquiringOrderId: `mock-${input.requestId}`,
      checkoutUrl: `http://localhost/mock-checkout/${input.requestId}`,
    };
  }

  async createSubscription(input) {
    this.calls.push({ operation: "createSubscription", input });
    return {
      externalSubscriptionId: `mock-subscription-${input.requestId}`,
      checkoutUrl: `http://localhost/mock-checkout/${input.requestId}`,
    };
  }

  async inquiryOrder(input) {
    this.calls.push({ operation: "inquiryOrder", input });
    return { status: "PENDING" };
  }

  async inquirySubscription(input) {
    this.calls.push({ operation: "inquirySubscription", input });
    return { status: "PENDING" };
  }

  async cancelSubscription(input) {
    this.calls.push({ operation: "cancelSubscription", input });
    return { externalSubscriptionId: input.externalSubscriptionId, status: "canceling" };
  }

  async refundOrder(input) {
    this.calls.push({ operation: "refundOrder", input });
    return { acquiringRefundOrderId: `mock-refund-${input.refundRequestId}` };
  }

  async inquiryRefund(input) {
    this.calls.push({ operation: "inquiryRefund", input });
    return { status: "REFUND_IN_PROGRESS" };
  }
}
