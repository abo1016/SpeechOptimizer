import assert from "node:assert/strict";
import test from "node:test";
import { compareTakes } from "../src/index.js";

function analysis(overrides = {}) {
  return {
    feedback: [{ issue: "A phrase repeats." }],
    metrics: {
      totalDurationSeconds: 60,
      effectiveSpeakingSeconds: 42,
      wordCount: 110,
      wordsPerMinute: 190,
      fillers: { total: 8, perMinute: 8, occurrences: [] },
      longPauses: [{ durationSeconds: 4 }],
      repeatedPhrases: [{ phrase: "the main point", count: 2 }],
      sentenceLengths: { count: 5, averageWords: 22, maximumWords: 30, values: [] },
      lowConfidenceSegments: [],
      ...overrides,
    },
  };
}

test("多项归一化指标改善且无回退时判定改善", () => {
  const before = analysis();
  const after = analysis({
    wordsPerMinute: 155,
    fillers: { total: 2, perMinute: 2, occurrences: [] },
    longPauses: [],
    repeatedPhrases: [],
  });
  const result = compareTakes(before, after);
  assert.equal(result.status, "improved");
  assert.equal(result.metrics.paceDistance.outcome, "improved");
  assert.equal(result.metrics.fillerRate.outcome, "improved");
  assert.deepEqual(result.feedbackChanges.persisting, ["A phrase repeats."]);
});

test("仅仅缩短录音不会被判定为改善", () => {
  const before = analysis();
  const after = analysis({ totalDurationSeconds: 48, wordCount: 88 });
  const result = compareTakes(before, after);
  assert.equal(result.status, "no_meaningful_change");
});

test("时长或内容规模差异过大时判定不可比较", () => {
  const result = compareTakes(analysis(), analysis({ totalDurationSeconds: 30, wordCount: 45 }));
  assert.equal(result.status, "not_comparable");
  assert.equal(result.reason, "DURATION_MISMATCH");
});

test("改善与回退混合时判定无明显变化", () => {
  const after = analysis({
    wordsPerMinute: 155,
    fillers: { total: 12, perMinute: 12, occurrences: [] },
  });
  assert.equal(compareTakes(analysis(), after).status, "no_meaningful_change");
});

test("比较结果列出已解决、持续和新增的结构化反馈", () => {
  const before = analysis();
  const after = analysis();
  before.feedback = [{ issue: "A phrase repeats." }, { issue: "A long pause breaks continuity." }];
  after.feedback = [{ issue: "A phrase repeats." }, { issue: "The delivery is too fast." }];
  assert.deepEqual(compareTakes(before, after).feedbackChanges, {
    resolved: ["A long pause breaks continuity."],
    persisting: ["A phrase repeats."],
    introduced: ["The delivery is too fast."],
  });
});
