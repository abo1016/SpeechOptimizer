import { calculateMetrics, resolveFeedback, runTranscription }
  from "../../../packages/speech-engine/src/index.js";
import { requireInput } from "./errors.js";

/**
 * 组合层的分析辅助逻辑集中在这里，保持 MvpApplication 只负责业务编排。
 * 这些函数只读或修改调用方传入的本地状态，不自行执行持久化或外部请求。
 */
export function createSpeechProcessor(providers, logger) {
  return {
    transcribe: ({ bytes }) => runTranscription(providers.sttProvider, bytes),
    async analyze({ transcript }) {
      const metrics = calculateMetrics(transcript);
      const feedback = await resolveFeedback(metrics, providers.feedbackProvider, { transcript, logger });
      return { version: "speech-engine/v1", metrics,
        feedback: feedback.items,
        feedbackMetadata: { source: feedback.source, fallbackReason: feedback.fallbackReason ?? null } };
    },
  };
}

export function uploadReference(store, analysis) {
  return analysisAttempt(analysis) === 0 ? analysis.id : nextRetryReference(store, analysis);
}

export function nextRetryReference(store, analysis) {
  const prefix = `${analysis.id}:retry:${nextAnalysisAttempt(analysis)}:`;
  const retries = [...store.holds.values()].filter((hold) => hold.referenceId?.startsWith(prefix));
  const reserved = [...retries].reverse().find((hold) => hold.status === "reserved");
  if (reserved) return reserved.referenceId;
  // 权益服务按 referenceId 幂等；同一次分析尝试里，已释放引用不能再次用于新的预扣。
  const sequence = retries.reduce((latest, hold) => Math.max(
    latest,
    Number(hold.referenceId.slice(prefix.length)) || 0,
  ), 0);
  return `${prefix}${sequence + 1}`;
}

export function nextAnalysisAttempt(analysis) {
  return analysisAttempt(analysis) + 1;
}

export function findReservedHold(store, analysisId) {
  return [...store.holds.values()].reverse().find((hold) => hold.status === "reserved"
    && belongsToAnalysis(hold, analysisId));
}

export function findConfirmedHold(store, analysisId) {
  return [...store.holds.values()].reverse().find((hold) => hold.status === "confirmed"
    && belongsToAnalysis(hold, analysisId));
}

export function isUsageDenied(error) {
  return ["ANONYMOUS_TRIAL_USED", "ANONYMOUS_DURATION_EXCEEDED", "INSUFFICIENT_ENTITLEMENT"].includes(error.code);
}

export function hasPersistedUsage(summary, owner) {
  return sameOwner(summary?.owner, owner)
    && ["uploaded", "transcribing", "analyzing", "completed"].includes(summary.status);
}

export function sameOwner(left, right) {
  return left?.type === right?.type && left?.id === right?.id;
}

export function removeMapRows(map, predicate) {
  for (const [key, row] of map.entries()) if (predicate(row)) map.delete(key);
}

function analysisAttempt(analysis) {
  requireInput(Number.isInteger(analysis.attempt) && analysis.attempt >= 0,
    "ANALYSIS_ATTEMPT_INVALID", "任务尝试次数无效", 409);
  return analysis.attempt;
}

function belongsToAnalysis(hold, analysisId) {
  return hold.referenceId === analysisId || hold.referenceId?.startsWith(`${analysisId}:retry:`);
}
