import { D1Repository } from "./repository.js";
import { audioStorage } from "./storage/index.js";
import { enqueueUploadedAnalysis } from "./queue-dispatch.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 每日对账实际对象，同时回收 D1 已删除的孤儿和超过产品保留期的音频。 */
export async function cleanupAudioStorage(env) {
  const repository = new D1Repository(env.DB);
  const storage = audioStorage(env);
  const accountDeletions = await resumeAccountDeletions(env, repository);
  const dispatchRecovery = await recoverUploadedDispatches(env, repository);
  let totalBytes = 0;
  let deleted = 0;
  for (const object of await storage.listObjects("audio/")) {
    const analysisId = object.key.split("/")[2];
    const analysis = analysisId ? await repository.getAnalysis(analysisId) : null;
    if (shouldDelete(object, analysis)) {
      await storage.deleteObject(object.key);
      if (analysis) await repository.clearAudioKey(analysis.id);
      deleted += 1;
    } else totalBytes += Number(object.size ?? 0);
  }
  // 未上传的 signed URL 仍持有预占，不能用对象列表的实际大小直接覆盖容量硬护栏。
  await repository.reconcileStorageQuota(totalBytes);
  const retention = await repository.cleanupExpiredRecords();
  console.info(JSON.stringify({ event: "storage.cleanup_completed", totalBytes, deleted, retention, accountDeletions,
    dispatchRecovery }));
  return { totalBytes, deleted, retention, accountDeletions, dispatchRecovery };
}

/** 禁用账户的删除任务可跨请求重试；只有每个 D1 音频引用都已清空后才删除账户行。 */
export async function purgeDisabledAccount(userId, env, repository) {
  const storage = audioStorage(env);
  let cursor;
  let analyses = 0;
  do {
    const page = await repository.listOwned({ type: "account", id: userId }, { limit: 100, cursor });
    for (const analysis of page.items) {
      const pendingKey = await repository.getPendingUploadObjectKey(analysis.id, { type: "account", id: userId });
      if (analysis.audio?.objectKey) {
        await storage.deleteObject(analysis.audio.objectKey);
        await repository.clearAudioKey(analysis.id);
      }
      if (pendingKey) {
        await storage.deleteObject(pendingKey);
        await repository.clearUploadTicket(analysis.id, pendingKey);
      }
      // 已确认、待确认和无对象的任务都可能持有 reservation；重复释放由 D1 条件更新吸收。
      await repository.releaseStorage(analysis.id);
      analyses += 1;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const finalized = await repository.finalizeAccountDeletion(userId);
  return { analyses: finalized.analyses || analyses };
}

async function resumeAccountDeletions(env, repository) {
  const userIds = await repository.listPendingAccountDeletions();
  const results = [];
  for (const userId of userIds) {
    try {
      const outcome = await purgeDisabledAccount(userId, env, repository);
      results.push({ userId, ...outcome, completed: true });
    } catch (error) {
      // 单个 Provider 删除失败不阻断其他用户，下一次 Cron 会继续读取同一禁用账户的剩余引用。
      console.error(JSON.stringify({ event: "account.deletion_retry_failed", userId, errorName: error?.name ?? "Error" }));
      results.push({ userId, completed: false });
    }
  }
  return results;
}

/**
 * Queue.send 与 D1 不能跨资源原子提交。uploaded 因而保留为持久化 outbox：
 * 首次投递失败、响应中断或客户端未重试时，Cron 会安全补发同一 analysisId/attempt。
 */
export async function recoverUploadedDispatches(env, repository) {
  const analyses = await repository.listUploadedForDispatch();
  let queued = 0;
  for (const analysis of analyses) {
    try {
      await enqueueUploadedAnalysis(env, analysis, "scheduled_recovery");
      queued += 1;
    } catch (error) {
      console.error(JSON.stringify({ event: "analysis.queue_recovery_failed", analysisId: analysis.id,
        errorCode: error?.code ?? "QUEUE_SEND_FAILED" }));
    }
  }
  return { pending: analyses.length, queued };
}

export function shouldDelete(object, analysis) {
  if (!analysis) return true;
  const ageMs = Date.now() - new Date(object.uploaded).getTime();
  if (analysis.status === "cancelled") return true;
  if (analysis.status === "failed") return ageMs >= DAY_MS;
  if (analysis.status === "completed" && (analysis.owner.type === "anonymous" || !analysis.retainAudio)) return true;
  if (analysis.status === "completed" && analysis.retainAudio) return ageMs >= 3 * DAY_MS;
  return false;
}
