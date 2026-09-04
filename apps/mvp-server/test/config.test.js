import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("生产模式缺少真实 Provider 配置时拒绝启动", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", COOKIE_SECRET: "a".repeat(24),
    WAFFO_WEBHOOK_SECRET: "b".repeat(24) }), /生产模式缺少配置/);
});

test("生产模式必须显式配置允许来源", () => {
  assert.throws(() => loadConfig({}, {
    mode: "production",
    cookieSecret: "a".repeat(24),
    webhookSecret: "b".repeat(24),
    openAiApiKey: "test-openai-key",
    smtpFrom: "noreply@example.com",
    waffoSuccessUrl: "https://example.com/billing/success",
    googleAuthorizeUrl: "https://accounts.example.com/authorize",
    googleTokenUrl: "https://accounts.example.com/token",
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
    waffoProductIds: { minutes_30: "product-1" },
    waffoAllowedSources: ["127.0.0.1"],
  }), /生产模式必须配置 ALLOWED_ORIGINS/);
});

test("开发模式使用明确的本地配置且限制为正整数", () => {
  const config = loadConfig({}, { rootDirectory: "/tmp/mvp-config-test", port: 9999 });
  assert.equal(config.mode, "development");
  assert.deepEqual(config.allowedOrigins, ["http://localhost:5173", "http://127.0.0.1:5173"]);
  assert.throws(() => loadConfig({}, { port: 0 }), /PORT 必须为正整数/);
});
