import { logEvent } from "./logger.js";

/**
 * 将 uploaded 分析作为 D1 持久化 outbox 投递给 Queue。
 * 相同 analysisId/attempt 的重复消息会由消费者和固定 Workflow ID 去重，因此调用方可在请求重试或 Cron 中安全补投。
 */
export async function enqueueUploadedAnalysis(env, analysis, source) {
  const payload = { analysisId: analysis.id, attempt: analysis.attempt + 1, version: 1 };
  try {
    await env.ANALYSIS_QUEUE.send(payload);
  } catch (error) {
    logEvent("error", "analysis.queue_enqueue_failed", {
      analysisId: analysis.id,
      attempt: payload.attempt,
      source,
      errorCode: error?.code ?? "QUEUE_SEND_FAILED",
    });
    throw error;
  }
  logEvent("info", "analysis.queued", { analysisId: analysis.id, attempt: payload.attempt, source });
  return payload;
}
