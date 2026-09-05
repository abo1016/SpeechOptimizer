import { WorkerError, invariant } from "./errors.js";
import { changes, eventStatement, isUniqueViolation, listAnalysisPage, quotaOrAccountError, quotaStatement,
  toAnalysis, updateSql } from "./repository-common.js";

const DISPATCH_PAGE_LIMIT = 100;

/** 分析仓储持有幂等、状态机和面向用户/管理员的分页查询。 */
export class AnalysisRepository {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }

  async createAnalysis({ owner, keyHash, fingerprint, retainAudio, quotaLimits }) {
    const existing = await this.#findIdempotency(owner, keyHash);
    if (existing) return this.#idempotentResult(existing, fingerprint);
    try {
      return await this.#insertAnalysis(owner, keyHash, fingerprint, retainAudio, quotaLimits);
    } catch (error) {
      // 并发首请求可以同时通过初次读取，唯一键冲突后重读完整赢家结果。
      if (isUniqueViolation(error)) {
        const concurrent = await this.#findIdempotency(owner, keyHash);
        if (concurrent) return this.#idempotentResult(concurrent, fingerprint);
      }
      throw quotaOrAccountError(error);
    }
  }

  /** 在消费一次性挑战或限流额度前先返回已有分析，网络重放不会重复计费。 */
  async findIdempotentAnalysis(owner, keyHash, fingerprint) {
    const existing = await this.#findIdempotency(owner, keyHash);
    return existing ? this.#idempotentResult(existing, fingerprint) : null;
  }

  async getAnalysis(id) {
    const row = await this.db.prepare("SELECT * FROM analyses WHERE id=?").bind(id).first();
    return row ? toAnalysis(row) : null;
  }

  async getOwnedAnalysis(id, owner) {
    const analysis = await this.getAnalysis(id);
    if (!analysis) throw new WorkerError("ANALYSIS_NOT_FOUND", "分析任务不存在", 404);
    invariant(analysis.owner.type === owner.type && analysis.owner.id === owner.id, "FORBIDDEN", "无权访问该分析任务", 403);
    return analysis;
  }

  async transition(id, fromStatuses, target, patch = {}, eventType = "analysis." + target) {
    const current = await this.getAnalysis(id);
    if (!current) throw new WorkerError("ANALYSIS_NOT_FOUND", "分析任务不存在", 404);
    invariant(fromStatuses.includes(current.status), "INVALID_STATE_TRANSITION", "当前状态不允许该操作", 409);
    const columns = { ...patch, status: target, updated_at: this.now() };
    const { sql, values } = updateSql(columns, id, current.status);
    const event = eventStatement(this.db, id, current.owner.id, eventType, target, patch.attempt ?? current.attempt, columns.updated_at);
    const [result] = await this.db.batch([this.db.prepare(sql).bind(...values), event]);
    invariant(changes(result) === 1, "STATE_CONFLICT", "任务状态已被其他执行器更新", 409);
    return this.getAnalysis(id);
  }

  async listOwned(owner, options = {}) {
    const { status } = options;
    const conditions = ["owner_type=?", "owner_id=?"];
    const values = [owner.type, owner.id];
    if (status) {
      conditions.push("status=?");
      values.push(status);
    }
    return listAnalysisPage(this.db, conditions, values, options);
  }

  /** 管理页读取 D1 的稳定失败事实，而不是尝试枚举或重放 Cloudflare DLQ 消息。 */
  listFailedForAdmin(options = {}) {
    return listAnalysisPage(this.db, ["status='failed'"], [], options);
  }

  /** uploaded 是持久化 outbox；Cron 以固定上限扫描，避免占满免费 CPU。 */
  async listUploadedForDispatch(limit = DISPATCH_PAGE_LIMIT) {
    const safeLimit = Math.min(Math.max(Number(limit) || DISPATCH_PAGE_LIMIT, 1), DISPATCH_PAGE_LIMIT);
    const rows = await this.db.prepare("SELECT * FROM analyses WHERE status='uploaded' ORDER BY updated_at ASC,id ASC LIMIT ?")
      .bind(safeLimit).all();
    return (rows.results ?? []).map(toAnalysis);
  }

  async deleteAnalysis(id, owner) {
    await this.getOwnedAnalysis(id, owner);
    await this.db.prepare("DELETE FROM analyses WHERE id=?").bind(id).run();
  }

  async #findIdempotency(owner, keyHash) {
    const sql = "SELECT i.fingerprint,a.* FROM idempotency_keys i JOIN analyses a ON a.id=i.analysis_id"
      + " WHERE i.owner_type=? AND i.owner_id=? AND i.key_hash=?";
    return this.db.prepare(sql).bind(owner.type, owner.id, keyHash).first();
  }

  #idempotentResult(existing, fingerprint) {
    invariant(existing.fingerprint === fingerprint, "IDEMPOTENCY_CONFLICT", "幂等键已被不同请求使用", 409);
    return { analysis: toAnalysis(existing), duplicate: true };
  }

  async #insertAnalysis(owner, keyHash, fingerprint, retainAudio, quotaLimits) {
    const id = "ana_" + crypto.randomUUID();
    const now = this.now();
    const analysis = this.db.prepare("INSERT INTO analyses(id,owner_type,owner_id,status,retain_audio,created_at,updated_at)"
      + " VALUES(?,?,?,?,?,?,?)")
      .bind(id, owner.type, owner.id, "created", retainAudio ? 1 : 0, now, now);
    const idempotency = this.db.prepare("INSERT INTO idempotency_keys(owner_type,owner_id,key_hash,fingerprint,analysis_id,created_at)"
      + " VALUES(?,?,?,?,?,?)")
      .bind(owner.type, owner.id, keyHash, fingerprint, id, now);
    const quotas = quotaLimits.map(({ metric, periodKey, limit }) => quotaStatement(this.db, metric, periodKey, limit, now));
    try {
      await this.db.batch([...quotas, analysis, idempotency, eventStatement(this.db, id, owner.id, "analysis.created", "created", 0, now)]);
    } catch (error) {
      throw quotaOrAccountError(error);
    }
    return { analysis: await this.getOwnedAnalysis(id, owner), duplicate: false };
  }
}
