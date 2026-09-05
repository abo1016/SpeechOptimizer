import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  COOKIE_SECRET: "a".repeat(32),
  ALLOWED_ORIGINS: "https://app.example.com",
  OPENAI_API_KEY: "openai-key",
  MAGIC_LINK_FROM: "noreply@example.com",
  RESEND_API_KEY: "resend-key",
  GOOGLE_AUTHORIZE_URL: "https://accounts.example.com/authorize",
  GOOGLE_TOKEN_URL: "https://accounts.example.com/token",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  WAFFO_API_KEY: "waffo-api-key",
  WAFFO_PRIVATE_KEY: "merchant-private-key",
  WAFFO_PUBLIC_KEY: "waffo-public-key",
  WAFFO_ENVIRONMENT: "SANDBOX",
  WAFFO_MERCHANT_ID: "merchant-id",
  WAFFO_NOTIFY_URL: "https://merchant.example.com/api/v1/webhooks/waffo",
  WAFFO_SUCCESS_REDIRECT_URL: "https://app.example.com/billing/success",
  WAFFO_FAILED_REDIRECT_URL: "https://app.example.com/billing/failed",
  WAFFO_CANCEL_REDIRECT_URL: "https://app.example.com/billing/cancel",
  WAFFO_GOODS_NAME: "SpeechOptimizer",
  WAFFO_GOODS_URL: "https://app.example.com/billing",
  WAFFO_USER_TERMINAL: "WEB",
  WAFFO_SUBSCRIPTION_MODE: "payment-first",
  WAFFO_SUBSCRIPTION_RETRY_POLICY: "merchant-confirmed",
  WAFFO_PRODUCT_IDS_JSON: JSON.stringify({ minutes_30: "product-1" }),
  WAFFO_ALLOWED_SOURCES: "10.0.0.1",
};

test("生产模式缺少真实 Provider 配置时拒绝启动", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", COOKIE_SECRET: "a".repeat(24) }), /真实认证缺少配置/);
});

test("生产模式必须显式配置允许来源", () => {
  const env = { ...PRODUCTION_ENV };
  delete env.ALLOWED_ORIGINS;
  assert.throws(() => loadConfig(env), /必须配置 ALLOWED_ORIGINS/);
});

test("生产模式缺少任一 Waffo 关键字段时 fail closed", () => {
  const required = ["WAFFO_API_KEY", "WAFFO_PRIVATE_KEY", "WAFFO_PUBLIC_KEY", "WAFFO_ENVIRONMENT",
    "WAFFO_MERCHANT_ID", "WAFFO_NOTIFY_URL", "WAFFO_SUCCESS_REDIRECT_URL", "WAFFO_FAILED_REDIRECT_URL",
    "WAFFO_CANCEL_REDIRECT_URL", "WAFFO_GOODS_NAME", "WAFFO_GOODS_URL", "WAFFO_USER_TERMINAL"];
  for (const name of required) {
    const env = { ...PRODUCTION_ENV };
    delete env[name];
    assert.throws(() => loadConfig(env), /生产模式缺少配置/, name);
  }
  assert.throws(() => loadConfig({ ...PRODUCTION_ENV,
    WAFFO_USER_TERMINAL: "REPLACE_AFTER_HUMAN_CONFIRMATION" }), /WAFFO_USER_TERMINAL/);
  assert.throws(() => loadConfig({ ...PRODUCTION_ENV,
    WAFFO_SUBSCRIPTION_MODE: "REPLACE_AFTER_HUMAN_CONFIRMATION" }), /WAFFO_DECISION_REQUIRED/);
  assert.throws(() => loadConfig({ ...PRODUCTION_ENV,
    WAFFO_SUBSCRIPTION_RETRY_POLICY: "REPLACE_AFTER_HUMAN_CONFIRMATION" }), /WAFFO_DECISION_REQUIRED/);
});

test("开发模式使用明确的本地配置且限制为正整数", () => {
  const config = loadConfig({}, { rootDirectory: "/tmp/mvp-config-test", port: 9999 });
  assert.equal(config.mode, "development");
  assert.equal(config.authMode, "mock");
  assert.equal(config.secureCookies, false);
  assert.equal(config.waffoEnvironment, "SANDBOX");
  assert.deepEqual(config.allowedOrigins, ["http://localhost:5173", "http://127.0.0.1:5173"]);
  assert.throws(() => loadConfig({}, { port: 0 }), /PORT 必须为正整数/);
});

test("真实认证可在 Mock AI/支付模式独立启用并强制 Secure Cookie", () => {
  const config = loadConfig({
    AUTH_MODE: "production",
    COOKIE_SECRET: "auth-cookie-secret-0123456789012345",
    ALLOWED_ORIGINS: "https://app.example.com",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    RESEND_API_KEY: "resend-key",
    MAGIC_LINK_FROM: "SpeechOptimizer <noreply@example.com>",
  });
  assert.equal(config.mode, "development");
  assert.equal(config.authMode, "production");
  assert.equal(config.secureCookies, true);
  assert.equal(config.googleTokenUrl, "https://oauth2.googleapis.com/token");
});

test("真实认证缺少凭证或继续使用本地 Cookie Secret 时拒绝启动", () => {
  assert.throws(() => loadConfig({ AUTH_MODE: "production" }), /真实认证缺少配置/);
  assert.throws(() => loadConfig({
    AUTH_MODE: "production",
    ALLOWED_ORIGINS: "https://app.example.com",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    RESEND_API_KEY: "resend-key",
    MAGIC_LINK_FROM: "noreply@example.com",
  }), /真实认证必须配置独立 COOKIE_SECRET/);
});
