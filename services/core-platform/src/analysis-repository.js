import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";

/** 持久化任务、幂等映射和最小审计事件。 */
export class AnalysisRepository {
  constructor({ database, clock = () => new Date() }) {
    this.database = database;
    this.clock = clock;
  }

  async create({ idempotencyKey, fingerprint, owner, retainAudio }) {
    return this.database.write((data) => {
      const existing = data.idempotency[idempotencyKey];
      if (existing) return this.#resolveIdempotency(data, existing, fingerprint);
      const now = this.clock().toISOString();
      const row = this.#newRow({ owner, retainAudio, now });
      data.analyses[row.id] = row;
      data.idempotency[idempotencyKey] = { analysisId: row.id, fingerprint };
      this.#audit(data, row, "analysis.created", now);
      return { analysis: row, duplicate: false };
    });
  }

  async get(id) {
    return this.database.read((data) => data.analyses[id] ?? null);
  }

  async list() {
    return this.database.read((data) => Object.values(data.analyses));
  }

  async update(id, updater, action) {
    return this.database.write((data) => {
      const current = data.analyses[id];
      if (!current) fail("分析任务不存在", "ANALYSIS_NOT_FOUND", 404);
      const now = this.clock().toISOString();
      const next = { ...updater(structuredClone(current)), updatedAt: now };
      data.analyses[id] = next;
      this.#audit(data, next, action, now);
      return next;
    });
  }

  async delete(id, action = "analysis.deleted") {
    return this.database.write((data) => {
      const row = data.analyses[id];
      if (!row) return null;
      delete data.analyses[id];
      this.#removeIdempotency(data, id);
      this.#audit(data, row, action, this.clock().toISOString());
      return row;
    });
  }

  async listByAccount(accountId) {
    return this.database.read((data) => Object.values(data.analyses)
      .filter((row) => row.owner.type === "account" && row.owner.id === accountId));
  }

  async listAudits(filter = {}) {
    return this.database.read((data) => data.audits.filter((event) => (
      (!filter.analysisId || event.analysisId === filter.analysisId)
      && (!filter.accountId || event.accountId === filter.accountId)
    )));
  }

  async purgeAccountAudits(accountId) {
    return this.database.write((data) => {
      const before = data.audits.length;
      data.audits = data.audits.filter((event) => event.accountId !== accountId);
      return { deleted: before - data.audits.length };
    });
  }

  #newRow({ owner, retainAudio, now }) {
    return {
      id: randomUUID(), owner, retainAudio, status: "created", attempt: 0,
      audio: null, result: null, error: null,
      createdAt: now, updatedAt: now, completedAt: null,
    };
  }

  #resolveIdempotency(data, existing, fingerprint) {
    if (existing.fingerprint !== fingerprint) {
      fail("幂等键已被不同请求使用", "IDEMPOTENCY_CONFLICT", 409);
    }
    return { analysis: data.analyses[existing.analysisId], duplicate: true };
  }

  #removeIdempotency(data, analysisId) {
    for (const [key, value] of Object.entries(data.idempotency)) {
      if (value.analysisId === analysisId) delete data.idempotency[key];
    }
  }

  #audit(data, row, action, timestamp) {
    data.audits.push({
      eventId: randomUUID(), analysisId: row.id, accountId: row.owner.id ?? null,
      ownerType: row.owner.type, action, status: row.status, timestamp,
    });
  }
}
