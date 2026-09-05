import { WorkerError } from "./errors.js";

const TEN_MIB = 10 * 1024 * 1024;
const EIGHT_HUNDRED_MIB = 800 * 1024 * 1024;
const ONE_MINUTE_MS = 60 * 1000;

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

function guardLevel(value) {
  const level = Number(value ?? 0);
  if (!new Set([0, 80, 90, 95]).has(level)) throw new WorkerError("INVALID_CONFIG", "FREE_TIER_GUARD_LEVEL 无效", 500);
  return level;
}
