import test from "node:test";
import assert from "node:assert/strict";
import { EntitlementService } from "../src/entitlement-service.js";
import { harness } from "./helpers.js";

test("权益按最早过期批次预扣并可确认", () => {
  const base = harness();
  const service = new EntitlementService(base);
  const early = service.grant({ userId: "u1", amount: 5, source: "free", sourceId: "2026-09", expiresAt: 2_000_000 });
  const later = service.grant({ userId: "u1", amount: 30, source: "pack", sourceId: "o1", expiresAt: 3_000_000 });
  const hold = service.reserve({ userId: "u1", amount: 8, referenceId: "analysis-1" });
  assert.deepEqual(hold.allocations, [{ grantId: early.id, amount: 5 }, { grantId: later.id, amount: 3 }]);
  assert.equal(service.balance("u1"), 27);
  service.confirm(hold.id);
  assert.equal(base.store.ledger.at(-1).type, "confirm");
});

test("失败任务返还预扣且重复结束被拒绝", () => {
  const base = harness();
  const service = new EntitlementService(base);
  service.grant({ userId: "u1", amount: 10, source: "free", sourceId: "month" });
  const hold = service.reserve({ userId: "u1", amount: 4, referenceId: "analysis-2" });
  service.release(hold.id, "stt_failed");
  assert.equal(service.balance("u1"), 10);
  assert.throws(() => service.release(hold.id), { code: "HOLD_ALREADY_FINALIZED" });
});

test("相同业务引用的预扣和发放保持幂等", () => {
  const base = harness();
  const service = new EntitlementService(base);
  const first = service.grant({ userId: "u1", amount: 5, source: "billing", sourceId: "order-1" });
  assert.equal(service.grant({ userId: "u1", amount: 5, source: "billing", sourceId: "order-1" }).id, first.id);
  const hold = service.reserve({ userId: "u1", amount: 2, referenceId: "analysis-3" });
  assert.equal(service.reserve({ userId: "u1", amount: 2, referenceId: "analysis-3" }).id, hold.id);
  assert.equal(service.balance("u1"), 3);
});

test("过期权益清零并写入 expire 流水", () => {
  let now = 100;
  const base = harness();
  const service = new EntitlementService({ ...base, clock: () => now });
  service.grant({ userId: "u1", amount: 5, source: "free", sourceId: "month", expiresAt: 110 });
  now = 111;
  assert.deepEqual(service.expire().length, 1);
  assert.equal(service.balance("u1"), 0);
  assert.equal(base.store.ledger.at(-1).type, "expire");
});

test("人工增减和退款撤销均留下可审计流水", () => {
  const base = harness();
  const service = new EntitlementService(base);
  service.adjust({ userId: "u1", amount: 8, reason: "support", actorId: "admin" });
  service.adjust({ userId: "u1", amount: -3, reason: "correction", actorId: "admin" });
  service.grant({ userId: "u1", amount: 30, source: "billing", sourceId: "order:o1" });
  assert.equal(service.revokeSource({ sourceId: "order:o1" }), 30);
  assert.equal(service.balance("u1"), 5);
  assert.deepEqual(base.store.ledger.map((entry) => entry.type), ["grant", "manual_adjustment", "grant", "refund"]);
});

test("余额不足时不产生部分预扣", () => {
  const base = harness();
  const service = new EntitlementService(base);
  service.grant({ userId: "u1", amount: 2, source: "free", sourceId: "month" });
  assert.throws(() => service.reserve({ userId: "u1", amount: 3, referenceId: "analysis" }), { code: "INSUFFICIENT_ENTITLEMENT" });
  assert.equal(service.balance("u1"), 2);
});
