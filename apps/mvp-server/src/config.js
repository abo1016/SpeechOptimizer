import { resolve } from "node:path";

const DEFAULT_JSON_BYTES = 64 * 1024;
const DEFAULT_AUDIO_BYTES = 25 * 1024 * 1024;
const DEVELOPMENT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";

/** 集中解析服务配置；生产模式缺少真实外部服务配置时直接拒绝启动。 */
export function loadConfig(env = process.env, overrides = {}) {
  const mode = overrides.mode ?? env.NODE_ENV ?? "development";
  const rootDirectory = resolve(overrides.rootDirectory ?? env.MVP_DATA_DIRECTORY ?? ".data/mvp-server");
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
    webhookSecret: overrides.webhookSecret ?? env.WAFFO_WEBHOOK_SECRET ?? developmentSecret(mode),
    // 生产环境不继承本地 Vite 来源，避免漏配时错误接受开发 Origin。
    allowedOrigins: list(overrides.allowedOrigins ?? env.ALLOWED_ORIGINS
      ?? (mode === "production" ? "" : DEVELOPMENT_ORIGINS)),
    openAiApiKey: overrides.openAiApiKey ?? env.OPENAI_API_KEY,
    openAiSttUrl: overrides.openAiSttUrl ?? env.OPENAI_STT_URL,
    openAiFeedbackUrl: overrides.openAiFeedbackUrl ?? env.OPENAI_FEEDBACK_URL,
    openAiFeedbackModel: overrides.openAiFeedbackModel ?? env.OPENAI_FEEDBACK_MODEL ?? "gpt-4o-mini",
    googleAuthorizeUrl: overrides.googleAuthorizeUrl ?? env.GOOGLE_AUTHORIZE_URL,
    googleTokenUrl: overrides.googleTokenUrl ?? env.GOOGLE_TOKEN_URL,
    googleClientId: overrides.googleClientId ?? env.GOOGLE_CLIENT_ID,
    googleClientSecret: overrides.googleClientSecret ?? env.GOOGLE_CLIENT_SECRET,
    smtpFrom: overrides.smtpFrom ?? env.MAGIC_LINK_FROM,
    waffoSuccessUrl: overrides.waffoSuccessUrl ?? env.WAFFO_SUCCESS_URL,
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
  return mode === "production" ? undefined : "local-development-only-secret-change-me";
}

function validateConfig(config) {
  if (!config.cookieSecret || config.cookieSecret.length < 24) throw new Error("COOKIE_SECRET 至少需要 24 个字符");
  if (!config.webhookSecret || config.webhookSecret.length < 24) throw new Error("WAFFO_WEBHOOK_SECRET 至少需要 24 个字符");
  if (config.mode !== "production") return;
  const required = ["openAiApiKey", "smtpFrom", "waffoSuccessUrl",
    "googleAuthorizeUrl", "googleTokenUrl",
    "googleClientId", "googleClientSecret"];
  const missing = required.filter((name) => !config[name]);
  if (missing.length > 0) throw new Error(`生产模式缺少配置: ${missing.join(", ")}`);
  if (config.allowedOrigins.length === 0) throw new Error("生产模式必须配置 ALLOWED_ORIGINS");
  if (Object.keys(config.waffoProductIds).length === 0) throw new Error("生产模式必须配置 WAFFO_PRODUCT_IDS_JSON");
  if (config.waffoAllowedSources.length === 0) throw new Error("生产模式必须配置 WAFFO_ALLOWED_SOURCES");
}

function parseJson(value, name) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { throw new Error(`${name} 必须是有效 JSON`); }
}
