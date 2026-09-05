import { WorkerError, invariant } from "./errors.js";
import { adjustQuota, changes, quotaOrAccountError, quotaStatement, quotaValue, setQuota,
  subtractDays } from "./repository-common.js";

const MAX_BATCH_SIZE = 100;
const EVENT_RETENTION_DAYS = 30;
const TRIAL_RETENTION_DAYS = 366;
const QUOTA_RETENTION_DAYS = 35;
const UPLOAD_TICKET_RETENTION_DAYS = 1;

/** 维护仓储负责账户删除、短期数据清理、匿名试用和应用层计数器。 */
export class MaintenanceRepository {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }

  async updateRetainAudio(userId, retainAudio) {
    await this.db.prepare("UPDATE users SET retain_audio=? WHERE id=?").bind(retainAudio ? 1 : 0, userId).run();
  }

  async beginAccountDeletion({ userId, email }) {
    const now = this.now();
    const results = await this.db.batch([
      this.db.prepare(`UPDATE users SET status='disabled', deletion_requested_at=COALESCE(deletion_requested_at, ?)
        WHERE id=? AND deleted_at IS NULL`).bind(now, userId),
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId),
      this.db.prepare("DELETE FROM magic_links WHERE email_normalized=?").bind(email),
    ]);
    invariant(changes(results[0]) === 1, "ACCOUNT_NOT_FOUND", "账户不存在或已删除", 404);
    console.info(JSON.stringify({ event: "account.deletion_started", userId }));
    return { sessions: changes(results[1]), magicLinks: changes(results[2]) };
  }

  async listPendingAccountDeletions(limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_BATCH_SIZE);
    const rows = await this.db.prepare(`SELECT id FROM users WHERE status='disabled' AND deletion_requested_at IS NOT NULL
      ORDER BY deletion_requested_at ASC LIMIT ?`).bind(safeLimit).all();
    return (rows.results ?? []).map((row) => row.id);
  }

  async finalizeAccountDeletion(userId) {
    const remaining = await this.db.prepare(`SELECT COUNT(*) AS count FROM analyses
      WHERE owner_type='account' AND owner_id=? AND (audio_key IS NOT NULL OR upload_object_key IS NOT NULL)`)
      .bind(userId).first();
    invariant(Number(remaining?.count ?? 0) === 0,
      "ACCOUNT_DELETION_PENDING_STORAGE", "账户音频尚未清理完成", 409);
    const now = this.now();
    const results = await this.db.batch([
      // 先显式释放 reservation，触发器才会在级联删除分析前归还 storage-bytes。
      this.db.prepare(`UPDATE storage_reservations SET status='released',updated_at=? WHERE status!='released'
        AND analysis_id IN (SELECT id FROM analyses WHERE owner_type='account' AND owner_id=?)`).bind(now, userId),
      this.db.prepare("DELETE FROM analyses WHERE owner_type='account' AND owner_id=?").bind(userId),
      this.db.prepare("DELETE FROM users WHERE id=? AND status='disabled' AND deletion_requested_at IS NOT NULL")
        .bind(userId),
    ]);
    invariant(changes(results[2]) === 1, "ACCOUNT_DELETION_CONFLICT", "账户删除状态已变化", 409);
    return { analyses: changes(results[1]) };
  }

  /** 删除过期且不再参与产品行为的数据，storage-bytes 永远保留为跨期硬护栏。 */
  async cleanupExpiredRecords() {
    const now = this.now();
    const results = await this.db.batch(this.#cleanupStatements(now));
    return {
      sessions: changes(results[0]), magicLinks: changes(results[1]), oauthStates: changes(results[2]),
      analysisEvents: changes(results[3]), webhookEvents: changes(results[4]), anonymousTrials: changes(results[5]),
      quotaCounters: changes(results[6]), expiredUploadTickets: changes(results[7]),
      expiredReservations: changes(results[8]),
    };
  }

  async consumeAnonymousTrial(anonymousId, analysisId) {
    try {
      await this.db.prepare("INSERT INTO anonymous_trials(anonymous_id,consumed_at,analysis_id) VALUES(?,?,?)")
        .bind(anonymousId, this.now(), analysisId).run();
    } catch (error) {
      if (String(error?.message).includes("UNIQUE")) {
        throw new WorkerError("ANONYMOUS_TRIAL_USED", "匿名体验已用尽", 409);
      }
      throw error;
    }
  }

  async incrementQuota(metric, periodKey, limit) {
    try {
      await quotaStatement(this.db, metric, periodKey, limit, this.now()).run();
    } catch (error) {
      throw quotaOrAccountError(error);
    }
  }

  quotaValue(metric, periodKey) { return quotaValue(this.db, metric, periodKey); }

  adjustQuota(metric, periodKey, delta) {
    return adjustQuota(this.db, metric, periodKey, delta, this.now());
  }

  setQuota(metric, periodKey, value) { return setQuota(this.db, metric, periodKey, value, this.now()); }

  #cleanupStatements(now) {
    const eventCutoff = subtractDays(now, EVENT_RETENTION_DAYS);
    const trialCutoff = subtractDays(now, TRIAL_RETENTION_DAYS);
    const quotaCutoff = subtractDays(now, QUOTA_RETENTION_DAYS).slice(0, 10);
    const ticketCutoff = subtractDays(now, UPLOAD_TICKET_RETENTION_DAYS);
    return [
      this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
      this.db.prepare("DELETE FROM magic_links WHERE used_at IS NOT NULL OR expires_at<=?").bind(now),
      this.db.prepare("DELETE FROM oauth_states WHERE expires_at<=?").bind(now),
      this.db.prepare("DELETE FROM analysis_events WHERE created_at<?").bind(eventCutoff),
      this.db.prepare("DELETE FROM webhook_events WHERE received_at<?").bind(eventCutoff),
      // 匿名 cookie 有一年有效期，保留 366 天避免未过期 cookie 重新获得试用。
      this.db.prepare("DELETE FROM anonymous_trials WHERE consumed_at<?").bind(trialCutoff),
      this.db.prepare("DELETE FROM quota_counters WHERE metric != 'storage-bytes' AND period_key<?").bind(quotaCutoff),
      this.db.prepare(`UPDATE analyses SET upload_object_key=NULL,upload_size=NULL,upload_mime=NULL,upload_sha256=NULL,
        upload_issued_at=NULL,updated_at=? WHERE status='created' AND id IN (
          SELECT analysis_id FROM storage_reservations WHERE status='reserved' AND updated_at<?
        )`).bind(now, ticketCutoff),
      this.db.prepare(`UPDATE storage_reservations SET status='released',updated_at=?
        WHERE status='reserved' AND updated_at<?`).bind(now, ticketCutoff),
    ];
  }
}
