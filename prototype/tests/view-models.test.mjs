import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, historyRow, reportFeedback, reportMetrics } from "../src/lib/viewModels.js";

test("maps persisted history states without inventing scores", () => {
  const row = historyRow({ id: "analysis-123456", status: "failed", durationMs: 74_000, createdAt: "2026-09-01T00:00:00.000Z" });
  assert.equal(row.title, "Speech take analysis");
  assert.equal(row.duration, "1:14");
  assert.equal(row.statusLabel, "Needs retry");
});

test("maps the nested report contract into visible evidence", () => {
  const payload = { report: { metrics: {
    wordsPerMinute: 142,
    fillers: { total: 3, perMinute: 1.5 },
    longPauses: [{ durationSeconds: 3.4 }],
    effectiveSpeakingSeconds: 38,
    wordCount: 90,
  }, feedback: [{ issue: "A long pause breaks continuity." }] } };
  assert.equal(reportMetrics(payload)[0].value, 142);
  assert.equal(reportMetrics(payload)[3].value, "0:38");
  assert.deepEqual(reportFeedback(payload), payload.report.feedback);
  assert.equal(formatDuration(null), "--");
});
