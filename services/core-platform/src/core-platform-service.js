import { createHash, randomUUID } from "node:crypto";
import { fail, requireValue } from "./errors.js";
import { assertTransition, isTerminal } from "./state-machine.js";

/**
 * 核心业务编排器。speechProcessor 是唯一语音依赖端口，必须实现 transcribe 与 analyze。
 */
export class CorePlatformService {
  constructor({ repository, objectStore, mediaInspector, speechProcessor, config, logger }) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.mediaInspector = mediaInspector;
    this.speechProcessor = speechProcessor;
    this.config = config;
    this.logger = logger;
  }

  async createAnalysis({ idempotencyKey, owner, retainAudio = false }) {
    validateOwner(owner);
    requireValue(typeof idempotencyKey === "string" && idempotencyKey.length >= 8,
      "幂等键至少需要 8 个字符", "INVALID_IDEMPOTENCY_KEY");
    const normalizedRetention = owner.type === "account" && retainAudio === true;
    const namespacedKey = hashJson({ owner, idempotencyKey });
    const fingerprint = hashJson({ retainAudio: normalizedRetention });
    const created = await this.repository.create({
      idempotencyKey: namespacedKey, fingerprint, owner, retainAudio: normalizedRetention,
    });
    this.logger.info("analysis.create", {
      analysisId: created.analysis.id, ownerType: owner.type, status: created.analysis.status,
    });
    return created;
  }

  async getAnalysis({ analysisId, actor }) {
    return this.#owned(analysisId, actor);
  }

  async uploadAudio({ analysisId, actor, bytes }) {
    const current = await this.#owned(analysisId, actor);
    requireValue(Buffer.isBuffer(bytes) && bytes.length > 0, "音频内容不能为空", "EMPTY_AUDIO");
    if (bytes.length > this.config.maxAudioBytes) fail("音频文件过大", "AUDIO_TOO_LARGE", 413);
    if (current.status !== "created") fail("当前状态不允许上传", "INVALID_STATE_TRANSITION", 409);
    const media = await this.mediaInspector.inspect(bytes);
    this.#validateDuration(media.durationMs);
    const objectKey = `analyses/${analysisId}/${randomUUID()}.${media.extension}`;
    await this.objectStore.put(objectKey, bytes);
    try {
      return await this.#transition(analysisId, "uploaded", "analysis.uploaded", (row) => ({
        ...row,
        audio: { objectKey, size: bytes.length, mime: media.mime, durationMs: media.durationMs,
          sha256: createHash("sha256").update(bytes).digest("hex") },
      }));
    } catch (error) {
      await this.objectStore.delete(objectKey);
      throw error;
    }
  }

  async runAnalysis({ analysisId, actor }) {
    const current = await this.#owned(analysisId, actor);
    if (current.status !== "uploaded") fail("任务尚未准备好", "INVALID_STATE_TRANSITION", 409);
    await this.#transition(analysisId, "transcribing", "analysis.transcribing", (row) => ({
      ...row, attempt: row.attempt + 1, error: null,
    }));
    try {
      return await this.#process(analysisId);
    } catch (error) {
      const latest = await this.repository.get(analysisId);
      if (latest?.status === "cancelled") return latest;
      await this.#transition(analysisId, "failed", "analysis.failed", (row) => ({
        ...row, error: { code: error.code ?? "PROCESSING_FAILED", retryable: error.retryable !== false },
      }));
      throw error;
    }
  }

  async retryAnalysis({ analysisId, actor }) {
    const current = await this.#owned(analysisId, actor);
    if (current.status !== "failed" || !current.audio) {
      fail("只有保留音频的失败任务可重试", "ANALYSIS_NOT_RETRYABLE", 409);
    }
    await this.#transition(analysisId, "uploaded", "analysis.retry_requested", (row) => ({
      ...row, error: null,
    }));
    return this.runAnalysis({ analysisId, actor });
  }

  async cancelAnalysis({ analysisId, actor }) {
    const current = await this.#owned(analysisId, actor);
    if (isTerminal(current.status)) return current;
    if (current.audio) await this.objectStore.delete(current.audio.objectKey);
    return this.#transition(analysisId, "cancelled", "analysis.cancelled", (row) => ({
      ...row, audio: null,
    }));
  }

  async deleteAnalysis({ analysisId, actor }) {
    const current = await this.#owned(analysisId, actor);
    if (current.audio) await this.objectStore.delete(current.audio.objectKey);
    await this.repository.delete(analysisId);
    this.logger.info("analysis.delete", { analysisId, ownerType: current.owner.type });
    return { deleted: true, analysisId };
  }

  async deleteAccount({ accountId, actor }) {
    requireValue(actor?.type === "account" && actor.id === accountId,
      "只能删除自己的账户数据", "FORBIDDEN");
    const rows = await this.repository.listByAccount(accountId);
    for (const row of rows) await this.deleteAnalysis({ analysisId: row.id, actor });
    await this.repository.purgeAccountAudits(accountId);
    this.logger.info("account.data_deleted", { accountId, action: "cascade" });
    return { deleted: true, accountId, analysesDeleted: rows.length };
  }

  async listAudits({ actor, analysisId }) {
    if (analysisId) await this.#owned(analysisId, actor);
    return this.repository.listAudits({ analysisId, accountId: actor?.id });
  }

  async #process(analysisId) {
    const transcribing = await this.repository.get(analysisId);
    const bytes = await this.objectStore.get(transcribing.audio.objectKey);
    const transcript = await this.speechProcessor.transcribe({
      analysisId, bytes, media: publicMedia(transcribing.audio),
    });
    if ((await this.repository.get(analysisId)).status === "cancelled") return this.repository.get(analysisId);
    await this.#transition(analysisId, "analyzing", "analysis.analyzing");
    const report = await this.speechProcessor.analyze({ analysisId, transcript });
    return this.#complete(analysisId, transcript, report);
  }

  async #complete(analysisId, transcript, report) {
    const current = await this.repository.get(analysisId);
    const shouldDeleteAudio = current.owner.type === "anonymous" || !current.retainAudio;
    if (shouldDeleteAudio && current.audio) await this.objectStore.delete(current.audio.objectKey);
    return this.#transition(analysisId, "completed", "analysis.completed", (row) => ({
      ...row, audio: shouldDeleteAudio ? null : row.audio,
      result: { transcript, report }, error: null, completedAt: new Date().toISOString(),
    }));
  }

  async #transition(analysisId, targetStatus, action, updater = (row) => row) {
    const next = await this.repository.update(analysisId, (row) => {
      assertTransition(row.status, targetStatus);
      return { ...updater(row), status: targetStatus };
    }, action);
    this.logger.info("analysis.transition", { analysisId, status: next.status, targetStatus });
    return next;
  }

  async #owned(analysisId, actor) {
    const row = await this.repository.get(analysisId);
    if (!row) fail("分析任务不存在", "ANALYSIS_NOT_FOUND", 404);
    if (!sameOwner(row.owner, actor)) fail("无权访问该分析任务", "FORBIDDEN", 403);
    return row;
  }

  #validateDuration(durationMs) {
    if (durationMs < this.config.minDurationMs) fail("音频时长不足", "AUDIO_TOO_SHORT", 422);
    if (durationMs > this.config.maxDurationMs) fail("音频时长超限", "AUDIO_TOO_LONG", 422);
  }
}

function validateOwner(owner) {
  requireValue(owner?.type === "anonymous" || owner?.type === "account", "owner.type 无效");
  requireValue(typeof owner.id === "string" && owner.id.length >= 4, "owner.id 无效");
}

function sameOwner(owner, actor) {
  return owner.type === actor?.type && owner.id === actor?.id;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicMedia(audio) {
  return { mime: audio.mime, size: audio.size, durationMs: audio.durationMs, sha256: audio.sha256 };
}
