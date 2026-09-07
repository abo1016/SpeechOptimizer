import { audioStorage } from "./storage/index.js";

/**
 * Workflow 的结果落盘必须可重放：D1 可能已经完成状态写入或音频清理，
 * Cloudflare 仍会重试当前 step，因此这里始终以数据库最终态作为幂等依据。
 */
export async function completeAnalysis(env, repository, analysisId, result, storageFactory = audioStorage) {
  const current = await repository.getAnalysis(analysisId);
  if (!current || current.status === "cancelled") return current;
  const completed = current.status === "completed" ? current : await repository.transition(analysisId, ["analyzing"], "completed", {
    result_json: JSON.stringify(result), error_code: null, error_retryable: null, failure_stage: null, failed_at: null,
    completed_at: new Date().toISOString(),
  }, "analysis.completed");
  if ((completed.owner.type === "anonymous" || !completed.retainAudio) && completed.audio?.objectKey) {
    await storageFactory(env).deleteObject(completed.audio.objectKey);
    try {
      return await repository.transition(analysisId, ["completed"], "completed", { audio_key: null }, "analysis.audio_deleted");
    } catch (error) {
      if (error?.code !== "STATE_CONFLICT") throw error;
      const settled = await repository.getAnalysis(analysisId);
      if (settled?.status === "completed" && !settled.audio?.objectKey) return settled;
      throw error;
    }
  }
  return completed;
}
