import { logEvent } from "./logger.js";

/** 将 Cloudflare 明确报告的同一实例 ID 已存在视为先前派发成功，Queue 消息可以安全确认。 */
export async function dispatchWorkflow(workflow, payload) {
  const id = `${payload.analysisId}-${payload.attempt}`;
  try {
    await workflow.create({ id, params: payload });
    return "created";
  } catch (error) {
    if (!isExistingWorkflowError(error)) throw error;
    logEvent("info", "queue.workflow_already_exists", { analysisId: payload.analysisId, attempt: payload.attempt });
    return "existing";
  }
}

/**
 * Workflow 的实例 ID 在其保留期内唯一。只有 HTTP 409 与 Cloudflare 的
 * “workflow instance ... already exists” 明确组合才表示同一实例已创建；其他
 * 409 可能是配置、鉴权或业务冲突，必须让 Queue 重试或进入 DLQ。
 */
export function isExistingWorkflowError(error) {
  const status = Number(error?.status ?? error?.code);
  const message = String(error?.message ?? "");
  return status === 409 && /\bworkflow\s+instance\b[\s\S]*\balready\s+exists\b/i.test(message);
}
