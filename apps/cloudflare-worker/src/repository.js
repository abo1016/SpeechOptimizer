import { AnalysisRepository } from "./repository-analysis.js";
import { AuthenticationRepository } from "./repository-auth.js";
import { MaintenanceRepository } from "./repository-maintenance.js";
import { StorageRepository } from "./repository-storage.js";

/**
 * D1Repository 是 Worker 其余模块唯一依赖的稳定门面。
 * 各领域 SQL 委托给显式组合的专用仓储，避免路由层感知表结构，也避免动态混入方法。
 */
export class D1Repository {
  constructor(database, clock = () => new Date()) {
    this.db = database;
    this.clock = clock;
    const now = () => this.now();
    this.authentication = new AuthenticationRepository(database, now);
    this.analyses = new AnalysisRepository(database, now);
    this.storage = new StorageRepository(database, now);
    this.maintenance = new MaintenanceRepository(database, now);
  }

  now() { return this.clock().toISOString(); }

  // 认证、账户与一次性凭证。
  findUserByEmail(email) { return this.authentication.findUserByEmail(email); }
  findUserById(id) { return this.authentication.findUserById(id); }
  createUser(input) { return this.authentication.createUser(input); }
  findOrCreateUser(input) { return this.authentication.findOrCreateUser(input); }
  createSession(input) { return this.authentication.createSession(input); }
  getSession(tokenHash) { return this.authentication.getSession(tokenHash); }
  deleteSession(tokenHash) { return this.authentication.deleteSession(tokenHash); }
  saveMagicLink(record) { return this.authentication.saveMagicLink(record); }
  consumeMagicLink(tokenHash) { return this.authentication.consumeMagicLink(tokenHash); }
  saveOauthState(record) { return this.authentication.saveOauthState(record); }
  consumeOauthState(stateHash) { return this.authentication.consumeOauthState(stateHash); }

  // 分析状态机、幂等和分页查询。
  createAnalysis(input) { return this.analyses.createAnalysis(input); }
  findIdempotentAnalysis(owner, keyHash, fingerprint) {
    return this.analyses.findIdempotentAnalysis(owner, keyHash, fingerprint);
  }
  getAnalysis(id) { return this.analyses.getAnalysis(id); }
  getOwnedAnalysis(id, owner) { return this.analyses.getOwnedAnalysis(id, owner); }
  transition(id, fromStatuses, target, patch, eventType) {
    return this.analyses.transition(id, fromStatuses, target, patch, eventType);
  }
  listOwned(owner, options) { return this.analyses.listOwned(owner, options); }
  listFailedForAdmin(options) { return this.analyses.listFailedForAdmin(options); }
  listUploadedForDispatch(limit) { return this.analyses.listUploadedForDispatch(limit); }
  deleteAnalysis(id, owner) { return this.analyses.deleteAnalysis(id, owner); }

  // 单对象上传 ticket 与存储容量预占。
  prepareUploadTicket(analysisId, owner, ticket, limit) {
    return this.storage.prepareUploadTicket(analysisId, owner, ticket, limit);
  }
  getUploadTicket(analysisId, owner) { return this.storage.getUploadTicket(analysisId, owner); }
  getPendingUploadObjectKey(analysisId, owner) {
    return this.storage.getPendingUploadObjectKey(analysisId, owner);
  }
  clearUploadTicket(analysisId, objectKey) { return this.storage.clearUploadTicket(analysisId, objectKey); }
  reserveStorage(analysisId, owner, bytes, limit) {
    return this.storage.reserveStorage(analysisId, owner, bytes, limit);
  }
  confirmStorageUpload(analysisId, owner, patch) {
    return this.storage.confirmStorageUpload(analysisId, owner, patch);
  }
  releaseStorage(analysisId) { return this.storage.releaseStorage(analysisId); }
  reconcileStorageQuota(actualBytes) { return this.storage.reconcileStorageQuota(actualBytes); }
  clearAudioKey(id) { return this.storage.clearAudioKey(id); }

  // 账户删除、数据保留和应用层配额。
  updateRetainAudio(userId, retainAudio) { return this.maintenance.updateRetainAudio(userId, retainAudio); }
  beginAccountDeletion(input) { return this.maintenance.beginAccountDeletion(input); }
  listPendingAccountDeletions(limit) { return this.maintenance.listPendingAccountDeletions(limit); }
  finalizeAccountDeletion(userId) { return this.maintenance.finalizeAccountDeletion(userId); }
  cleanupExpiredRecords() { return this.maintenance.cleanupExpiredRecords(); }
  consumeAnonymousTrial(anonymousId, analysisId) {
    return this.maintenance.consumeAnonymousTrial(anonymousId, analysisId);
  }
  incrementQuota(metric, periodKey, limit) { return this.maintenance.incrementQuota(metric, periodKey, limit); }
  quotaValue(metric, periodKey) { return this.maintenance.quotaValue(metric, periodKey); }
  adjustQuota(metric, periodKey, delta) { return this.maintenance.adjustQuota(metric, periodKey, delta); }
  setQuota(metric, periodKey, value) { return this.maintenance.setQuota(metric, periodKey, value); }
}
