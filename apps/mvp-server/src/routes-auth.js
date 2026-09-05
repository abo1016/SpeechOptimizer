import { clearCookie, createAnonymousCookie, parseCookies, sessionCookie,
  verifyAnonymous } from "./cookies.js";
import { HttpError } from "./errors.js";

export function resolveIdentity(request, application, config, required = true) {
  const cookies = parseCookies(request.headers.cookie);
  if (cookies.so_session) {
    const user = application.auth.authenticate(cookies.so_session);
    return { actor: { type: "account", id: user.id }, user, sessionToken: cookies.so_session };
  }
  const anonymousId = verifyAnonymous(cookies.so_anonymous, config.cookieSecret);
  if (anonymousId) return { actor: { type: "anonymous", id: anonymousId }, user: null };
  if (!required) return null;
  throw new HttpError("AUTHENTICATION_REQUIRED", "需要先建立匿名或账户会话", 401);
}

export async function handleAuth(context) {
  const { request, response, pathname, application, config, json, success } = context;
  if (request.method === "POST" && pathname === "/api/v1/anonymous/session") {
    let existing;
    let clearSession = false;
    try {
      existing = resolveIdentity(request, application, config, false);
    } catch (error) {
      if (error.code !== "INVALID_SESSION" && error.code !== "ACCOUNT_DISABLED") throw error;
      clearSession = true;
    }
    if (existing) return success(200, { identity: existing.actor });
    const created = createAnonymousCookie(config.cookieSecret, config.secureCookies);
    const headers = clearSession
      ? { "set-cookie": [clearCookie("so_session", config.secureCookies), created.header] }
      : { "set-cookie": created.header };
    return success(201, { identity: { type: "anonymous", id: created.id } }, headers);
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/magic-link") {
    const result = await application.auth.requestMagicLink(await json());
    await application.store.flush();
    return success(202, result);
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/magic-link/consume") {
    return login(application.auth.consumeMagicLink(await json()), context);
  }
  if (request.method === "GET" && pathname === "/api/v1/auth/google/start") {
    return success(200, application.auth.beginGoogleOAuth({ redirectUri: context.url.searchParams.get("redirectUri") }));
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/google/complete") {
    return login(await application.auth.completeGoogleOAuth(await json()), context);
  }
  if (request.method === "GET" && pathname === "/api/v1/session") {
    const identity = resolveIdentity(request, application, config);
    return success(200, { identity: identity.actor, user: identity.user });
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/logout") return logout(context);
  return false;
}

async function login(session, context) {
  const { application, config, success } = context;
  application.entitlements.grant({ userId: session.user.id, amount: 5,
    source: "free", sourceId: `mvp-initial-free:${session.user.id}` });
  await application.store.flush();
  return success(200, { user: session.user }, { "set-cookie": sessionCookie(session.token, config.secureCookies) });
}

async function logout(context) {
  const identity = resolveIdentity(context.request, context.application, context.config);
  if (identity.sessionToken) context.application.auth.revokeSession(identity.sessionToken);
  await context.application.store.flush();
  return context.success(200, { revoked: true }, { "set-cookie": clearCookie("so_session", context.config.secureCookies) });
}
