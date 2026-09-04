function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function ratio(left, right) {
  return right === 0 ? Number.POSITIVE_INFINITY : left / right;
}

function paceDistance(wordsPerMinute) {
  if (wordsPerMinute < TARGET_PACE_MIN_WPM) return TARGET_PACE_MIN_WPM - wordsPerMinute;
  if (wordsPerMinute > TARGET_PACE_MAX_WPM) return wordsPerMinute - TARGET_PACE_MAX_WPM;
  return 0;
}

function normalizedCount(count, durationSeconds) {
  return durationSeconds > 0 ? count / (durationSeconds / 60) : 0;
}

function classifyDelta(before, after, { lowerIsBetter, minimumChange }) {
  const delta = round(after - before);
  if (Math.abs(delta) < minimumChange) return { outcome: "unchanged", before, after, delta };
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return { outcome: improved ? "improved" : "regressed", before, after, delta };
}

function compareMetricSet(before, after) {
  const beforeDuration = before.totalDurationSeconds;
  const afterDuration = after.totalDurationSeconds;
  return {
    paceDistance: classifyDelta(paceDistance(before.wordsPerMinute), paceDistance(after.wordsPerMinute), {
      lowerIsBetter: true,
      minimumChange: MIN_PACE_CHANGE_WPM,
    }),
    fillerRate: classifyDelta(before.fillers.perMinute, after.fillers.perMinute, {
      lowerIsBetter: true,
      minimumChange: MIN_FILLER_CHANGE_PER_MINUTE,
    }),
    longPauseRate: classifyDelta(
      normalizedCount(before.longPauses.length, beforeDuration),
      normalizedCount(after.longPauses.length, afterDuration),
      { lowerIsBetter: true, minimumChange: MIN_RATE_CHANGE_PER_MINUTE },
    ),
    repeatedPhraseRate: classifyDelta(
      normalizedCount(before.repeatedPhrases.length, beforeDuration),
      normalizedCount(after.repeatedPhrases.length, afterDuration),
      { lowerIsBetter: true, minimumChange: MIN_RATE_CHANGE_PER_MINUTE },
    ),
  };
}

function compareFeedback(beforeItems = [], afterItems = []) {
  const before = new Set(beforeItems.map((item) => item.issue.trim().toLowerCase()));
  const after = new Set(afterItems.map((item) => item.issue.trim().toLowerCase()));
  return {
    resolved: beforeItems.filter((item) => !after.has(item.issue.trim().toLowerCase())).map((item) => item.issue),
    persisting: beforeItems.filter((item) => after.has(item.issue.trim().toLowerCase())).map((item) => item.issue),
    introduced: afterItems.filter((item) => !before.has(item.issue.trim().toLowerCase())).map((item) => item.issue),
  };
}

function getIncomparabilityReason(before, after) {
  if (before.wordCount < MIN_COMPARABLE_WORDS || after.wordCount < MIN_COMPARABLE_WORDS) return "TOO_FEW_WORDS";
  const durationRatio = ratio(after.totalDurationSeconds, before.totalDurationSeconds);
  const wordRatio = ratio(after.wordCount, before.wordCount);
  if (durationRatio < MIN_DURATION_RATIO || durationRatio > MAX_DURATION_RATIO) return "DURATION_MISMATCH";
  if (wordRatio < MIN_WORD_RATIO || wordRatio > MAX_WORD_RATIO) return "CONTENT_LENGTH_MISMATCH";
  return null;
}

export function compareTakes(beforeAnalysis, afterAnalysis) {
  const before = beforeAnalysis.metrics;
  const after = afterAnalysis.metrics;
  const reason = getIncomparabilityReason(before, after);
  if (reason) {
    return { status: "not_comparable", reason, metrics: null, feedbackChanges: null, summary: "The two takes are too different for a fair comparison." };
  }
  const metrics = compareMetricSet(before, after);
  const feedbackChanges = compareFeedback(beforeAnalysis.feedback, afterAnalysis.feedback);
  const outcomes = Object.values(metrics).map((metric) => metric.outcome);
  const improvements = outcomes.filter((outcome) => outcome === "improved").length;
  const regressions = outcomes.filter((outcome) => outcome === "regressed").length;
  const status = improvements >= MIN_IMPROVED_METRICS && regressions === 0 ? "improved" : "no_meaningful_change";
  const summary = status === "improved"
    ? "The second take improves multiple normalized delivery measures without a measured regression."
    : "The measured changes are mixed or too small to count as a clear improvement.";
  return { status, reason: null, metrics, feedbackChanges, summary };
}
// 可比较性和改善阈值属于 MVP 产品口径，集中定义以便后续基于真实样本校准。
const TARGET_PACE_MIN_WPM = 120;
const TARGET_PACE_MAX_WPM = 170;
const MIN_PACE_CHANGE_WPM = 5;
const MIN_RATE_CHANGE_PER_MINUTE = 0.25;
const MIN_FILLER_CHANGE_PER_MINUTE = 0.5;
const MIN_COMPARABLE_WORDS = 10;
const MIN_DURATION_RATIO = 0.65;
const MAX_DURATION_RATIO = 1.5;
const MIN_WORD_RATIO = 0.6;
const MAX_WORD_RATIO = 1.5;
const MIN_IMPROVED_METRICS = 2;
