import { logEvent } from "./logger.js";
import { D1Repository } from "./repository.js";
import { dispatchWorkflow } from "./workflow-dispatch.js";

// Wrangler 的 queues.consumers.max_retries 当前为 2：首投之后最多再投递两次。
// Cloudflare Message.attempts 统计包含首投在内的总投递次数，因此第 3 次是进入 DLQ 前的最后一次可用 delivery。
const QUEUE_MAX_RETRIES = 2;
const FINAL_QUEUE_DELIVERY_ATTEMPT = QUEUE_MAX_RETRIES + 1;

/** Queue 消息只携带引用；重复、乱序或旧 attempt 会被确认并忽略。 */
export async function consumeAnalysisQueue(batch, env, repository = new D1Repository(env.DB)) {
  for (const message of batch.messages) {
    const payload = message.body ?? {};
    try {
      const current = await repository.getAnalysis(payload.analysisId);
      if (!current || current.status !== "uploaded" || payload.attempt !== current.attempt + 1) {
        logEvent("info", "queue.analysis_ignored", { analysisId: payload.analysisId,
          attempt: payload.attempt, status: current?.status ?? "missing" });
        message.ack();
        continue;
      }
      await dispatchWorkflow(env.ANALYSIS_WORKFLOW, payload);
      message.ack();
    } catch (error) {
      await retryOrPersistFinalDispatchFailure(message, payload, error, repository);
    }
  }
}

/**
 * 最后一轮 delivery 失败时先把 D1 outbox 迁移为 failed，再 retry 让 Cloudflare 将同一引用送往 DLQ。
 * 若 D1 本身不可写则 ack 原消息并保留 uploaded outbox，由 Cron 补投，避免产生无法在后台诊断的 DLQ 孤儿。
 */
async function retryOrPersistFinalDispatchFailure(message, payload, error, repository) {
  const attempts = deliveryAttempts(message);
  const details = { analysisId: payload.analysisId, attempt: payload.attempt, attempts,
    errorCode: "QUEUE_DISPATCH_FAILED", retryable: true };
  if (attempts < FINAL_QUEUE_DELIVERY_ATTEMPT) {
    logEvent("error", "queue.analysis_dispatch_retry", details);
    message.retry();
    return;
  }
  try {
    const persisted = await persistFinalDispatchFailure(repository, payload, attempts);
    if (persisted) {
      logEvent("error", "queue.analysis_dispatch_exhausted", details);
      message.retry();
      return;
    }
    logEvent("info", "queue.analysis_dispatch_superseded", details);
  } catch (persistenceError) {
    // 此时不能再把消息送入 DLQ：D1 尚未留下原因，Cron 会依据 uploaded outbox 安全补投。
    logEvent("error", "queue.analysis_dispatch_persist_failed", { ...details,
      persistenceErrorCode: persistenceError?.code ?? "D1_PERSIST_FAILED" });
  }
  message.ack();
}

/** 只有仍属于当前 outbox attempt 的 uploaded 任务可以被最终 delivery 标记为失败。 */
async function persistFinalDispatchFailure(repository, payload, attempts) {
  const current = await repository.getAnalysis(payload.analysisId);
  if (!current || current.status !== "uploaded" || payload.attempt !== current.attempt + 1) return false;
  await repository.transition(payload.analysisId, ["uploaded"], "failed", {
    // 该 attempt 尚未创建 Workflow，但已耗尽 Queue delivery；计入统一上限，避免管理员无限补投。
    attempt: payload.attempt,
    error_code: "QUEUE_DISPATCH_FAILED",
    error_retryable: 1,
    failure_stage: "queue_dispatch",
    failed_at: new Date().toISOString(),
  }, "analysis.queue_dispatch_failed");
  logEvent("info", "queue.analysis_dispatch_failure_persisted", { analysisId: payload.analysisId,
    attempt: payload.attempt, attempts, failureStage: "queue_dispatch" });
  return true;
}

/** 本地 mock 可能不提供 attempts；按首投处理，绝不在未知次数时提前写 terminal failed。 */
function deliveryAttempts(message) {
  const attempts = Number(message.attempts);
  return Number.isInteger(attempts) && attempts > 0 ? attempts : 1;
}
