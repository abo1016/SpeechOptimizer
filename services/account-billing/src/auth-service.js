import { createHash, randomBytes } from "node:crypto";
import { DomainError, invariant } from "./errors.js";

const DEFAULT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAGIC_LINK_MS = 15 * 60 * 1000;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email) {
  const value = String(email ?? "").trim().toLowerCase();
  invariant(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "INVALID_EMAIL", "邮箱格式无效");
  return value;
}

/**
 * 认证服务不持有 HTTP、Cookie 或具体 OAuth SDK，调用方负责安全 Cookie 和 CSRF 外层防护。
 * exposeDevTokens 只能在本地开发开启，防止生产接口回传登录凭证。
 */
export class AuthService {
  constructor({ store, mailer, oauthProvider, clock = () => Date.now(), id, logger = console,
    exposeDevTokens = false, allowedRedirectOrigins = [], sessionTtlMs = DEFAULT_SESSION_MS,
    magicLinkTtlMs = DEFAULT_MAGIC_LINK_MS }) {
    this.store = store;
    this.mailer = mailer;
    this.oauthProvider = oauthProvider;
    this.clock = clock;
    this.id = id;
    this.logger = logger;
    this.exposeDevTokens = exposeDevTokens;
    this.allowedRedirectOrigins = new Set(allowedRedirectOrigins);
    this.sessionTtlMs = sessionTtlMs;
    this.magicLinkTtlMs = magicLinkTtlMs;
  }

  async requestMagicLink({ email, redirectUri }) {
    const normalized = normalizeEmail(email);
    this.#checkRedirect(redirectUri);
    const token = randomBytes(32).toString("base64url");
    const record = { email: normalized, redirectUri, expiresAt: this.clock() + this.magicLinkTtlMs, usedAt: null };
    this.store.magicLinks.set(hash(token), record);
    await this.mailer.sendMagicLink({ email: normalized, token, redirectUri });
    this.logger.info?.(`[auth] magic_link_requested email=${normalized}`);
    return this.exposeDevTokens ? { accepted: true, previewToken: token } : { accepted: true };
  }

  consumeMagicLink({ token }) {
    const record = this.store.magicLinks.get(hash(String(token ?? "")));
    invariant(record, "INVALID_MAGIC_LINK", "Magic Link 无效");
    invariant(!record.usedAt, "MAGIC_LINK_USED", "Magic Link 已使用");
    invariant(record.expiresAt > this.clock(), "MAGIC_LINK_EXPIRED", "Magic Link 已过期");
    record.usedAt = this.clock();
    const user = this.#findOrCreateUser(record.email, "magic_link");
    this.logger.info?.(`[auth] magic_link_consumed userId=${user.id}`);
    return this.#createSession(user);
  }

  beginGoogleOAuth({ redirectUri }) {
    invariant(this.oauthProvider, "OAUTH_NOT_CONFIGURED", "Google OAuth provider 未配置");
    this.#checkRedirect(redirectUri);
    const state = randomBytes(24).toString("base64url");
    this.store.oauthStates.set(hash(state), { redirectUri, expiresAt: this.clock() + DEFAULT_MAGIC_LINK_MS });
    return { state, authorizationUrl: this.oauthProvider.createAuthorizationUrl({ state, redirectUri }) };
  }

  async completeGoogleOAuth({ state, code }) {
    const key = hash(String(state ?? ""));
    const pending = this.store.oauthStates.get(key);
    invariant(pending && pending.expiresAt > this.clock(), "INVALID_OAUTH_STATE", "OAuth state 无效或已过期");
    this.store.oauthStates.delete(key);
    const profile = await this.oauthProvider.exchangeCode({ code, redirectUri: pending.redirectUri });
    invariant(profile?.emailVerified, "OAUTH_EMAIL_UNVERIFIED", "Google 邮箱尚未验证");
    const user = this.#findOrCreateUser(normalizeEmail(profile.email), "google", profile.subject);
    this.logger.info?.(`[auth] oauth_completed userId=${user.id}`);
    return this.#createSession(user);
  }

  authenticate(token) {
    const session = this.store.sessions.get(hash(String(token ?? "")));
    invariant(session && session.expiresAt > this.clock(), "INVALID_SESSION", "会话无效或已过期");
    const user = this.store.users.get(session.userId);
    invariant(user && user.status !== "disabled", "ACCOUNT_DISABLED", "账户已禁用");
    return user;
  }

  authorize(token, roles = ["user", "admin"]) {
    const user = this.authenticate(token);
    invariant(roles.includes(user.role), "FORBIDDEN", "当前角色无权执行此操作");
    return user;
  }

  revokeSession(token) {
    const removed = this.store.sessions.delete(hash(String(token ?? "")));
    this.logger.info?.(`[auth] session_revoked removed=${removed}`);
    return { revoked: removed };
  }

  useAnonymousTrial({ anonymousId, durationSeconds }) {
    invariant(anonymousId, "ANONYMOUS_ID_REQUIRED", "匿名体验需要稳定匿名标识");
    invariant(durationSeconds > 0 && durationSeconds <= 60, "ANONYMOUS_DURATION_EXCEEDED", "匿名体验最多 60 秒");
    invariant(!this.store.anonymousTrials.has(anonymousId), "ANONYMOUS_TRIAL_USED", "匿名体验已用尽");
    this.store.anonymousTrials.add(anonymousId);
    this.logger.info?.(`[auth] anonymous_trial_consumed anonymousId=${anonymousId}`);
    return { accepted: true, remainingTrials: 0 };
  }

  #findOrCreateUser(email, provider, providerSubject = null) {
    const existingId = this.store.usersByEmail.get(email);
    if (existingId) return this.store.users.get(existingId);
    const user = { id: this.id(), email, role: "user", status: "active", provider, providerSubject, createdAt: this.clock() };
    this.store.users.set(user.id, user);
    this.store.usersByEmail.set(email, user.id);
    return user;
  }

  #createSession(user) {
    if (user.status === "disabled") throw new DomainError("ACCOUNT_DISABLED", "账户已禁用");
    const token = randomBytes(32).toString("base64url");
    this.store.sessions.set(hash(token), { userId: user.id, expiresAt: this.clock() + this.sessionTtlMs });
    return { token, user };
  }

  #checkRedirect(redirectUri) {
    let origin;
    try {
      origin = new URL(redirectUri).origin;
    } catch {
      throw new DomainError("INVALID_REDIRECT_URI", "认证回跳地址无效");
    }
    invariant(this.allowedRedirectOrigins.has(origin), "REDIRECT_URI_NOT_ALLOWED", "认证回跳地址不在允许列表");
  }
}
