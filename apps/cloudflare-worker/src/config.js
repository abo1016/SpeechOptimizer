import { WorkerError } from "./errors.js";

const TEN_MIB = 10 * 1024 * 1024;
const EIGHT_HUNDRED_MIB = 800 * 1024 * 1024;
const ONE_MINUTE_MS = 60 * 1000;
const DEFAULT_OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_OPENAI_STT_MODEL = "whisper-1";
const MAX_OPENAI_STT_URL_LENGTH = 2048;
const MAX_OPENAI_STT_MODEL_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/** 运行时配置只读取非敏感 vars；secret 缺失在真正使用对应能力时 fail closed。 */
export function runtimeConfig(env) {
  const config = {
    maxAudioBytes: positiveInt(env.MAX_AUDIO_BYTES, TEN_MIB),
    maxDurationMs: positiveInt(env.MAX_AUDIO_DURATION_MS, 5 * 60 * 1000),
    anonymousMaxDurationMs: positiveInt(env.ANONYMOUS_MAX_AUDIO_DURATION_MS, ONE_MINUTE_MS),
    // Supabase Free 当前以约 1 GB Storage 为目标，应用先在 800 MiB 停止新上传留出运维余量。
    storageLimitBytes: positiveInt(env.STORAGE_LIMIT_BYTES ?? env.R2_STORAGE_LIMIT_BYTES, EIGHT_HUNDRED_MIB),
    uploadExpiresSeconds: positiveInt(env.UPLOAD_URL_TTL_SECONDS, 600),
    sessionTtlSeconds: positiveInt(env.SESSION_TTL_SECONDS, 30 * 24 * 60 * 60),
    magicLinkTtlSeconds: positiveInt(env.MAGIC_LINK_TTL_SECONDS, 15 * 60),
    anonymousDailyLimit: positiveInt(env.ANONYMOUS_DAILY_LIMIT, 1),
    accountDailyLimit: positiveInt(env.ACCOUNT_DAILY_LIMIT, 3),
    globalDailyLimit: positiveInt(env.GLOBAL_DAILY_LIMIT, 50),
    quotaExemptAccountEmails: normalizedEmailSet(env.QUOTA_EXEMPT_ACCOUNT_EMAILS, "QUOTA_EXEMPT_ACCOUNT_EMAILS"),
    adminAccountEmails: normalizedEmailSet(env.ADMIN_ACCOUNT_EMAILS, "ADMIN_ACCOUNT_EMAILS"),
    freeTierGuardLevel: guardLevel(env.FREE_TIER_GUARD_LEVEL),
    paymentsEnabled: String(env.PAYMENTS_ENABLED ?? "false") === "true",
  };
  if (config.paymentsEnabled) throw new WorkerError("PAYMENTS_NOT_MIGRATED", "Cloudflare 免费 Beta 暂未启用支付", 503);
  return config;
}

export function requiredSecret(env, name) {
  const value = env[name];
  if (!value) throw new WorkerError("SERVICE_NOT_CONFIGURED", `${name} 未配置`, 503);
  return value;
}

/**
 * 读取 OpenAI-compatible STT 的部署配置；URL 和模型只允许由 Worker 环境提供，不能由请求体覆盖。
 * URL 保持为完整 POST endpoint，方便官方与中转服务分别使用自己的路径，同时在发起音频请求前 fail closed。
 */
export function openAiSttConfig(env) {
  const urlValue = env?.OPENAI_STT_URL === undefined ? DEFAULT_OPENAI_STT_URL : env.OPENAI_STT_URL;
  const modelValue = env?.OPENAI_STT_MODEL === undefined ? DEFAULT_OPENAI_STT_MODEL : env.OPENAI_STT_MODEL;
  return Object.freeze({ url: validateSttUrl(urlValue), model: validateSttModel(modelValue) });
}

/** STT 返回时长是服务端可信来源；浏览器声明只用于 UX 预检，不参与最终判定。 */
export function validateTrustedDuration(env, transcription, ownerType = "account") {
  const config = runtimeConfig(env);
  const durationMs = Math.ceil(Number(transcription?.duration ?? 0) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw Object.assign(new Error("STT 未返回可信音频时长"), { code: "AUDIO_DURATION_UNKNOWN", retryable: false });
  }
  const limit = ownerType === "anonymous" ? config.anonymousMaxDurationMs : config.maxDurationMs;
  if (durationMs > limit) {
    throw Object.assign(new Error("音频时长超过免费 Beta 上限"), { code: "AUDIO_TOO_LONG", retryable: false });
  }
  return { durationMs };
}

/** 运营根据 Cloudflare Usage 把护栏提升到 80/90/95；业务层只执行确定的降级动作。 */
export function assertFreeTierAdmission(env, owner, stage = "create") {
  const level = runtimeConfig(env).freeTierGuardLevel;
  if (level >= 95 && stage === "upload") {
    throw new WorkerError("FREE_TIER_UPLOADS_PAUSED", "免费额度接近上限，暂时停止新上传", 503);
  }
  if (level >= 90) {
    throw new WorkerError("FREE_TIER_NEW_ANALYSES_PAUSED", "免费额度接近上限，暂时停止新分析", 503);
  }
  if (level >= 80 && owner.type === "anonymous") {
    throw new WorkerError("FREE_TIER_ANONYMOUS_PAUSED", "匿名分析因免费额度保护暂时关闭", 503);
  }
}

function positiveInt(value, fallback) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new WorkerError("INVALID_CONFIG", "运行时数值配置无效", 500);
  return result;
}

function normalizedEmailSet(value, name) {
  if (value === undefined || value === null || value === "") return new Set();
  if (typeof value !== "string") throw new WorkerError("INVALID_CONFIG", `${name} 无效`, 500);
  const emails = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new WorkerError("INVALID_CONFIG", `${name} 无效`, 500);
  }
  return new Set(emails);
}

/** URL 必须是无凭据、无查询参数的 HTTPS 完整 endpoint；原始配置值不会进入异常消息或日志。 */
function validateSttUrl(value) {
  if (typeof value !== "string") throw sttConfigError();
  const raw = value;
  if (!raw || raw.length > MAX_OPENAI_STT_URL_LENGTH || raw !== raw.trim()
    || CONTROL_CHARACTERS.test(raw) || /\s/.test(raw)) {
    throw sttConfigError();
  }
  // URL 构造器会把末尾的裸 ?/# 归一为空字符串，因此先检查原文以确保它们也被拒绝。
  if (raw.includes("?") || raw.includes("#")) throw sttConfigError();
  let parsed;
  try { parsed = new URL(raw); } catch { throw sttConfigError(); }
  const authorityStart = raw.indexOf("://") + 3;
  const authorityEnd = raw.indexOf("/", authorityStart);
  const authority = raw.slice(authorityStart, authorityEnd < 0 ? raw.length : authorityEnd);
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password
    || parsed.search || parsed.hash || authority.includes("@")) throw sttConfigError();
  return parsed.toString();
}

/** 模型允许中转服务的安全别名，但拒绝空白、控制字符和过长值，避免 multipart 内容注入。 */
function validateSttModel(value) {
  if (typeof value !== "string" || !value || value.length > MAX_OPENAI_STT_MODEL_LENGTH
    || CONTROL_CHARACTERS.test(value) || /\s/.test(value)) throw sttConfigError();
  return value;
}

function sttConfigError() {
  return Object.assign(new WorkerError("STT_CONFIG_INVALID", "STT 配置无效", 503), { retryable: false });
}

function guardLevel(value) {
  const level = Number(value ?? 0);
  if (!new Set([0, 80, 90, 95]).has(level)) throw new WorkerError("INVALID_CONFIG", "FREE_TIER_GUARD_LEVEL 无效", 500);
  return level;
}
