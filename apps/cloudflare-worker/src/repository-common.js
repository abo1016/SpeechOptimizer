import { WorkerError } from "./errors.js";
import { decodeAnalysisCursor, encodeAnalysisCursor } from "./pagination.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 所有状态变更都写入审计事件；Provider 原始响应不会进入 D1。 */
export function eventStatement(db, analysisId, ownerId, type, status, attempt, createdAt) {
  return db.prepare("INSERT INTO analysis_events(event_id,analysis_id,owner_id,event_type,status,attempt,created_at)"
    + " VALUES(?,?,?,?,?,?,?)")
    .bind("evt_" + crypto.randomUUID(), analysisId, ownerId, type, status, attempt, createdAt);
}

/** 条件状态迁移统一构建 SQL，调用者始终传入当前状态以保持乐观并发控制。 */
export function updateSql(patch, id, currentStatus) {
  const entries = Object.entries(patch);
  const assignments = entries.map(([key]) => key + "=?").join(",");
  return { sql: "UPDATE analyses SET " + assignments + " WHERE id=? AND status=?",
    values: [...entries.map(([, value]) => value), id, currentStatus] };
}

export function changes(result) { return Number(result?.meta?.changes ?? 0); }
export function isUniqueViolation(error) { return /unique|constraint/i.test(String(error?.message ?? error)); }

/** 将 SQLite 的配额与账户触发器错误转换成可公开的稳定业务错误。 */
export function quotaOrAccountError(error, code = "DAILY_QUOTA_EXCEEDED", message = "免费分析额度已用尽", status = 429) {
  if (error instanceof WorkerError) return error;
  const detail = String(error?.message ?? error);
  if (detail.includes("ACCOUNT_DISABLED")) return new WorkerError("ACCOUNT_DISABLED", "账户已禁用", 403);
  if (detail.includes("STORAGE_RESERVATION_REQUIRED")) {
    return new WorkerError("STORAGE_RESERVATION_REQUIRED", "上传容量预占无效", 409);
  }
  if (/check constraint|quota_counters\.limit_value/i.test(detail)) return new WorkerError(code, message, status);
  return error;
}

/** D1 对同一计数行串行更新，CHECK 约束负责使超限批次整体回滚。 */
export function quotaStatement(db, metric, periodKey, limit, now, increment = 1) {
  const sql = "INSERT INTO quota_counters(metric,period_key,value,updated_at,limit_value) VALUES(?,?,?,?,?)"
    + " ON CONFLICT(metric,period_key) DO UPDATE SET value=value+excluded.value,"
    + "limit_value=excluded.limit_value,updated_at=excluded.updated_at";
  return db.prepare(sql).bind(metric, periodKey, increment, now, limit);
}

/** 以 created_at 与 id 的复合游标分页，避免同一毫秒创建的任务跨页遗漏。 */
export async function listAnalysisPage(db, conditions, values, options = {}) {
  const { limit = DEFAULT_PAGE_SIZE, cursor } = options;
  const safeLimit = clampPageLimit(limit);
  const clauses = [...conditions];
  const bindings = [...values];
  if (cursor) appendCursorCondition(clauses, bindings, cursor);
  const sql = "SELECT * FROM analyses WHERE " + clauses.join(" AND ")
    + " ORDER BY created_at DESC, id DESC LIMIT ?";
  const rows = await db.prepare(sql).bind(...bindings, safeLimit + 1).all();
  const results = rows.results ?? [];
  const items = results.slice(0, safeLimit).map(toAnalysis);
  return { items, nextCursor: results.length > safeLimit ? encodeAnalysisCursor(items.at(-1)) : null };
}

/** Storage 对账与 Cron 清理共享的计数读写，不允许把容量值写成负数。 */
export async function quotaValue(db, metric, periodKey) {
  const row = await db.prepare("SELECT value FROM quota_counters WHERE metric=? AND period_key=?")
    .bind(metric, periodKey).first();
  return Number(row?.value ?? 0);
}

export async function adjustQuota(db, metric, periodKey, delta, now) {
  const sql = "INSERT INTO quota_counters(metric,period_key,value,updated_at) VALUES(?,?,?,?)"
    + " ON CONFLICT(metric,period_key) DO UPDATE SET value=MAX(0,value+excluded.value),updated_at=excluded.updated_at";
  await db.prepare(sql).bind(metric, periodKey, delta, now).run();
  return quotaValue(db, metric, periodKey);
}

export async function setQuota(db, metric, periodKey, value, now) {
  const sql = "INSERT INTO quota_counters(metric,period_key,value,updated_at) VALUES(?,?,?,?)"
    + " ON CONFLICT(metric,period_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at";
  await db.prepare(sql).bind(metric, periodKey, Math.max(0, Math.round(value)), now).run();
}

/** 统一把 D1 行映射为 API 可使用的分析对象，避免泄露底层字段名。 */
export function toAnalysis(row) {
  return {
    id: row.id,
    owner: { type: row.owner_type, id: row.owner_id },
    status: row.status,
    attempt: Number(row.attempt ?? 0),
    retainAudio: Boolean(row.retain_audio),
    audio: row.audio_key ? { objectKey: row.audio_key, size: Number(row.audio_size), mime: row.audio_mime,
      durationMs: row.audio_duration_ms == null ? null : Number(row.audio_duration_ms), etag: row.audio_etag,
      sha256: row.audio_sha256 } : null,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    // 只保留稳定错误码和安全诊断字段，不存储 Provider 原始错误正文。
    error: row.error_code ? { code: row.error_code, retryable: Boolean(row.error_retryable),
      stage: row.failure_stage ?? null, at: row.failed_at ?? null } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function subtractDays(iso, days) {
  return new Date(new Date(iso).getTime() - days * DAY_MS).toISOString();
}

function clampPageLimit(limit) { return Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE); }

function appendCursorCondition(clauses, bindings, cursor) {
  const parsed = decodeAnalysisCursor(cursor);
  clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
  bindings.push(parsed.createdAt, parsed.createdAt, parsed.id);
}
