import { requiredSecret, runtimeConfig } from "./config.js";
import { WorkerError, invariant } from "./errors.js";
import { allowedOrigins, cookie, parseCookies, signAnonymous, verifyAnonymous } from "./http.js";
import { hmacBase64Url, randomToken, safeEqual, sha256Hex } from "./web-crypto.js";

const OAUTH_STATE_COOKIE = "so_oauth_state";

/** 解析账户或匿名身份；账户 Session 过期后稳定返回 INVALID_SESSION。 */
export async function resolveIdentity(request, env, repository, required = true) {
  const cookies = parseCookies(request);
  if (cookies.so_session) return resolveAccount(cookies.so_session, repository);
  const anonymousId = await verifyAnonymous(cookies.so_anonymous, requiredSecret(env, "COOKIE_SECRET"));
  if (anonymousId) return { actor: { type: "anonymous", id: anonymousId }, user: null, sessionToken: null };
  if (!required) return null;
  throw new WorkerError("AUTHENTICATION_REQUIRED", "需要先建立匿名或账户会话", 401);
}

export async function ensureAnonymous(request, env, repository) {
  try {
    const existing = await resolveIdentity(request, env, repository, false);
    if (existing) return { status: 200, data: { identity: existing.actor }, headers: {} };
  } catch (error) {
    if (!new Set(["INVALID_SESSION", "ACCOUNT_DISABLED"]).has(error.code)) throw error;
  }
  const id = `anon_${crypto.randomUUID()}`;
  const signed = await signAnonymous(id, requiredSecret(env, "COOKIE_SECRET"));
  return { status: 201, data: { identity: { type: "anonymous", id } },
    headers: { "set-cookie": cookie("so_anonymous", signed, 31_536_000, true) } };
}

export async function requestMagicLink(input, request, env, repository) {
  const email = normalizeEmail(input.email);
  assertRedirect(input.redirectUri, env);
  await verifyTurnstile(input.turnstileToken ?? request.headers.get("x-turnstile-token"), request, env);
  await enforceAuthRateLimits(email, request, repository);
  const token = randomToken();
  const expiresAt = futureIso(runtimeConfig(env).magicLinkTtlSeconds);
  await repository.saveMagicLink({ tokenHash: await sha256Hex(token), email, redirectUri: input.redirectUri, expiresAt });
  if (env.APP_ENV === "local") return { accepted: true, previewToken: token };
  await sendMagicLink(email, token, input.redirectUri, env);
  console.info(JSON.stringify({ event: "auth.magic_link_requested", emailHash: await sha256Hex(email) }));
  return { accepted: true };
}

export async function consumeMagicLink(input, env, repository) {
  const row = await repository.consumeMagicLink(await sha256Hex(String(input.token ?? "")));
  const user = await repository.findOrCreateUser({ email: row.email_normalized, provider: "magic_link" });
  return createLogin(user, env, repository);
}

export async function beginGoogleOAuth(input, request, env, repository) {
  assertRedirect(input.redirectUri, env);
  await verifyTurnstile(input.turnstileToken ?? request.headers.get("x-turnstile-token"), request, env);
  await enforceIpRateLimit("auth-google", request, repository, 10);
  // 先确认 Cookie 签名 secret，避免后续无法把已写入 D1 的 state 绑定到浏览器。
  const cookieSecret = requiredSecret(env, "COOKIE_SECRET");
  const state = randomToken(24);
  const stateHash = await sha256Hex(state);
  const ttlSeconds = runtimeConfig(env).magicLinkTtlSeconds;
  await repository.saveOauthState({
    stateHash,
    redirectUri: input.redirectUri,
    expiresAt: futureIso(ttlSeconds),
  });
  const headers = { "set-cookie": await oauthStateCookie(stateHash, ttlSeconds, cookieSecret) };
  if (env.APP_ENV === "local") return { state, authorizationUrl: input.redirectUri, headers };
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: requiredSecret(env, "GOOGLE_CLIENT_ID"), response_type: "code",
    scope: "openid email profile", redirect_uri: input.redirectUri, state, access_type: "online", prompt: "select_account" }).toString();
  // state 原文只在 Google 授权 URL 中使用；D1 和浏览器 Cookie 均只保存不可逆摘要或其签名绑定。
  console.info(JSON.stringify({ event: "auth.google_oauth_started", stateBoundToBrowser: true }));
  return { authorizationUrl: url.toString(), headers };
}

export async function completeGoogleOAuth(input, request, env, repository) {
  const stateHash = await sha256Hex(String(input.state ?? ""));
  await assertOAuthStateBrowserBinding(request, stateHash, env);
  const pending = await repository.consumeOauthState(stateHash);
  if (env.APP_ENV === "local") {
    invariant(input.code === "valid-local-code", "OAUTH_EXCHANGE_FAILED", "本地 OAuth code 无效", 400);
    const user = await repository.findOrCreateUser({ email: "local-google@example.com", provider: "google", providerSubject: "local-google" });
    return createLogin(user, env, repository);
  }
  const profile = await exchangeGoogleCode(String(input.code ?? ""), pending.redirect_uri, env);
  invariant(profile.email_verified === true, "OAUTH_EMAIL_UNVERIFIED", "Google 邮箱尚未验证", 403);
  const user = await repository.findOrCreateUser({ email: normalizeEmail(profile.email), provider: "google", providerSubject: profile.sub });
  return createLogin(user, env, repository);
}

/** OAuth 回调无论成功或失败都删除本次短寿命绑定 Cookie，防止旧绑定参与后续回调。 */
export function clearGoogleOAuthStateCookie() {
  return cookie(OAUTH_STATE_COOKIE, "", 0, true);
}

export async function currentSession(request, env, repository) {
  const identity = await resolveIdentity(request, env, repository);
  if (!identity) throw new WorkerError("AUTHENTICATION_REQUIRED", "需要先建立会话", 401);
  return { identity: identity.actor, user: identity.user ? publicUser(identity.user, env) : null };
}

export async function logout(request, env, repository) {
  const identity = await resolveIdentity(request, env, repository);
  if (!identity) throw new WorkerError("AUTHENTICATION_REQUIRED", "需要先建立会话", 401);
  if (identity.sessionToken) await repository.deleteSession(await sha256Hex(identity.sessionToken));
  return { data: { revoked: true }, headers: { "set-cookie": cookie("so_session", "", 0, true) } };
}

async function resolveAccount(token, repository) {
  const session = await repository.getSession(await sha256Hex(token));
  invariant(session && session.expires_at > new Date().toISOString(), "INVALID_SESSION", "会话无效或已过期", 401);
  invariant(session.status !== "disabled", "ACCOUNT_DISABLED", "账户已禁用", 403);
  const user = { id: session.user_id, email: session.email_normalized, role: session.role,
    status: session.status, provider: session.provider, providerSubject: session.provider_subject,
    retainAudio: Boolean(session.retain_audio) };
  return { actor: { type: "account", id: user.id }, user, sessionToken: token };
}

async function createLogin(user, env, repository) {
  const token = randomToken();
  await repository.createSession({ tokenHash: await sha256Hex(token), userId: user.id,
    expiresAt: futureIso(runtimeConfig(env).sessionTtlSeconds) });
  return { data: { user: publicUser(user, env) }, headers: { "set-cookie": cookie("so_session", token, runtimeConfig(env).sessionTtlSeconds, true) } };
}

/**
 * Cookie 保存 state 摘要及其 HMAC，不保存可被 OAuth 回调直接使用的 state 原文。
 * 回调先比较同一浏览器 Cookie，再消费 D1 的一次性 state，避免攻击者把自己的授权结果提交给其他浏览器。
 */
async function assertOAuthStateBrowserBinding(request, stateHash, env) {
  const value = parseCookies(request)[OAUTH_STATE_COOKIE] ?? "";
  const separator = value.lastIndexOf(".");
  const cookieHash = separator > 0 ? value.slice(0, separator) : "";
  const signature = separator > 0 ? value.slice(separator + 1) : "";
  const expectedSignature = cookieHash ? await hmacBase64Url(requiredSecret(env, "COOKIE_SECRET"), cookieHash) : "";
  const valid = Boolean(cookieHash && signature)
    && safeEqual(cookieHash, stateHash)
    && safeEqual(signature, expectedSignature);
  if (valid) return;
  console.warn(JSON.stringify({ event: "auth.google_oauth_state_rejected", reason: "browser_binding_mismatch" }));
  throw new WorkerError("OAUTH_STATE_BROWSER_MISMATCH", "OAuth 回调未在发起登录的浏览器中完成", 400);
}

async function oauthStateCookie(stateHash, maxAge, secret) {
  const signature = await hmacBase64Url(secret, stateHash);
  return cookie(OAUTH_STATE_COOKIE, `${stateHash}.${signature}`, maxAge, true);
}

async function sendMagicLink(email, token, redirectUri, env) {
  const link = new URL(redirectUri);
  link.searchParams.set("token", token);
  const response = await fetch("https://api.resend.com/emails", { method: "POST",
    headers: { authorization: `Bearer ${requiredSecret(env, "RESEND_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ from: requiredSecret(env, "MAGIC_LINK_FROM"), to: [email], subject: "Your Speak Confidently sign-in link",
      text: `Open this link to sign in to Speak Confidently: ${link}` }) });
  if (!response.ok) throw new WorkerError("MAIL_DELIVERY_FAILED", "登录邮件发送失败", 502);
}

async function exchangeGoogleCode(code, redirectUri, env) {
  invariant(code, "OAUTH_CODE_REQUIRED", "缺少 OAuth code", 400);
  const body = new URLSearchParams({ code, client_id: requiredSecret(env, "GOOGLE_CLIENT_ID"),
    client_secret: requiredSecret(env, "GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri, grant_type: "authorization_code" });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!tokenResponse.ok) throw new WorkerError("OAUTH_EXCHANGE_FAILED", "Google OAuth 交换失败", 502);
  const token = await tokenResponse.json();
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new WorkerError("OAUTH_PROFILE_FAILED", "Google 用户信息读取失败", 502);
  return profileResponse.json();
}

/** Turnstile token 只从请求体或受控 header 读取，验证后不进入日志、状态或重定向 URL。 */
export async function verifyTurnstile(token, request, env) {
  if (env.APP_ENV === "local" && !env.TURNSTILE_SECRET_KEY) return;
  invariant(token, "TURNSTILE_REQUIRED", "需要完成人机验证", 400);
  const body = new FormData();
  body.set("secret", requiredSecret(env, "TURNSTILE_SECRET_KEY"));
  body.set("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json();
  const expectedHostname = new URL(request.url).hostname;
  // 同一 widget 可登记 Preview 与 Production 域名；必须校验 hostname，避免一个环境签发的 token 跨环境复用。
  invariant(result.success === true && result.hostname === expectedHostname, "TURNSTILE_FAILED", "人机验证失败", 403);
}

async function enforceAuthRateLimits(email, request, repository) {
  const minute = new Date().toISOString().slice(0, 16);
  await repository.incrementQuota(`auth-email:${await sha256Hex(email)}`, minute, 3);
  await enforceIpRateLimit("auth", request, repository, 10);
}

/** IP 只以摘要作为 D1 限流键，复用到 Google 与匿名分析，避免保存原始网络标识。 */
export async function enforceIpRateLimit(scope, request, repository, limit) {
  const minute = new Date().toISOString().slice(0, 16);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  await repository.incrementQuota(`${scope}-ip:${await sha256Hex(ip)}`, minute, limit);
}

function assertRedirect(redirectUri, env) {
  let origin;
  try { origin = new URL(redirectUri).origin; } catch { throw new WorkerError("INVALID_REDIRECT_URI", "认证回跳地址无效", 400); }
  invariant(allowedOrigins(env).includes(origin), "REDIRECT_URI_NOT_ALLOWED", "认证回跳地址不在允许列表", 400);
}

function normalizeEmail(email) {
  const value = String(email ?? "").trim().toLowerCase();
  invariant(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "INVALID_EMAIL", "邮箱格式无效", 400);
  return value;
}

function futureIso(seconds) { return new Date(Date.now() + seconds * 1000).toISOString(); }
function publicUser(user, env) {
  const email = user.email ?? user.email_normalized;
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const role = user.role === "admin" || (normalizedEmail && runtimeConfig(env).adminAccountEmails.has(normalizedEmail)) ? "admin" : user.role;
  return { id: user.id, email, role,
  status: user.status, provider: user.provider, retainAudio: Boolean(user.retainAudio ?? user.retain_audio) }; }
