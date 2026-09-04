import assert from "node:assert/strict";
import test from "node:test";
import { analysisStep, pollAnalysis } from "../src/lib/analysisFlow.js";

test("polls until a terminal status and reports every server state", async () => {
  const states = ["uploaded", "transcribing", "analyzing", "completed"];
  const seen = [];
  const final = await pollAnalysis("a1", {
    read: async () => ({ id: "a1", status: states.shift() }),
    wait: async () => undefined,
    onUpdate: (analysis) => seen.push(analysis.status),
  });
  assert.equal(final.status, "completed");
  assert.deepEqual(seen, ["uploaded", "transcribing", "analyzing", "completed"]);
});

test("stops before another request when polling is aborted", async () => {
  const controller = new AbortController();
  let reads = 0;
  await assert.rejects(pollAnalysis("a1", {
    signal: controller.signal,
    read: async () => { reads += 1; return { status: "uploaded" }; },
    wait: async () => controller.abort(new DOMException("Stopped", "AbortError")),
  }), { name: "AbortError" });
  assert.equal(reads, 1);
});

test("maps server states to stable progress steps", () => {
  assert.equal(analysisStep("uploaded"), 0);
  assert.equal(analysisStep("transcribing"), 1);
  assert.equal(analysisStep("analyzing"), 2);
  assert.equal(analysisStep("completed"), 2);
});
