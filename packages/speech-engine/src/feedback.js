import { SpeechEngineError, isAbortError } from "./errors.js";
import { runWithTimeout } from "./timeout.js";

const UNSAFE_CLAIM_PATTERN = /\b(depressed|depression|anxious|anxiety|disorder|diagnos(?:e|is)|personality|introvert|extrovert|mental illness|adhd|autis(?:m|tic)|bipolar)\b/i;
const PRIORITIES = new Set(["high", "medium", "low"]);
// 这些阈值仅触发可观察的表达建议，不用于推断心理、人格或医疗状态。
const FAST_PACE_WPM = 175;
const MIN_FILLER_COUNT = 2;
const MAX_FEEDBACK_ITEMS = 3;
const MAX_FILLER_EXAMPLES = 2;
const DEFAULT_FEEDBACK_TIMEOUT_MS = 10_000;

function formatSeconds(seconds) {
  return `${seconds.toFixed(1)}s`;
}

function lowConfidenceFeedback(metrics) {
  const segment = metrics.lowConfidenceSegments[0];
  if (!segment) return null;
  return {
    priority: "high",
    issue: "A passage could not be transcribed reliably.",
    evidence: `Low-confidence words appear from ${formatSeconds(segment.startSeconds)} to ${formatSeconds(segment.endSeconds)}.`,
    revision: "Repeat that passage with clearer spacing and keep the microphone distance steady.",
    rerecordPrompt: "Rerecord the unclear passage once, keeping each phrase distinct.",
  };
}

function paceFeedback(metrics) {
  if (metrics.wordsPerMinute <= FAST_PACE_WPM) return null;
  return {
    priority: "high",
    issue: "The delivery is too fast for easy scanning.",
    evidence: `The measured pace is ${metrics.wordsPerMinute} words per minute.`,
    revision: "Shorten long sentences and add a brief beat after each key point.",
    rerecordPrompt: "Deliver the same points near 130-160 words per minute without cutting content.",
  };
}

function fillerFeedback(metrics) {
  if (metrics.fillers.total < MIN_FILLER_COUNT) return null;
  const examples = metrics.fillers.occurrences.slice(0, MAX_FILLER_EXAMPLES).map((item) => `${item.phrase} at ${formatSeconds(item.atSeconds)}`);
  return {
    priority: "medium",
    issue: "Repeated filler words interrupt the message.",
    evidence: `${metrics.fillers.total} fillers were found, including ${examples.join(" and ")}.`,
    revision: "Replace each filler with a silent beat before the next clause.",
    rerecordPrompt: "Rerecord while pausing silently whenever a filler would normally appear.",
  };
}

function pauseOrRepeatFeedback(metrics) {
  if (metrics.longPauses.length) {
    const pause = metrics.longPauses[0];
    return {
      priority: "medium",
      issue: "A long pause breaks continuity.",
      evidence: `A ${pause.durationSeconds.toFixed(1)}s pause starts at ${formatSeconds(pause.startSeconds)}.`,
      revision: "Use a short transition phrase or reduce the pause to a deliberate beat.",
      rerecordPrompt: "Connect the ideas around that timestamp in one continuous thought.",
    };
  }
  const repeated = metrics.repeatedPhrases[0];
  if (!repeated) return null;
  return {
    priority: "low",
    issue: "A phrase is repeated without adding detail.",
    evidence: `“${repeated.phrase}” appears ${repeated.count} times.`,
    revision: "Keep the clearest occurrence and replace the others with specific evidence.",
    rerecordPrompt: "State the point once, then move directly to an example.",
  };
}

export function createDeterministicFeedback(metrics) {
  return [
    lowConfidenceFeedback(metrics),
    paceFeedback(metrics),
    fillerFeedback(metrics),
    pauseOrRepeatFeedback(metrics),
  ].filter(Boolean).slice(0, MAX_FEEDBACK_ITEMS);
}

function validateFeedbackItem(item, index) {
  const fields = ["issue", "evidence", "revision", "rerecordPrompt"];
  if (!item || !PRIORITIES.has(item.priority)) {
    throw new SpeechEngineError("INVALID_FEEDBACK", `feedback[${index}].priority 无效`);
  }
  for (const field of fields) {
    if (typeof item[field] !== "string" || !item[field].trim()) {
      throw new SpeechEngineError("INVALID_FEEDBACK", `feedback[${index}].${field} 无效`);
    }
    if (UNSAFE_CLAIM_PATTERN.test(item[field])) {
      throw new SpeechEngineError("UNSAFE_FEEDBACK", "反馈包含禁止的心理、人格或医疗判断");
    }
  }
}

export function validateFeedback(feedback) {
  if (!Array.isArray(feedback) || feedback.length > MAX_FEEDBACK_ITEMS) {
    throw new SpeechEngineError("INVALID_FEEDBACK", "结构化反馈必须是最多三条的数组");
  }
  feedback.forEach(validateFeedbackItem);
  return feedback;
}

export async function resolveFeedback(metrics, provider, options = {}) {
  const fallback = createDeterministicFeedback(metrics);
  if (!provider) return { items: fallback, source: "deterministic", estimatedCostUsd: 0, processingDurationMs: 0 };
  const timeoutMs = options.timeoutMs ?? DEFAULT_FEEDBACK_TIMEOUT_MS;
  const startedAt = performance.now();
  try {
    assertFeedbackProvider(provider);
    const result = await runWithTimeout(
      (signal) => provider.generate({ metrics, transcript: options.transcript }, { signal }),
      timeoutMs,
      "Feedback timeout",
    );
    const items = validateFeedback(result?.items);
    validateUsage(result);
    return {
      items,
      source: provider.name,
      estimatedCostUsd: result.estimatedCostUsd ?? 0,
      processingDurationMs: result.processingDurationMs ?? Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    const reason = isAbortError(error) ? "timeout" : error.code ?? "provider_error";
    options.logger?.warn?.("[speech-engine] 外部反馈不可用，使用确定性反馈", { reason });
    return { items: fallback, source: "deterministic-fallback", fallbackReason: reason, estimatedCostUsd: 0, processingDurationMs: Math.round(performance.now() - startedAt) };
  }
}

function assertFeedbackProvider(provider) {
  if (typeof provider.name !== "string" || !provider.name || typeof provider.generate !== "function") {
    throw new SpeechEngineError("INVALID_FEEDBACK_PROVIDER", "反馈 provider 必须提供 name 和 generate");
  }
}

function validateUsage(result) {
  for (const field of ["estimatedCostUsd", "processingDurationMs"]) {
    const value = result?.[field] ?? 0;
    if (!Number.isFinite(value) || value < 0) {
      throw new SpeechEngineError("INVALID_FEEDBACK", `feedback.${field} 无效`);
    }
  }
}
