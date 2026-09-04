import { invariant } from "./errors.js";

function activeGrant(grant, unit, now) {
  return grant.unit === unit && grant.remaining > 0
    && (!grant.startsAt || grant.startsAt <= now)
    && (!grant.expiresAt || grant.expiresAt > now);
}

/** 权益服务以追加流水记录每次变化，余额只是可重建的读模型。 */
export class EntitlementService {
  constructor({ store, clock = () => Date.now(), id, logger = console }) {
    this.store = store;
    this.clock = clock;
    this.id = id;
    this.logger = logger;
  }

  grant({ userId, unit = "minute", amount, source, sourceId, startsAt = null, expiresAt = null }) {
    invariant(Number.isInteger(amount) && amount > 0, "INVALID_GRANT", "发放数量必须为正整数");
    invariant(!startsAt || !expiresAt || startsAt < expiresAt, "INVALID_GRANT_WINDOW", "权益生效时间必须早于过期时间");
    const duplicate = [...this.store.grants.values()].find((item) => item.source === source && item.sourceId === sourceId && item.unit === unit);
    if (duplicate) return duplicate;
    // startsAt 允许年付订阅预先写入未来 12 个自然月批次；未到生效时间的批次不会进入可用余额。
    const grant = { id: this.id(), userId, unit, amount, remaining: amount, source, sourceId,
      startsAt, expiresAt, createdAt: this.clock() };
    this.store.grants.set(grant.id, grant);
    this.#append(userId, unit, amount, "grant", sourceId, { grantId: grant.id });
    this.logger.info?.(`[entitlement] granted userId=${userId} unit=${unit} amount=${amount}`);
    return grant;
  }

  balance(userId, unit = "minute") {
    const now = this.clock();
    return [...this.store.grants.values()].filter((grant) => grant.userId === userId && activeGrant(grant, unit, now))
      .reduce((sum, grant) => sum + grant.remaining, 0);
  }

  sourceSummary(sourceId) {
    const grants = [...this.store.grants.values()].filter((grant) => grant.sourceId === sourceId);
    return grants.reduce((summary, grant) => ({
      granted: summary.granted + grant.amount,
      remaining: summary.remaining + grant.remaining,
    }), { granted: 0, remaining: 0 });
  }

  reserve({ userId, unit = "minute", amount, referenceId }) {
    invariant(Number.isInteger(amount) && amount > 0, "INVALID_RESERVATION", "预扣数量必须为正整数");
    const existing = [...this.store.holds.values()].find((hold) => hold.referenceId === referenceId && hold.userId === userId);
    if (existing) return existing;
    invariant(this.balance(userId, unit) >= amount, "INSUFFICIENT_ENTITLEMENT", "可用权益不足");
    const allocations = this.#allocate(userId, unit, amount);
    const hold = { id: this.id(), userId, unit, amount, referenceId, allocations, status: "reserved", createdAt: this.clock() };
    this.store.holds.set(hold.id, hold);
    this.#append(userId, unit, -amount, "reserve", referenceId, { holdId: hold.id });
    this.logger.info?.(`[entitlement] reserved userId=${userId} amount=${amount} referenceId=${referenceId}`);
    return hold;
  }

  confirm(holdId) {
    const hold = this.#openHold(holdId);
    hold.status = "confirmed";
    hold.confirmedAt = this.clock();
    this.#append(hold.userId, hold.unit, 0, "confirm", hold.referenceId, { holdId });
    this.logger.info?.(`[entitlement] confirmed holdId=${holdId}`);
    return hold;
  }

  release(holdId, reason = "processing_failed") {
    const hold = this.#openHold(holdId);
    for (const allocation of hold.allocations) this.store.grants.get(allocation.grantId).remaining += allocation.amount;
    hold.status = "released";
    hold.releasedAt = this.clock();
    this.#append(hold.userId, hold.unit, hold.amount, "release", hold.referenceId, { holdId, reason });
    this.logger.info?.(`[entitlement] released holdId=${holdId} reason=${reason}`);
    return hold;
  }

  expire() {
    const expired = [];
    for (const grant of this.store.grants.values()) {
      if (grant.expiresAt && grant.expiresAt <= this.clock() && grant.remaining > 0) {
        const amount = grant.remaining;
        grant.remaining = 0;
        this.#append(grant.userId, grant.unit, -amount, "expire", grant.sourceId, { grantId: grant.id });
        expired.push(grant.id);
      }
    }
    return expired;
  }

  adjust({ userId, unit = "minute", amount, reason, actorId }) {
    invariant(Number.isInteger(amount) && amount !== 0, "INVALID_ADJUSTMENT", "调整数量必须为非零整数");
    if (amount > 0) return this.grant({ userId, unit, amount, source: "manual", sourceId: `${actorId}:${this.id()}` });
    invariant(this.balance(userId, unit) >= -amount, "INSUFFICIENT_ENTITLEMENT", "扣减权益超过可用余额");
    this.#allocate(userId, unit, -amount);
    return this.#append(userId, unit, amount, "manual_adjustment", reason, { actorId });
  }

  revokeSource({ sourceId, reason = "refund" }) {
    let revoked = 0;
    for (const grant of this.store.grants.values()) {
      if (grant.sourceId !== sourceId || grant.remaining === 0) continue;
      revoked += grant.remaining;
      this.#append(grant.userId, grant.unit, -grant.remaining, reason, sourceId, { grantId: grant.id });
      grant.remaining = 0;
    }
    return revoked;
  }

  #allocate(userId, unit, amount) {
    const grants = [...this.store.grants.values()].filter((grant) => grant.userId === userId && activeGrant(grant, unit, this.clock()))
      .sort((left, right) => (left.expiresAt ?? Infinity) - (right.expiresAt ?? Infinity));
    let remaining = amount;
    const allocations = [];
    for (const grant of grants) {
      const used = Math.min(grant.remaining, remaining);
      if (used > 0) allocations.push({ grantId: grant.id, amount: used });
      grant.remaining -= used;
      remaining -= used;
      if (remaining === 0) break;
    }
    return allocations;
  }

  #openHold(holdId) {
    const hold = this.store.holds.get(holdId);
    invariant(hold, "HOLD_NOT_FOUND", "预扣记录不存在");
    invariant(hold.status === "reserved", "HOLD_ALREADY_FINALIZED", "预扣记录已结束");
    return hold;
  }

  #append(userId, unit, amount, type, referenceId, metadata = {}) {
    const entry = { id: this.id(), userId, unit, amount, type, referenceId, metadata, createdAt: this.clock() };
    this.store.ledger.push(entry);
    return entry;
  }
}
