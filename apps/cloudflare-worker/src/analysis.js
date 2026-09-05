import { assertFreeTierAdmission, runtimeConfig } from "./config.js";
import { enforceIpRateLimit, verifyTurnstile } from "./auth.js";
import { invariant } from "./errors.js";
import { logEvent } from "./logger.js";
import { assertAudioDeclaration, assertOwnedKey, audioObjectKey, audioStorage } from "./storage/index.js";
import { sha256Hex } from "./web-crypto.js";
import { purgeDisabledAccount } from "./cleanup.js";
import { enqueueUploadedAnalysis } from "./queue-dispatch.js";

/** 创建分析任务并按身份应用每日免费额度；幂等重复请求不会重复占用额度。 */
export async function createAnalysis(request, input, owner, env, repository) {
  const idempotencyKey = request.headers.get("idempotency-key");
  invariant(idempotencyKey && idempotencyKey.length >= 8, "MISSING_IDEMPOTENCY_KEY", "缺少有效 Idempotency-Key", 400);
  const retainAudio = owner.type === "account" && input.retainAudio === true;
  const keyHash = await sha256Hex(idempotencyKey);
  const fingerprint = await sha256Hex(JSON.stringify({ retainAudio }));
  const replay = await repository.findIdempotentAnalysis(owner, keyHash, fingerprint);
  if (replay) {
    log("analysis.idempotent_replay", replay.analysis);
    return replay;
  }
  assertFreeTierAdmission(env, owner, "create");
  if (owner.type === "anonymous") {
    // 匿名创建本身会消耗免费额度，必须先消费一次 Turnstile token 并应用独立 IP 限流。
    await verifyTurnstile(input.turnstileToken ?? request.headers.get("x-turnstile-token"), request, env);
    await enforceIpRateLimit("analysis-anonymous", request, repository, 10);
  }
  const created = await repository.createAnalysis({ owner, keyHash, fingerprint, retainAudio,
    quotaLimits: dailyQuotaLimits(owner, runtimeConfig(env)) });
  log(created.duplicate ? "analysis.idempotent_replay" : "analysis.created", created.analysis);
  return created;
}

/** 申请预签名上传时只接受 created 状态，且 key 始终由服务端生成。 */
export async function requestAudioUpload(input, owner, analysisId, env, repository) {
  assertFreeTierAdmission(env, owner, "upload");
  const analysis = await repository.getOwnedAnalysis(analysisId, owner);
  invariant(analysis.status === "created", "INVALID_STATE_TRANSITION", "当前状态不允许申请上传", 409);
  const declaration = assertAudioDeclaration(input, runtimeConfig(env));
  // 本地 Miniflare 继续走 binding 代理，Preview/Production 由 Provider adapter 签发对象级直传授权。
  if (env.APP_ENV === "local") {
    return { analysisId, uploadUrl: `/api/v1/analyses/${analysisId}/audio`, objectKey: null,
      maxBytes: runtimeConfig(env).maxAudioBytes, expectedSize: declaration.size, mime: declaration.mime,
      headers: { "content-type": declaration.mime, "x-audio-sha256": declaration.sha256 }, directComplete: true };
  }
  const ticket = await repository.prepareUploadTicket(analysisId, owner, {
    objectKey: audioObjectKey(owner, analysisId), ...declaration,
  }, runtimeConfig(env).storageLimitBytes);
  // 签名服务短暂失败时保留同一 ticket 与预占；客户端重试会签发相同对象 key，不会制造新的对象能力。
  const signed = await audioStorage(env).createUploadUrl(ticket.objectKey, declaration.mime, declaration.sha256);
  return { analysisId, objectKey: ticket.objectKey, maxBytes: runtimeConfig(env).maxAudioBytes,
    expectedSize: declaration.size, mime: declaration.mime, ...signed };
}

/** 本地集成测试专用旧上传路径；Preview/Production 必须使用对象存储直传 URL。 */
export async function uploadAudioLocally(request, owner, analysisId, env, repository) {
  invariant(env.APP_ENV === "local", "DIRECT_UPLOAD_REQUIRED", "生产环境请使用对象存储直传流程", 410);
  const current = await repository.getOwnedAnalysis(analysisId, owner);
  invariant(current.status === "created", "INVALID_STATE_TRANSITION", "当前状态不允许上传", 409);
  const mime = String(request.headers.get("content-type") ?? "").toLowerCase();
  const buffer = await request.arrayBuffer();
  const declaration = assertAudioDeclaration({ size: buffer.byteLength, mime,
    sha256: request.headers.get("x-audio-sha256") }, runtimeConfig(env));
  const bytes = new Uint8Array(buffer);
  invariant(bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
    "AUDIO_MAGIC_MISMATCH", "音频文件内容不是受支持的 WebM", 415);
  const key = audioObjectKey(owner, analysisId);
  await repository.reserveStorage(analysisId, owner, buffer.byteLength, runtimeConfig(env).storageLimitBytes);
  try {
    await audioStorage(env).putLocalObject(key, buffer, declaration);
  } catch (error) {
    await repository.releaseStorage(analysisId);
    throw error;
  }
  if (owner.type === "anonymous") await repository.consumeAnonymousTrial(owner.id, analysisId);
  const uploaded = await repository.confirmStorageUpload(analysisId, owner, {
    audio_key: key, audio_size: buffer.byteLength, audio_mime: declaration.mime, audio_etag: "local",
    audio_sha256: declaration.sha256,
  }, "analysis.uploaded");
  await enqueueUploadedAnalysis(env, uploaded, "local_upload");
  return uploaded;
}

/** 完成确认只接受服务端签发路径，并通过存储 Provider 核验对象后再改状态和入队。 */
export async function completeAudioUpload(input, owner, analysisId, env, repository) {
  const current = await repository.getOwnedAnalysis(analysisId, owner);
  if (current.status === "uploaded") {
    assertSameCompletion(input, current);
    await enqueueUploadedAnalysis(env, current, "audio_complete_replay");
    return current;
  }
  invariant(current.status === "created", "INVALID_STATE_TRANSITION", "当前状态不允许完成上传", 409);
  const declaration = assertAudioDeclaration(input, runtimeConfig(env));
  const key = String(input.objectKey ?? "");
  assertOwnedKey(key, owner, analysisId);
  assertUploadTicket(await repository.getUploadTicket(analysisId, owner), key, declaration);
  let object;
  try {
    object = await audioStorage(env).verifyUploadedObject(key, {
      maxBytes: runtimeConfig(env).maxAudioBytes, expectedSize: declaration.size, mime: declaration.mime,
      sha256: declaration.sha256,
    });
  } catch (error) {
    await discardRejectedUpload(key, analysisId, env, repository);
    throw error;
  }
  if (owner.type === "anonymous") await repository.consumeAnonymousTrial(owner.id, analysisId);
  const uploaded = await repository.confirmStorageUpload(analysisId, owner, {
    audio_key: key, audio_size: object.size, audio_mime: object.mime, audio_etag: object.etag,
    audio_sha256: declaration.sha256, upload_object_key: null, upload_size: null, upload_mime: null,
    upload_sha256: null, upload_issued_at: null,
  }, "analysis.uploaded");
  await enqueueUploadedAnalysis(env, uploaded, "audio_complete");
  return uploaded;
}

export async function cancelAnalysis(owner, analysisId, env, repository) {
  const current = await repository.getOwnedAnalysis(analysisId, owner);
  if (new Set(["completed", "failed", "cancelled"]).has(current.status)) return current;
  const pendingDeleted = await deletePendingUpload(env, repository, analysisId, owner);
  if (current.audio?.objectKey) await deleteStoredAudio(env, repository, analysisId, current.audio);
  else if (!pendingDeleted) await repository.releaseStorage(analysisId);
  return repository.transition(analysisId, [current.status], "cancelled", {
    audio_key: null, upload_object_key: null, upload_size: null, upload_mime: null, upload_sha256: null, upload_issued_at: null,
  }, "analysis.cancelled");
}

export async function retryAnalysis(owner, analysisId, env, repository) {
  const current = await repository.getOwnedAnalysis(analysisId, owner);
  if (current.status === "uploaded") {
    await enqueueUploadedAnalysis(env, current, "retry_replay");
    return current;
  }
  return retryFailedAnalysis(current, env, repository, "retry_requested", "analysis.retry_requested");
}

/** 管理员只能重试已经稳定失败的任务；不能借此重放仍在 outbox 中的任意分析。 */
export async function retryAnalysisAsAdmin(admin, analysisId, env, repository) {
  const current = await repository.getAnalysis(analysisId);
  invariant(current, "ANALYSIS_NOT_FOUND", "分析任务不存在", 404);
  const uploaded = await retryFailedAnalysis(current, env, repository, "admin_retry_requested", "analysis.admin_retry_requested");
  // 仅记录管理员和任务引用，不写 owner 邮箱、音频对象路径或 Provider 错误正文。
  logEvent("info", "admin.analysis_retry_requested", { analysisId, adminId: admin.id, attempt: uploaded.attempt });
  return uploaded;
}

/** 所有 failed -> uploaded 恢复共享同一条件迁移，避免管理员路径绕开所有者路径的重试限制。 */
async function retryFailedAnalysis(current, env, repository, source, eventType) {
  invariant(current.status === "failed" && current.error?.retryable !== false && current.audio,
    "ANALYSIS_NOT_RETRYABLE", "该任务不可重试", 409);
  invariant(current.attempt < 3, "ANALYSIS_RETRY_EXHAUSTED", "任务重试次数已耗尽", 409);
  const uploaded = await repository.transition(current.id, ["failed"], "uploaded",
    { error_code: null, error_retryable: null, failure_stage: null, failed_at: null }, eventType);
  await enqueueUploadedAnalysis(env, uploaded, source);
  return uploaded;
}

export async function deleteAnalysis(owner, analysisId, env, repository) {
  const current = await repository.getOwnedAnalysis(analysisId, owner);
  const pendingDeleted = await deletePendingUpload(env, repository, analysisId, owner);
  if (current.audio?.objectKey) await deleteStoredAudio(env, repository, analysisId, current.audio);
  else if (!pendingDeleted) await repository.releaseStorage(analysisId);
  await repository.deleteAnalysis(analysisId, owner);
  console.info(JSON.stringify({ event: "analysis.deleted", analysisId, ownerType: owner.type }));
  return { deleted: true, analysisId };
}

export async function deleteAccount(identity, env, repository) {
  invariant(identity.user, "AUTHENTICATION_REQUIRED", "该操作需要登录账户", 401);
  const started = await repository.beginAccountDeletion({ userId: identity.actor.id, email: identity.user.email });
  try {
    const cleanup = await purgeDisabledAccount(identity.actor.id, env, repository);
    console.info(JSON.stringify({ event: "account.deleted", userId: identity.actor.id, analysesDeleted: cleanup.analyses,
      sessionsDeleted: started.sessions, magicLinksDeleted: started.magicLinks }));
    return { deleted: true, accountId: identity.actor.id, analysesDeleted: cleanup.analyses };
  } catch (error) {
    // D1 已禁用账户且保留分析记录；Cron 会从相同状态继续删除，避免失败后重新开放写入。
    console.error(JSON.stringify({ event: "account.deletion_deferred", userId: identity.actor.id, errorName: error?.name ?? "Error" }));
    throw error;
  }
}

function dailyQuotaLimits(owner, config) {
  const day = new Date().toISOString().slice(0, 10);
  const limit = owner.type === "anonymous" ? config.anonymousDailyLimit : config.accountDailyLimit;
  return [{ metric: "analysis-global", periodKey: day, limit: config.globalDailyLimit },
    { metric: `analysis-${owner.type}:${owner.id}`, periodKey: day, limit }];
}

async function deleteStoredAudio(env, repository, analysisId, audio) {
  await audioStorage(env).deleteObject(audio.objectKey);
  await repository.releaseStorage(analysisId);
}

/** 签名 URL 可能已上传但尚未 complete；取消、删除和账户删除都必须直接删除这类未确认对象。 */
async function deletePendingUpload(env, repository, analysisId, owner) {
  const key = await repository.getPendingUploadObjectKey(analysisId, owner);
  if (!key) return false;
  await audioStorage(env).deleteObject(key);
  await repository.clearUploadTicket(analysisId, key);
  await repository.releaseStorage(analysisId);
  return true;
}

async function discardRejectedUpload(key, analysisId, env, repository) {
  try {
    await audioStorage(env).deleteObject(key);
  } finally {
    await repository.clearUploadTicket(analysisId, key);
    await repository.releaseStorage(analysisId);
  }
  console.info(JSON.stringify({ event: "storage.rejected_upload_discarded", analysisId }));
}

function assertSameCompletion(input, current) {
  const audio = current.audio;
  const same = audio && String(input.objectKey ?? "") === audio.objectKey
    && Number(input.size ?? 0) === audio.size
    && String(input.mime ?? input.type ?? "").toLowerCase() === audio.mime
    && String(input.sha256 ?? "").toLowerCase() === audio.sha256;
  invariant(same, "UPLOAD_COMPLETION_CONFLICT", "重复上传完成请求与已确认对象不一致", 409);
}

/** complete 只能确认本任务当前 ticket 的对象和声明，避免旧 URL 或同一路径的其他对象绕过绑定。 */
function assertUploadTicket(ticket, objectKey, declaration) {
  const same = ticket.objectKey === objectKey && ticket.size === declaration.size && ticket.mime === declaration.mime
    && ticket.sha256 === declaration.sha256;
  invariant(same, "UPLOAD_TICKET_CONFLICT", "上传完成请求与当前对象授权不一致", 409);
}

function log(event, analysis) {
  console.info(JSON.stringify({ event, analysisId: analysis.id, ownerType: analysis.owner.type,
    status: analysis.status, attempt: analysis.attempt }));
}
