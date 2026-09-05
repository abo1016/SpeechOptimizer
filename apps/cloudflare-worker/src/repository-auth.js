import { invariant } from "./errors.js";
import { changes, isUniqueViolation, quotaOrAccountError } from "./repository-common.js";

/** 认证仓储只处理用户、会话和一次性认证凭证，不接触分析状态机。 */
export class AuthenticationRepository {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }

  async findUserByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email_normalized = ? AND deleted_at IS NULL").bind(email).first();
  }

  async findUserById(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  }

  async createUser({ email, provider, providerSubject = null }) {
    const id = "usr_" + crypto.randomUUID();
    const sql = "INSERT INTO users(id,email_normalized,provider,provider_subject,created_at) VALUES (?,?,?,?,?)";
    await this.db.prepare(sql).bind(id, email, provider, providerSubject, this.now()).run();
    return this.findUserById(id);
  }

  async findOrCreateUser(input) {
    const existing = await this.findUserByEmail(input.email);
    if (existing) return existing;
    try {
      return await this.createUser(input);
    } catch (error) {
      // 唯一键是 OAuth 并发回调的最终裁决；冲突后重读已建账户。
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.findUserByEmail(input.email);
      if (concurrent) return concurrent;
      throw error;
    }
  }

  async createSession({ tokenHash, userId, expiresAt }) {
    try {
      await this.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
        .bind(tokenHash, userId, expiresAt, this.now()).run();
    } catch (error) {
      throw quotaOrAccountError(error);
    }
  }

  async getSession(tokenHash) {
    const sql = "SELECT s.*,u.email_normalized,u.role,u.status,u.provider,u.provider_subject,u.retain_audio"
      + " FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.deleted_at IS NULL";
    return this.db.prepare(sql).bind(tokenHash).first();
  }

  async deleteSession(tokenHash) {
    const result = await this.db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(tokenHash).run();
    return changes(result) === 1;
  }

  async saveMagicLink(record) {
    const sql = "INSERT INTO magic_links(token_hash,email_normalized,redirect_uri,expires_at,created_at)"
      + " VALUES(?,?,?,?,?)";
    await this.db.prepare(sql).bind(record.tokenHash, record.email, record.redirectUri, record.expiresAt, this.now()).run();
  }

  async consumeMagicLink(tokenHash) {
    const now = this.now();
    const row = await this.db.prepare("SELECT * FROM magic_links WHERE token_hash=?").bind(tokenHash).first();
    invariant(row, "INVALID_MAGIC_LINK", "Magic Link 无效", 400);
    invariant(!row.used_at, "MAGIC_LINK_USED", "Magic Link 已使用", 409);
    invariant(row.expires_at > now, "MAGIC_LINK_EXPIRED", "Magic Link 已过期", 400);
    const sql = "UPDATE magic_links SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?";
    const result = await this.db.prepare(sql).bind(now, tokenHash, now).run();
    invariant(changes(result) === 1, "MAGIC_LINK_USED", "Magic Link 已使用", 409);
    return row;
  }

  async saveOauthState(record) {
    const sql = "INSERT INTO oauth_states(state_hash,redirect_uri,expires_at,created_at) VALUES(?,?,?,?)";
    await this.db.prepare(sql).bind(record.stateHash, record.redirectUri, record.expiresAt, this.now()).run();
  }

  async consumeOauthState(stateHash) {
    const now = this.now();
    const row = await this.db.prepare("SELECT * FROM oauth_states WHERE state_hash=?").bind(stateHash).first();
    invariant(row && row.expires_at > now, "INVALID_OAUTH_STATE", "OAuth state 无效或已过期", 400);
    const result = await this.db.prepare("DELETE FROM oauth_states WHERE state_hash=? AND expires_at>?")
      .bind(stateHash, now).run();
    invariant(changes(result) === 1, "INVALID_OAUTH_STATE", "OAuth state 已消费", 400);
    return row;
  }
}
