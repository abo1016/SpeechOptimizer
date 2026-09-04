import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PersistentStore } from "../src/persistent-store.js";

test("PersistentStore 对 refunds Map 执行 flush/load round-trip", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "speechoptimizer-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const original = new PersistentStore(filePath);
  original.refunds.set("refund_local_1", {
    id: "refund_local_1", orderId: "order_local_1", refundRequestId: "refund_request_1",
    acquiringOrderId: "acquiring_order_1", amount: 600, currency: "USD", status: "pending",
  });
  await original.flush();

  const restored = await new PersistentStore(filePath).load();
  assert.deepEqual(restored.refunds.get("refund_local_1"), original.refunds.get("refund_local_1"));
  assert.deepEqual([...restored.refunds.entries()], [...original.refunds.entries()]);
});
