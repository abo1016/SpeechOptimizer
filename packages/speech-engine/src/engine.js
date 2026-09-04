import { performance } from "node:perf_hooks";
import { resolveFeedback } from "./feedback.js";
import { calculateMetrics } from "./metrics.js";
import { runTranscription } from "./stt.js";

const DEFAULT_LOGGER = {
  info: (message, details) => console.info(message, details),
  warn: (message, details) => console.warn(message, details),
  error: (message, details) => console.error(message, details),
};

// 成本统一保留到百万分之一美元，两分钟口径与 MVP 计划中的预算门禁一致。
const COST_SCALE = 1_000_000;
const COST_BUDGET_DURATION_SECONDS = 120;

function createUsage(transcript, feedback, totalProcessingDurationMs) {
  const sttCost = transcript.estimatedCostUsd;
  const feedbackCost = feedback.estimatedCostUsd;
  const twoMinuteSttCost = sttCost * (COST_BUDGET_DURATION_SECONDS / transcript.durationSeconds);
  return {
    estimatedCostUsd: Math.round((sttCost + feedbackCost) * COST_SCALE) / COST_SCALE,
    estimatedTwoMinuteCostUsd: Math.round((twoMinuteSttCost + feedbackCost) * COST_SCALE) / COST_SCALE,
    processingDurationMs: totalProcessingDurationMs,
    stages: {
      transcription: { estimatedCostUsd: sttCost, processingDurationMs: transcript.processingDurationMs },
      feedback: { estimatedCostUsd: feedbackCost, processingDurationMs: feedback.processingDurationMs },
    },
  };
}

export async function analyzeSpeech(input, options) {
  const logger = options?.logger ?? DEFAULT_LOGGER;
  const startedAt = performance.now();
  logger.info("[speech-engine] 开始语音分析", { provider: options?.sttProvider?.name ?? "missing" });
  try {
    const transcript = await runTranscription(options?.sttProvider, input, { timeoutMs: options?.sttTimeoutMs });
    logger.info("[speech-engine] 转写完成", { provider: transcript.provider, wordCount: transcript.words.length });
    const metrics = calculateMetrics(transcript, options?.metrics);
    const feedback = await resolveFeedback(metrics, options?.feedbackProvider, {
      timeoutMs: options?.feedbackTimeoutMs,
      logger,
      transcript,
    });
    const processingDurationMs = Math.round(performance.now() - startedAt);
    logger.info("[speech-engine] 分析完成", { processingDurationMs, feedbackSource: feedback.source });
    return {
      version: "speech-engine/v1",
      transcript,
      metrics,
      feedback: feedback.items,
      feedbackMetadata: { source: feedback.source, fallbackReason: feedback.fallbackReason ?? null },
      usage: createUsage(transcript, feedback, processingDurationMs),
    };
  } catch (error) {
    logger.error("[speech-engine] 分析失败", { code: error?.code ?? "UNKNOWN" });
    throw error;
  }
}
