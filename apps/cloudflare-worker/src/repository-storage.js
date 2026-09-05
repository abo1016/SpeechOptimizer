import { WorkerError, invariant } from "./errors.js";
import { changes, eventStatement, quotaOrAccountError, quotaStatement, setQuota, toAnalysis,
  updateSql } from "./repository-common.js";

const STORAGE_METRIC = "storage-bytes";
const STORAGE_PERIOD = "current";

/** 上传 ticket 与容量预占必须在同一 D1 事务中维护，避免对象能力和免费额度分离。 */
export class StorageRepository {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }

  async prepareUploadTicket(analysisId, owner, ticket, limit) {
    const current = await this.#getUploadTicketRow(analysisId, owner);
    invariant(current.status === "created", "INVALID_STATE_TRANSITION", "当前状态不允许申请上传", 409);
    if (current.upload_object_key) return this.#reuseUploadTicket(current, ticket);
    try {
      return await this.#createUploadTicket(current, owner, ticket, limit);
    } catch (error) {
      if (error instanceof WorkerError && error.code !== "STATE_CONFLICT") throw error;
      const winner = await this.#getUploadTicketRow(analysisId, owner);
      if (winner.upload_object_key) return this.#reuseUploadTicket(winner, ticket);
      throw quotaOrAccountError(error, "STORAGE_LIMIT_REACHED", "音频存储已达到免费 Beta 安全上限", 503);
    }
  }

  async getUploadTicket(analysisId, owner) {
    const current = await this.#getUploadTicketRow(analysisId, owner);
    invariant(current.upload_object_key, "UPLOAD_TICKET_MISSING", "未找到当前任务的上传授权", 409);
    return { objectKey: current.upload_object_key, size: Number(current.upload_size), mime: current.upload_mime,
      sha256: current.upload_sha256 };
  }

  /** 未确认对象不在公开 audio 字段中，取消、删除账户前仍需读取并清理。 */
  async getPendingUploadObjectKey(analysisId, owner) {
    const current = await this.#getUploadTicketRow(analysisId, owner);
    return current.upload_object_key ?? null;
  }

  async clearUploadTicket(analysisId, objectKey) {
    await this.db.prepare(`UPDATE analyses SET upload_object_key=NULL,upload_size=NULL,upload_mime=NULL,
      upload_sha256=NULL,upload_issued_at=NULL,updated_at=? WHERE id=? AND status='created' AND upload_object_key=?`)
      .bind(this.now(), analysisId, objectKey).run();
  }

  async reserveStorage(analysisId, owner, bytes, limit) {
    const existing = await this.db.prepare("SELECT * FROM storage_reservations WHERE analysis_id=?").bind(analysisId).first();
    if (existing && Number(existing.bytes) !== bytes) {
      throw new WorkerError("STORAGE_RESERVATION_CONFLICT", "上传声明与已有容量预占不一致", 409);
    }
    if (existing && existing.status !== "released") return { status: existing.status, bytes: Number(existing.bytes) };
    if (existing) throw new WorkerError("STORAGE_RESERVATION_EXPIRED", "上传预占已过期，请创建新的分析任务", 409);
    const now = this.now();
    const reservation = this.#reservationStatement(analysisId, owner, bytes, now);
    try {
      await this.db.batch([quotaStatement(this.db, STORAGE_METRIC, STORAGE_PERIOD, limit, now, bytes), reservation]);
    } catch (error) {
      throw quotaOrAccountError(error, "STORAGE_LIMIT_REACHED", "音频存储已达到免费 Beta 安全上限", 503);
    }
    console.info(JSON.stringify({ event: "storage.reserved", analysisId, bytes }));
    return { status: "reserved", bytes };
  }

  async confirmStorageUpload(analysisId, owner, patch) {
    const now = this.now();
    const reservation = this.db.prepare(`UPDATE storage_reservations SET status='confirmed',updated_at=?
      WHERE analysis_id=? AND status='reserved' AND bytes=?`).bind(now, analysisId, patch.audio_size);
    const { sql, values } = updateSql({ ...patch, status: "uploaded", updated_at: now }, analysisId, "created");
    const event = eventStatement(this.db, analysisId, owner.id, "analysis.uploaded", "uploaded", 0, now);
    try {
      const results = await this.db.batch([reservation, this.db.prepare(sql).bind(...values), event]);
      invariant(changes(results[0]) === 1 && changes(results[1]) === 1,
        "STATE_CONFLICT", "上传状态已被其他执行器更新", 409);
    } catch (error) {
      throw quotaOrAccountError(error, "STORAGE_RESERVATION_REQUIRED", "上传容量预占无效", 409);
    }
    return this.#getOwnedAnalysis(analysisId, owner);
  }

  async releaseStorage(analysisId) {
    const result = await this.db.prepare(`UPDATE storage_reservations SET status='released',updated_at=?
      WHERE analysis_id=? AND status!='released'`).bind(this.now(), analysisId).run();
    if (changes(result) === 1) console.info(JSON.stringify({ event: "storage.released", analysisId }));
  }

  async reconcileStorageQuota(actualBytes) {
    const reserved = await this.db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS total FROM storage_reservations
      WHERE status IN ('reserved','confirmed')`).first();
    await setQuota(this.db, STORAGE_METRIC, STORAGE_PERIOD,
      Math.max(Number(actualBytes), Number(reserved?.total ?? 0)), this.now());
  }

  async clearAudioKey(id) {
    await this.db.prepare("UPDATE analyses SET audio_key=NULL,audio_size=NULL,audio_etag=NULL,updated_at=? WHERE id=?")
      .bind(this.now(), id).run();
  }

  async #getUploadTicketRow(analysisId, owner) {
    const row = await this.db.prepare(`SELECT a.*,r.bytes AS reservation_bytes,r.status AS reservation_status
      FROM analyses a LEFT JOIN storage_reservations r ON r.analysis_id=a.id WHERE a.id=?`).bind(analysisId).first();
    invariant(row, "ANALYSIS_NOT_FOUND", "分析任务不存在", 404);
    invariant(row.owner_type === owner.type && row.owner_id === owner.id, "FORBIDDEN", "无权访问该分析任务", 403);
    return row;
  }

  #reuseUploadTicket(current, ticket) {
    const matches = Number(current.upload_size) === ticket.size && current.upload_mime === ticket.mime
      && current.upload_sha256 === ticket.sha256;
    invariant(matches, "UPLOAD_TICKET_CONFLICT", "同一任务的上传声明不能变更", 409);
    invariant(current.reservation_status === "reserved", "STORAGE_RESERVATION_EXPIRED", "上传容量预占已过期，请创建新的分析任务", 409);
    return { objectKey: current.upload_object_key, reused: true };
  }

  async #createUploadTicket(current, owner, ticket, limit) {
    const now = this.now();
    const update = this.db.prepare(`UPDATE analyses SET upload_object_key=?,upload_size=?,upload_mime=?,
      upload_sha256=?,upload_issued_at=?,updated_at=? WHERE id=? AND owner_type=? AND owner_id=?
      AND status='created' AND upload_object_key IS NULL`)
      .bind(ticket.objectKey, ticket.size, ticket.mime, ticket.sha256, now, now,
        current.id, owner.type, owner.id);
    const statements = [update];
    if (current.reservation_status) this.#assertExistingReservation(current, ticket);
    else statements.unshift(quotaStatement(this.db, STORAGE_METRIC, STORAGE_PERIOD, limit, now, ticket.size),
      this.#reservationStatement(current.id, owner, ticket.size, now));
    const results = await this.db.batch(statements);
    invariant(changes(results.at(-1)) === 1, "STATE_CONFLICT", "上传授权已被其他执行器更新", 409);
    console.info(JSON.stringify({ event: "storage.upload_ticket_created", analysisId: current.id, bytes: ticket.size }));
    return { objectKey: ticket.objectKey, reused: false };
  }

  #assertExistingReservation(current, ticket) {
    invariant(current.reservation_status === "reserved", "STORAGE_RESERVATION_EXPIRED", "上传容量预占已过期，请创建新的分析任务", 409);
    invariant(Number(current.reservation_bytes) === ticket.size,
      "STORAGE_RESERVATION_CONFLICT", "上传声明与已有容量预占不一致", 409);
  }

  #reservationStatement(analysisId, owner, bytes, now) {
    return this.db.prepare(`INSERT INTO storage_reservations(analysis_id,bytes,status,created_at,updated_at)
      SELECT ?,?,'reserved',?,? WHERE EXISTS (
        SELECT 1 FROM analyses WHERE id=? AND owner_type=? AND owner_id=? AND status='created'
      )`).bind(analysisId, bytes, now, now, analysisId, owner.type, owner.id);
  }

  async #getOwnedAnalysis(id, owner) {
    const row = await this.db.prepare("SELECT * FROM analyses WHERE id=?").bind(id).first();
    invariant(row, "ANALYSIS_NOT_FOUND", "分析任务不存在", 404);
    invariant(row.owner_type === owner.type && row.owner_id === owner.id, "FORBIDDEN", "无权访问该分析任务", 403);
    return toAnalysis(row);
  }
}
