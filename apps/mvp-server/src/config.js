import { resolve } from "node:path";

const DEFAULT_JSON_BYTES = 64 * 1024;
const DEFAULT_AUDIO_BYTES = 25 * 1024 * 1024;
const DEVELOPMENT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
const DEVELOPMENT_COOKIE_SECRET = "local-development-only-secret-change-me";
const WAFFO_ENVIRONMENTS = new Set(["SANDBOX", "PRODUCTION"]);
const AUTH_MODES = new Set(["mock", "production"]);

/** 集中解析服务配置；生产模式缺少真实外部服务配置时直接拒绝启动。 */
export function loadConfig(env = process.env, overrides = {}) {
  const mode = overrides.mode ?? env.NODE_ENV ?? "development";
  const authMode = normalizeAuthMode(overrides.authMode ?? env.AUTH_MODE, mode);
  const rootDirectory = resolve(overrides.rootDirectory ?? env.MVP_DATA_DIRECTORY ?? ".data/mvp-server");
  const waffoSuccessRedirectUrl = overrides.waffoSuccessRedirectUrl ?? env.WAFFO_SUCCESS_REDIRECT_URL;
  const config = {
    mode,
    host: overrides.host ?? env.HOST ?? "127.0.0.1",
    port: integer(overrides.port ?? env.PORT, 8787, "PORT"),
    rootDirectory,
    coreDirectory: resolve(rootDirectory, "core"),
    appStateFile: resolve(rootDirectory, "application-state.json"),
    jsonLimitBytes: integer(overrides.jsonLimitBytes ?? env.JSON_LIMIT_BYTES, DEFAULT_JSON_BYTES, "JSON_LIMIT_BYTES"),
    audioLimitBytes: integer(overrides.audioLimitBytes ?? env.AUDIO_LIMIT_BYTES, DEFAULT_AUDIO_BYTES, "AUDIO_LIMIT_BYTES"),
    ffprobePath: overrides.ffprobePath ?? env.FFPROBE_PATH ?? "ffprobe",
    cookieSecret: overrides.cookieSecret ?? env.COOKIE_SECRET ?? developmentSecret(mode),
    authMode,
    // 真实认证即使与 Mock AI/支付混合运行，也必须只下发 HTTPS Cookie。
    secureCookies: mode === "production" || authMode === "production",
    // 生产环境不继承本地 Vite 来源，避免漏配时错误接受开发 Origin。
    allowedOrigins: list(overrides.allowedOrigins ?? env.ALLOWED_ORIGINS
      ?? (mode === "production" ? "" : DEVELOPMENT_ORIGINS)),
    openAiApiKey: overrides.openAiApiKey ?? env.OPENAI_API_KEY,
    openAiSttUrl: overrides.openAiSttUrl ?? env.OPENAI_STT_URL,
    openAiFeedbackUrl: overrides.openAiFeedbackUrl ?? env.OPENAI_FEEDBACK_URL,
    openAiFeedbackModel: overrides.openAiFeedbackModel ?? env.OPENAI_FEEDBACK_MODEL ?? "gpt-4o-mini",
    googleAuthorizeUrl: overrides.googleAuthorizeUrl ?? env.GOOGLE_AUTHORIZE_URL
      ?? "https://accounts.google.com/o/oauth2/v2/auth",
    googleTokenUrl: overrides.googleTokenUrl ?? env.GOOGLE_TOKEN_URL
      ?? "https://oauth2.googleapis.com/token",
    googleUserinfoUrl: overrides.googleUserinfoUrl ?? env.GOOGLE_USERINFO_URL
      ?? "https://openidconnect.googleapis.com/v1/userinfo",
    googleClientId: overrides.googleClientId ?? env.GOOGLE_CLIENT_ID,
    googleClientSecret: overrides.googleClientSecret ?? env.GOOGLE_CLIENT_SECRET,
    smtpFrom: overrides.smtpFrom ?? env.MAGIC_LINK_FROM,
    resendApiKey: overrides.resendApiKey ?? env.RESEND_API_KEY,
    // Waffo SDK 3.0.1 使用 RSA 密钥验签；这里仅保存配置，不输出任何密钥内容。
    waffoApiKey: overrides.waffoApiKey ?? env.WAFFO_API_KEY,
    waffoPrivateKey: overrides.waffoPrivateKey ?? env.WAFFO_PRIVATE_KEY,
    waffoPublicKey: overrides.waffoPublicKey ?? env.WAFFO_PUBLIC_KEY,
    waffoEnvironment: normalizeWaffoEnvironment(overrides.waffoEnvironment ?? env.WAFFO_ENVIRONMENT, mode),
    waffoMerchantId: overrides.waffoMerchantId ?? env.WAFFO_MERCHANT_ID,
    waffoNotifyUrl: overrides.waffoNotifyUrl ?? env.WAFFO_NOTIFY_URL,
    waffoRefundNotifyUrl: overrides.waffoRefundNotifyUrl ?? env.WAFFO_REFUND_NOTIFY_URL,
    waffoSuccessRedirectUrl,
    waffoFailedRedirectUrl: overrides.waffoFailedRedirectUrl ?? env.WAFFO_FAILED_REDIRECT_URL,
    waffoCancelRedirectUrl: overrides.waffoCancelRedirectUrl ?? env.WAFFO_CANCEL_REDIRECT_URL,
    waffoGoodsName: overrides.waffoGoodsName ?? env.WAFFO_GOODS_NAME,
    waffoGoodsUrl: overrides.waffoGoodsUrl ?? env.WAFFO_GOODS_URL,
    // userTerminal 是商户确认项，不提供默认值；生产漏配或填入占位符必须拒绝启动。
    waffoUserTerminal: overrides.waffoUserTerminal ?? env.WAFFO_USER_TERMINAL,
    waffoSubscriptionManagementUrl: overrides.waffoSubscriptionManagementUrl
      ?? env.WAFFO_SUBSCRIPTION_MANAGEMENT_URL,
    // 订阅扣款模式和重试策略属于资金合同决策；未确认前只允许生产启动 fail closed。
    waffoSubscriptionMode: overrides.waffoSubscriptionMode ?? env.WAFFO_SUBSCRIPTION_MODE,
    waffoSubscriptionRetryPolicy: overrides.waffoSubscriptionRetryPolicy ?? env.WAFFO_SUBSCRIPTION_RETRY_POLICY,
    waffoProductIds: parseJson(overrides.waffoProductIds ?? env.WAFFO_PRODUCT_IDS_JSON, "WAFFO_PRODUCT_IDS_JSON"),
    waffoAllowedSources: list(overrides.waffoAllowedSources ?? env.WAFFO_ALLOWED_SOURCES ?? ""),
    webhookRequestsPerMinute: integer(overrides.webhookRequestsPerMinute
      ?? env.WEBHOOK_REQUESTS_PER_MINUTE, 60, "WEBHOOK_REQUESTS_PER_MINUTE"),
  };
  validateConfig(config);
  return Object.freeze(config);
}

function integer(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${name} 必须为正整数`);
  return result;
}

function list(value) {
  return Array.isArray(value) ? value : String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function developmentSecret(mode) {
  return mode === "production" ? undefined : DEVELOPMENT_COOKIE_SECRET;
}

function normalizeAuthMode(value, mode) {
  const normalized = String(value ?? (mode === "production" ? "production" : "mock")).trim().toLowerCase();
  if (!AUTH_MODES.has(normalized)) throw new Error("AUTH_MODE 必须是 mock 或 production");
  return normalized;
}

function normalizeWaffoEnvironment(value, mode) {
  if (value === undefined || value === null || value === "") return mode === "production" ? undefined : "SANDBOX";
  const normalized = String(value).trim().toUpperCase();
  if (!WAFFO_ENVIRONMENTS.has(normalized)) {
    throw new Error("WAFFO_ENVIRONMENT 必须是 SANDBOX 或 PRODUCTION");
  }
  return normalized;
}

function validateConfig(config) {
  if (!config.cookieSecret || config.cookieSecret.length < 24) throw new Error("COOKIE_SECRET 至少需要 24 个字符");
  validateAuthConfig(config);
  if (config.mode !== "production") return;
  const required = ["openAiApiKey", "waffoApiKey", "waffoPrivateKey", "waffoPublicKey",
    "waffoEnvironment", "waffoMerchantId", "waffoNotifyUrl", "waffoSuccessRedirectUrl",
    "waffoFailedRedirectUrl", "waffoCancelRedirectUrl", "waffoGoodsName", "waffoGoodsUrl",
    "waffoUserTerminal"];
  const missing = required.filter((name) => !config[name]);
  if (missing.length > 0) throw new Error(`生产模式缺少配置: ${missing.join(", ")}`);
  requireConfirmedDecision(config.waffoUserTerminal, "userTerminal", "WAFFO_USER_TERMINAL");
  requireConfirmedDecision(config.waffoSubscriptionMode, "subscriptionMode");
  requireConfirmedDecision(config.waffoSubscriptionRetryPolicy, "subscriptionRetryConfig");
  if (!["WEB", "APP", "IN_WALLET_APP", "IN_MINI_PROGRAM"].includes(config.waffoUserTerminal)) {
    throw new Error("生产模式 WAFFO_USER_TERMINAL 必须是已确认的 WEB、APP、IN_WALLET_APP 或 IN_MINI_PROGRAM");
  }
  if (config.allowedOrigins.length === 0) throw new Error("生产模式必须配置 ALLOWED_ORIGINS");
  if (Object.keys(config.waffoProductIds).length === 0) throw new Error("生产模式必须配置 WAFFO_PRODUCT_IDS_JSON");
  if (config.waffoAllowedSources.length === 0) throw new Error("生产模式必须配置 WAFFO_ALLOWED_SOURCES");
}

function validateAuthConfig(config) {
  if (config.authMode !== "production") return;
  const required = ["googleClientId", "googleClientSecret", "resendApiKey", "smtpFrom"];
  const missing = required.filter((name) => !config[name]);
  if (missing.length > 0) throw new Error(`真实认证缺少配置: ${missing.join(", ")}`);
  if (config.allowedOrigins.length === 0) throw new Error("真实认证必须配置 ALLOWED_ORIGINS");
  if (config.cookieSecret === DEVELOPMENT_COOKIE_SECRET) {
    throw new Error("真实认证必须配置独立 COOKIE_SECRET");
  }
}

function requireConfirmedDecision(value, decisionId, envName = decisionId) {
  if (!value || String(value).startsWith("REPLACE_AFTER_HUMAN_CONFIRMATION")) {
    throw new Error(`WAFFO_DECISION_REQUIRED: ${decisionId} (${envName})`);
  }
}

function parseJson(value, name) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { throw new Error(`${name} 必须是有效 JSON`); }
}
