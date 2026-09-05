import assert from "node:assert/strict";
import test from "node:test";

import { beginGoogleOAuth, clearGoogleOAuthStateCookie, completeGoogleOAuth, verifyTurnstile } from "../src/auth.js";
import { jsonResponse } from "../src/http.js";
import { routeRequest } from "../src/router.js";

function createEnv(assetResponse = new Response("asset", { status: 200 })) {
  return {
    APP_ENV: "local",
    APP_VERSION: "test-version",
    RESOURCE_NAMESPACE: "speechoptimizer-local",
    ASSETS: {
      async fetch() {
        return assetResponse.clone();
      },
    },
  };
}

test("health 只暴露版本、环境和依赖可用性", async () => {
  const response = await routeRequest(new Request("https://example.test/health"), createEnv());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    version: "test-version",
    environment: "local",
    mode: "mock",
    authMode: "mock",
    turnstileSiteKey: null,
    dependencies: { assets: true, d1: false, storage: false, queue: false, workflow: false },
  });
});

test("Preview health 只有配置 Supabase server secret 才报告 storage 可用", async () => {
  const base = {
    ...createEnv(),
    APP_ENV: "preview",
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_STORAGE_BUCKET: "speechoptimizer-preview-audio",
  };
  const withoutSecret = await routeRequest(new Request("https://example.test/health"), base);
  assert.equal((await withoutSecret.json()).dependencies.storage, false);

  const withSecret = await routeRequest(new Request("https://example.test/health"), {
    ...base,
    SUPABASE_SECRET_KEY: "sb_secret_test",
  });
  assert.equal((await withSecret.json()).dependencies.storage, true);
});

test("health 对不支持的方法返回 JSON 405", async () => {
  const response = await routeRequest(
    new Request("https://example.test/health", { method: "POST" }),
    createEnv(),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
});

test("未实现 API 返回稳定 JSON 404", async () => {
  const response = await routeRequest(
    new Request("https://example.test/api/v1/missing", { method: "POST" }),
    createEnv(),
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "ROUTE_NOT_FOUND");
});

test("Google OAuth start 不再接受会泄露 Turnstile token 的 GET query", async () => {
  const response = await routeRequest(
    new Request("https://example.test/api/v1/auth/google/start?turnstileToken=token"),
    createEnv(),
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "ROUTE_NOT_FOUND");
});

test("Turnstile token 必须与当前 Worker hostname 匹配", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "preview.example.test" });
  try {
    await assert.rejects(() => verifyTurnstile("token", new Request("https://production.example.test/api/v1/analyses"), {
      APP_ENV: "preview",
      TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    }), { code: "TURNSTILE_FAILED" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("携带身份 Cookie 的写请求缺少或伪造 Origin 会被拒绝，安全 GET 和 health 例外", async () => {
  const env = { ...createEnv(), ALLOWED_ORIGINS: "https://app.example.test" };
  const missing = await routeRequest(new Request("https://example.test/api/v1/missing", {
    method: "POST", headers: { cookie: "so_session=session-token" },
  }), env);
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).error.code, "ORIGIN_REQUIRED");

  const rejected = await routeRequest(new Request("https://example.test/api/v1/missing", {
    method: "DELETE", headers: { cookie: "so_anonymous=anonymous-token", origin: "https://attacker.example" },
  }), env);
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, "ORIGIN_NOT_ALLOWED");

  const safeGet = await routeRequest(new Request("https://example.test/api/v1/missing", {
    headers: { cookie: "so_session=session-token" },
  }), env);
  assert.equal(safeGet.status, 404);

  const health = await routeRequest(new Request("https://example.test/health", {
    method: "POST", headers: { cookie: "so_session=session-token" },
  }), env);
  assert.equal(health.status, 405);
});

test("Google OAuth 只接受 allowlist 回跳，并将 state 绑定到发起浏览器 Cookie", async () => {
  const stored = [];
  const repository = {
    async incrementQuota() {},
    async saveOauthState(record) { stored.push(record); },
  };
  const env = {
    APP_ENV: "preview",
    ALLOWED_ORIGINS: "https://app.example.test",
    COOKIE_SECRET: "test-cookie-secret",
    GOOGLE_CLIENT_ID: "google-client-id",
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    return Response.json({ success: true, hostname: "worker.example.test" });
  };
  let started;
  try {
    started = await beginGoogleOAuth({ redirectUri: "https://app.example.test/auth/callback", turnstileToken: "test-token" },
      new Request("https://worker.example.test/api/v1/auth/google/start", { method: "POST" }), env, repository);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const authorizationUrl = new URL(started.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");
  assert.equal(authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "https://app.example.test/auth/callback");
  assert.ok(state);
  assert.equal("state" in started, false);
  assert.match(started.headers["set-cookie"], /^so_oauth_state=/);
  assert.match(started.headers["set-cookie"], /HttpOnly; SameSite=Lax; Max-Age=900; Secure$/);
  assert.equal(started.headers["set-cookie"].includes(state), false);
  assert.equal(stored.length, 1);

  await assert.rejects(() => beginGoogleOAuth({ redirectUri: "https://attacker.example/auth/callback" },
    new Request("https://worker.example.test/api/v1/auth/google/start", { method: "POST" }), env, repository),
  { code: "REDIRECT_URI_NOT_ALLOWED" });
});

test("Google OAuth 回调先验证浏览器 Cookie，再消费一次性 state", async () => {
  const consumed = [];
  const env = { APP_ENV: "local", ALLOWED_ORIGINS: "https://app.example.test", COOKIE_SECRET: "test-cookie-secret" };
  const repository = {
    async incrementQuota() {},
    async saveOauthState(record) { this.state = record; },
    async consumeOauthState(stateHash) {
      consumed.push(stateHash);
      assert.equal(stateHash, this.state.stateHash);
      return { redirect_uri: "https://app.example.test/auth/callback" };
    },
    async findOrCreateUser() { return { id: "usr_local", email_normalized: "local-google@example.com", role: "user", status: "active" }; },
    async createSession() {},
  };
  const started = await beginGoogleOAuth({ redirectUri: "https://app.example.test/auth/callback" },
    new Request("https://worker.example.test/api/v1/auth/google/start", { method: "POST" }), env, repository);
  const cookie = started.headers["set-cookie"].split(";", 1)[0];

  await assert.rejects(() => completeGoogleOAuth({ state: started.state, code: "valid-local-code" },
    new Request("https://worker.example.test/api/v1/auth/google/complete", { method: "POST", headers: { cookie: "so_oauth_state=tampered" } }), env, repository),
  { code: "OAUTH_STATE_BROWSER_MISMATCH" });
  assert.equal(consumed.length, 0);

  const completed = await completeGoogleOAuth({ state: started.state, code: "valid-local-code" },
    new Request("https://worker.example.test/api/v1/auth/google/complete", { method: "POST", headers: { cookie } }), env, repository);
  assert.equal(consumed.length, 1);
  assert.match(completed.headers["set-cookie"], /^so_session=/);

  const response = jsonResponse({}, 200, { "set-cookie": [completed.headers["set-cookie"], clearGoogleOAuthStateCookie()] });
  assert.match(response.headers.get("set-cookie"), /so_session=/);
  assert.match(response.headers.get("set-cookie"), /so_oauth_state=; Path=\//);
});

test("Google OAuth 回调校验失败仍单次清除浏览器 state Cookie", async () => {
  const response = await routeRequest(new Request("https://worker.example.test/api/v1/auth/google/complete", {
    method: "POST",
    body: JSON.stringify({ state: "forged-state", code: "valid-local-code" }),
  }), { ...createEnv(), COOKIE_SECRET: "test-cookie-secret" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "OAUTH_STATE_BROWSER_MISMATCH");
  assert.match(response.headers.get("set-cookie"), /so_oauth_state=; Path=\//);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Max-Age=0; Secure$/);
});

test("管理员失败分析接口拒绝未登录与普通账户", async () => {
  const unauthenticated = await routeRequest(new Request("https://example.test/api/v1/admin/analyses?status=failed"), {
    ...createEnv(),
    COOKIE_SECRET: "test-cookie-secret",
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.code, "AUTHENTICATION_REQUIRED");

  const userSession = {
    user_id: "usr_user", email_normalized: "user@example.test", role: "user", status: "active",
    provider: "magic_link", provider_subject: null, retain_audio: 0, expires_at: "2099-01-01T00:00:00.000Z",
  };
  const database = {
    prepare() {
      return { bind() { return { async first() { return userSession; } }; } };
    },
  };
  const forbidden = await routeRequest(new Request("https://example.test/api/v1/admin/analyses?status=failed", {
    headers: { cookie: "so_session=test-session" },
  }), { ...createEnv(), COOKIE_SECRET: "test-cookie-secret", DB: database });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "FORBIDDEN");
});

test("非 API 请求交给 Static Assets binding", async () => {
  const response = await routeRequest(
    new Request("https://example.test/dashboard"),
    createEnv(new Response("spa", { status: 200, headers: { "content-type": "text/html" } })),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "spa");
});
