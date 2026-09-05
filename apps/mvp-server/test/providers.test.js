import assert from "node:assert/strict";
import { RsaUtils, WaffoUnknownStatusError } from "@waffo/waffo-node";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createProviders, createWaffoClient, defaultIsUnknownStatusError } from "../src/providers.js";

test("生产组合根保留官方 client 注入并传递 UnknownStatus predicate", () => {
  const config = productionConfig();
  const injectedClient = { webhook() {} };
  const injectedGateway = {};
  const predicate = () => true;
  const providers = createProviders(config, silentLogger(), fetch, {
    waffoClient: injectedClient, waffoGateway: injectedGateway,
    isUnknownStatusError: predicate,
  });
  assert.equal(providers.waffoClient, injectedClient);
  assert.equal(providers.waffoGateway, injectedGateway);
  assert.equal(providers.isUnknownStatusError, predicate);
  assert.equal(createWaffoClient(config, silentLogger(), injectedClient), injectedClient);
});

test("官方 UnknownStatus 只由 SDK 异常判定，SDK logger 不泄露密钥", async () => {
  const keys = RsaUtils.generateKeyPair();
  const secretValues = ["api-key-secret", keys.privateKey, keys.publicKey];
  const logs = [];
  const logger = { info(...args) { logs.push(args); }, warn(...args) { logs.push(args); }, error(...args) { logs.push(args); } };
  const config = productionConfig({ waffoApiKey: secretValues[0], waffoPrivateKey: keys.privateKey, waffoPublicKey: keys.publicKey });
  const client = createWaffoClient(config, logger);
  await client.webhook().handleWebhook("{}", undefined);
  assert.equal(defaultIsUnknownStatusError(new WaffoUnknownStatusError("S0001", "network")), true);
  assert.equal(defaultIsUnknownStatusError(new Error("network")), false);
  assert.equal(secretValues.some((secret) => JSON.stringify(logs).includes(secret)), false);
});

test("生产 Google OAuth 使用标准 token exchange 并读取已验证 userinfo", async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url === "https://accounts.example.com/token") {
      return Response.json({ access_token: "access-token", token_type: "Bearer" });
    }
    if (url === "https://accounts.example.com/userinfo") {
      return Response.json({ sub: "google-subject", email: "user@example.com", email_verified: true });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const config = productionConfig({ googleUserinfoUrl: "https://accounts.example.com/userinfo" });
  const providers = createProviders(config, silentLogger(), fetchImpl, {
    waffoClient: { webhook() {} }, waffoGateway: {},
  });

  const authorizationUrl = new URL(providers.oauthProvider.createAuthorizationUrl({
    state: "state-value", redirectUri: "https://app.example.com/auth/callback",
  }));
  assert.equal(authorizationUrl.searchParams.get("state"), "state-value");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "https://app.example.com/auth/callback");

  const profile = await providers.oauthProvider.exchangeCode({
    code: "oauth-code", redirectUri: "https://app.example.com/auth/callback",
  });
  assert.deepEqual(profile, { email: "user@example.com", emailVerified: true, subject: "google-subject" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(requests[0].init.body.get("grant_type"), "authorization_code");
  assert.equal(requests[0].init.body.get("client_secret"), "google-secret");
  assert.equal(requests[1].init.headers.authorization, "Bearer access-token");
});

function productionConfig(overrides = {}) {
  const keys = overrides.waffoPrivateKey && overrides.waffoPublicKey
    ? { privateKey: overrides.waffoPrivateKey, publicKey: overrides.waffoPublicKey }
    : RsaUtils.generateKeyPair();
  return loadConfig({}, {
    mode: "production", cookieSecret: "cookie-secret-01234567890123456789", allowedOrigins: ["https://app.example.com"],
    openAiApiKey: "openai-key", smtpFrom: "noreply@example.com", resendApiKey: "resend-key",
    googleAuthorizeUrl: "https://accounts.example.com/authorize", googleTokenUrl: "https://accounts.example.com/token",
    googleClientId: "google-client", googleClientSecret: "google-secret",
    waffoApiKey: "waffo-key", waffoPrivateKey: keys.privateKey, waffoPublicKey: keys.publicKey,
    waffoEnvironment: "SANDBOX", waffoMerchantId: "merchant-id", waffoNotifyUrl: "https://app.example.com/webhook",
    waffoSuccessRedirectUrl: "https://app.example.com/success", waffoFailedRedirectUrl: "https://app.example.com/failed",
    waffoCancelRedirectUrl: "https://app.example.com/cancel", waffoGoodsName: "SpeechOptimizer",
    waffoGoodsUrl: "https://app.example.com/billing", waffoUserTerminal: "WEB",
    // 仅用于验证 production 组合根已收到“明确值”；不代表真实商户已确认订阅合同决策。
    waffoSubscriptionMode: "TEST_FIXTURE_CONFIRMED_VALUE",
    waffoSubscriptionRetryPolicy: "TEST_FIXTURE_CONFIRMED_VALUE",
    waffoProductIds: { minutes_30: "product-1" }, waffoAllowedSources: ["127.0.0.1"], ...overrides,
  });
}

function silentLogger() { return { info() {}, warn() {}, error() {} }; }
