import { randomUUID } from "node:crypto";
import { AdminService, AuthService, BillingService, EntitlementService,
  createIdFactory } from "../../../services/account-billing/src/index.js";
import { compareTakes } from "../../../packages/speech-engine/src/index.js";
import { createCorePlatform } from "../../../services/core-platform/src/index.js";
import { AnalysisRunner } from "./runner.js";
import { requireInput } from "./errors.js";
import { createDurationResolver } from "./media-duration.js";
import {
  createSpeechProcessor,
  findConfirmedHold,
  findReservedHold,
  hasPersistedUsage,
  isUsageDenied,
  nextAnalysisAttempt,
  nextRetryReference,
  removeMapRows,
  sameOwner,
  uploadReference,
} from "./application-analysis-support.js";

/** 业务组合层只调用领域公共接口，并维护 HTTP 查询所需的轻量读模型。 */
export class MvpApplication {
  constructor({ config, store, providers, logger }) {
    this.config = config;
    this.store = store;
    this.providers = providers;
    this.logger = logger;
    this.entitlements = new EntitlementService({ store, id: createIdFactory("ent"), logger });
    this.auth = new AuthService({ store, id: createIdFactory("auth"), logger,
      mailer: providers.mailer, oauthProvider: providers.oauthProvider,
      exposeDevTokens: providers.authMode === "mock", allowedRedirectOrigins: config.allowedOrigins });
    // 计费领域的资金写请求必须先 await 这一持久化回调，再触发 Provider 写入。
    this.billing = new BillingService({ store, entitlements: this.entitlements,
      gateway: providers.waffoGateway, persist: () => store.flush(), id: createIdFactory("bill"), logger });
    this.admin = new AdminService({ store, entitlements: this.entitlements,
      id: createIdFactory("admin"), logger });
    this.core = createCorePlatform({ config: { rootDirectory: config.coreDirectory,
      maxAudioBytes: config.audioLimitBytes, minDurationMs: 1_000, maxDurationMs: 120_000 },
    durationResolver: createDurationResolver(config.ffprobePath, logger, config.mode),
    speechProcessor: createSpeechProcessor(providers, logger), logger });
    this.runner = new AnalysisRunner({ execute: (id) => this.#execute(id), logger });
  }

  async createAnalysis(actor, input, idempotencyKey) {
    requireInput(idempotencyKey, "MISSING_IDEMPOTENCY_KEY", "缺少 Idempotency-Key");
    const user = actor.type === "account" ? this.store.users.get(actor.id) : null;
    const retainAudio = input.retainAudio ?? user?.retainAudio ?? false;
    const created = await this.core.createAnalysis({ owner: actor, idempotencyKey,
      retainAudio: actor.type === "account" && retainAudio === true });
    this.#mirror(created.analysis);
    await this.store.flush();
    return created;
  }

  async uploadAudio(actor, analysisId, bytes) {
    const analysis = await this.core.uploadAudio({ actor, analysisId, bytes });
    try {
      this.#consume(actor, analysis);
    } catch (error) {
      await this.core.cancelAnalysis({ actor, analysisId });
      throw error;
    }
    this.#mirror(analysis);
    await this.store.flush();
    this.runner.schedule(analysisId);
    return analysis;
  }

  async getAnalysis(actor, analysisId) {
    return this.core.getAnalysis({ actor, analysisId });
  }

  async cancel(actor, analysisId) {
    const result = await this.core.cancelAnalysis({ actor, analysisId });
    this.#release(analysisId, "cancelled");
    this.#mirror(result);
    await this.store.flush();
    return result;
  }

  async retry(actor, analysisId, options = {}) {
    const current = await this.core.getAnalysis({ actor, analysisId });
    requireInput(current.status === "failed", "ANALYSIS_NOT_RETRYABLE", "只有失败任务可重试", 409);
    requireInput(current.error?.retryable !== false, "ANALYSIS_NOT_RETRYABLE", "该失败任务不可重试", 409);
    requireInput(!this.runner.pending.has(analysisId), "ANALYSIS_NOT_RETRYABLE", "上一次处理仍在结算，请稍后重试", 409);
    if (actor.type === "account") {
      const minutes = Math.max(1, Math.ceil((current.audio?.durationMs ?? 0) / 60_000));
      const referenceId = nextRetryReference(this.store, current);
      const hold = this.entitlements.reserve({ userId: actor.id, amount: minutes, referenceId });
      this.logger.info("analysis.retry_entitlement_reserved", {
        analysisId, holdId: hold.id, referenceId, attempt: nextAnalysisAttempt(current),
      });
    }
    if (options.adminId) {
      this.store.audit.push({ id: `admin_${randomUUID()}`, actorId: options.adminId,
        action: "analysis.retry", targetId: analysisId,
        details: { reason: options.reason ?? "admin_requested" }, createdAt: Date.now() });
      this.logger.info("admin.analysis_retry_requested", { analysisId, actorId: options.adminId });
    }
    await this.store.flush();
    this.runner.schedule(analysisId);
    return { ...current, retryScheduled: true };
  }

  /** 启动时以核心状态为准补齐快照，并在权益记录落盘后才重新排队。 */
  async recoverPendingAnalyses() {
    // 核心 JSON 数据库是任务状态事实源，不能只依赖可能尚未 flush 的组合层快照。
    const queued = [];
    const summaries = await this.core.repository.list();
    for (const summary of summaries) {
      const current = await this.core.getAnalysis({ analysisId: summary.id, actor: summary.owner });
      if (current.status === "uploaded") {
        await this.#recoverUploaded(current, queued);
        continue;
      }
      if (current.status === "transcribing" || current.status === "analyzing") {
        await this.#recoverInterrupted(current);
        continue;
      }
      this.#restoreSnapshot(current);
    }
    await this.store.flush();
    // 先持久化补建的预扣/试用，再允许异步任务推进，避免再次出现免费执行窗口。
    for (const analysisId of queued) this.runner.schedule(analysisId);
  }

  async #recoverUploaded(current, queued) {
    try {
      const usageRestored = this.#ensureUsage(current);
      this.#mirror(current);
      queued.push(current.id);
      this.logger.info("analysis.recovery_usage_reconciled", {
        analysisId: current.id, ownerType: current.owner.type, usageRestored,
      });
    } catch (error) {
      if (!isUsageDenied(error)) throw error;
      const cancelled = await this.core.cancelAnalysis({ actor: current.owner, analysisId: current.id });
      this.#mirror(cancelled);
      this.logger.warn("analysis.recovery_usage_denied", {
        analysisId: current.id, ownerType: current.owner.type, code: error.code,
      });
    }
  }

  async #recoverInterrupted(current) {
    const recovered = await this.core.repository.update(current.id, (row) => ({ ...row,
      status: "failed", error: { code: "PROCESS_INTERRUPTED", retryable: true },
    }), "analysis.recovered_as_failed");
    const entitlementReleased = this.#release(current.id, "process_interrupted");
    this.#mirror(recovered);
    this.logger.warn("analysis.recovered_as_failed", {
      analysisId: current.id, previousStatus: current.status, entitlementReleased,
    });
  }

  #restoreSnapshot(current) {
    const entitlementSettled = current.status === "completed"
      ? this.#confirm(current.id)
      : (current.status === "failed" || current.status === "cancelled") && this.#release(current.id, current.status);
    this.#mirror(current);
    if (entitlementSettled) {
      this.logger.info("analysis.recovery_entitlement_settled", { analysisId: current.id, status: current.status });
    }
  }

  adminObservability() {
    return {
      webhooks: [...this.store.webhookEvents.values()],
      errors: [...this.store.analyses.values()].filter((row) => row.status === "failed"),
      audit: [...this.store.audit],
    };
  }

  async delete(actor, analysisId) {
    const result = await this.core.deleteAnalysis({ actor, analysisId });
    this.store.analyses.delete(analysisId);
    await this.store.flush();
    return result;
  }

  async deleteAccount(actor) {
    const result = await this.core.deleteAccount({ accountId: actor.id, actor });
    for (const [id, row] of this.store.analyses.entries()) {
      if (sameOwner(row.owner, actor)) this.store.analyses.delete(id);
    }
    return result;
  }

  purgeAccountData(userId) {
    const user = this.store.users.get(userId);
    if (user) {
      this.store.usersByEmail.delete(user.email);
      // Magic Link 快照包含邮箱，账户删除时必须一并移除，避免本地持久化继续保留可识别信息。
      removeMapRows(this.store.magicLinks, (row) => row.email === user.email);
    }
    this.store.users.delete(userId);
    removeMapRows(this.store.sessions, (row) => row.userId === userId);
    // 退款读模型同样包含用户和 Provider 引用，账户删除必须一并清理，避免重启后残留财务 PII。
    for (const field of ["grants", "holds", "orders", "subscriptions", "refunds", "analyses", "webhookEvents"]) {
      removeMapRows(this.store[field], (row) => row.userId === userId || row.owner?.id === userId);
    }
    this.store.ledger = this.store.ledger.filter((row) => row.userId !== userId);
    this.store.audit = this.store.audit.filter((row) => row.actorId !== userId && row.targetId !== userId);
  }

  history(actor, filters = {}) {
    const rows = [...this.store.analyses.values()].filter((row) => sameOwner(row.owner, actor))
      .filter((row) => !filters.status || row.status === filters.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const start = filters.cursor ? Math.max(0, rows.findIndex((row) => row.id === filters.cursor) + 1) : 0;
    const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
    return { items: rows.slice(start, start + limit), nextCursor: rows[start + limit]?.id ?? null };
  }

  async report(actor, analysisId) {
    const analysis = await this.getAnalysis(actor, analysisId);
    requireInput(analysis.status === "completed", "REPORT_NOT_READY", "报告尚未生成", 409);
    return analysis.result;
  }

  async compare(actor, beforeId, afterId) {
    const [before, after] = await Promise.all([this.report(actor, beforeId), this.report(actor, afterId)]);
    return compareTakes(before.report, after.report);
  }

  async #execute(analysisId) {
    const summary = this.store.analyses.get(analysisId);
    if (!summary) return;
    const isRetry = summary.status === "failed";
    summary.status = "transcribing";
    await this.store.flush();
    try {
      const result = isRetry
        ? await this.core.retryAnalysis({ actor: summary.owner, analysisId })
        : await this.core.runAnalysis({ actor: summary.owner, analysisId });
      this.#confirm(analysisId);
      this.#mirror(result);
    } catch (error) {
      const failed = await this.core.getAnalysis({ actor: summary.owner, analysisId });
      this.#release(analysisId, error.code ?? "processing_failed");
      this.#mirror(failed);
      throw error;
    } finally {
      await this.store.flush();
    }
  }

  #consume(actor, analysis, referenceId = analysis.id) {
    const durationSeconds = Math.ceil(analysis.audio.durationMs / 1000);
    if (actor.type === "anonymous") return this.auth.useAnonymousTrial({ anonymousId: actor.id, durationSeconds });
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    const hold = this.entitlements.reserve({ userId: actor.id, amount: minutes, referenceId });
    analysis.holdId = hold.id;
    return hold;
  }

  #ensureUsage(analysis) {
    if (analysis.owner.type === "anonymous") {
      const summary = this.store.analyses.get(analysis.id);
      // 匿名试用只保存身份，只有同一任务已离开 created 状态才可证明该试用属于当前任务。
      if (this.store.anonymousTrials.has(analysis.owner.id) && hasPersistedUsage(summary, analysis.owner)) return false;
      this.#consume(analysis.owner, analysis);
      return true;
    }
    if (findReservedHold(this.store, analysis.id) || findConfirmedHold(this.store, analysis.id)) return false;
    this.#consume(analysis.owner, analysis, uploadReference(this.store, analysis));
    return true;
  }

  #confirm(analysisId) {
    const hold = findReservedHold(this.store, analysisId);
    if (!hold) return false;
    this.entitlements.confirm(hold.id);
    return true;
  }

  #release(analysisId, reason) {
    const hold = findReservedHold(this.store, analysisId);
    if (!hold) return false;
    this.entitlements.release(hold.id, reason);
    return true;
  }

  #mirror(analysis) {
    this.store.analyses.set(analysis.id, { id: analysis.id, owner: analysis.owner,
      userId: analysis.owner.type === "account" ? analysis.owner.id : null, status: analysis.status,
      durationMs: analysis.audio?.durationMs ?? this.store.analyses.get(analysis.id)?.durationMs ?? null,
      createdAt: analysis.createdAt, updatedAt: analysis.updatedAt, completedAt: analysis.completedAt,
      error: analysis.error });
  }
}

export function createRequestId() { return `req_${randomUUID()}`; }
