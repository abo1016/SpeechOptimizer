import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/auth-service.js";
import { LocalMailer, MockGoogleProvider } from "../fixtures/local-adapters.js";
import { harness } from "./helpers.js";

function authFixture(options = {}) {
  const base = harness(options.now);
  const mailer = new LocalMailer();
  const service = new AuthService({ ...base, mailer, oauthProvider: new MockGoogleProvider(), exposeDevTokens: true,
    allowedRedirectOrigins: ["http://localhost"], ...options });
  return { ...base, mailer, service };
}

test("Magic Link 本地流程创建账户和会话，链接只能使用一次", async () => {
  const { service, mailer } = authFixture();
  const requested = await service.requestMagicLink({ email: " User@Example.COM ", redirectUri: "http://localhost/auth" });
  assert.equal(mailer.messages[0].email, "user@example.com");
  const session = service.consumeMagicLink({ token: requested.previewToken });
  assert.equal(service.authenticate(session.token).email, "user@example.com");
  assert.throws(() => service.consumeMagicLink({ token: requested.previewToken }), { code: "MAGIC_LINK_USED" });
});

test("生产式配置不会从申请接口泄露 Magic Link token", async () => {
  const base = harness();
  const result = await new AuthService({ ...base, mailer: new LocalMailer(), allowedRedirectOrigins: ["https://app.example.com"] }).requestMagicLink({
    email: "safe@example.com", redirectUri: "https://app.example.com/auth",
  });
  assert.deepEqual(result, { accepted: true });
});

test("过期 Magic Link 和无效邮箱被拒绝", async () => {
  let now = 100;
  const fixture = authFixture({ clock: () => now, magicLinkTtlMs: 10 });
  await assert.rejects(() => fixture.service.requestMagicLink({ email: "bad", redirectUri: "http://localhost" }), { code: "INVALID_EMAIL" });
  const request = await fixture.service.requestMagicLink({ email: "ok@example.com", redirectUri: "http://localhost" });
  now = 111;
  assert.throws(() => fixture.service.consumeMagicLink({ token: request.previewToken }), { code: "MAGIC_LINK_EXPIRED" });
});

test("Google OAuth 使用一次性 state 和注入式本地 provider", async () => {
  const { service } = authFixture();
  const started = service.beginGoogleOAuth({ redirectUri: "http://localhost/callback" });
  assert.match(started.authorizationUrl, /^http:\/\/localhost\/mock-google/);
  const session = await service.completeGoogleOAuth({ state: started.state, code: "valid-local-code" });
  assert.equal(session.user.provider, "google");
  await assert.rejects(() => service.completeGoogleOAuth({ state: started.state, code: "valid-local-code" }), { code: "INVALID_OAUTH_STATE" });
});

test("角色权限和禁用账户会阻断访问", async () => {
  const { service, store } = authFixture();
  const request = await service.requestMagicLink({ email: "user@example.com", redirectUri: "http://localhost" });
  const session = service.consumeMagicLink({ token: request.previewToken });
  assert.throws(() => service.authorize(session.token, ["admin"]), { code: "FORBIDDEN" });
  store.users.get(session.user.id).status = "disabled";
  assert.throws(() => service.authenticate(session.token), { code: "ACCOUNT_DISABLED" });
});

test("会话可主动撤销且认证回跳地址必须命中允许列表", async () => {
  const { service } = authFixture();
  await assert.rejects(() => service.requestMagicLink({ email: "user@example.com", redirectUri: "https://evil.example" }), { code: "REDIRECT_URI_NOT_ALLOWED" });
  const request = await service.requestMagicLink({ email: "user@example.com", redirectUri: "http://localhost/auth" });
  const session = service.consumeMagicLink({ token: request.previewToken });
  assert.deepEqual(service.revokeSession(session.token), { revoked: true });
  assert.throws(() => service.authenticate(session.token), { code: "INVALID_SESSION" });
});

test("匿名用户仅有一次且最长 60 秒体验", () => {
  const { service } = authFixture();
  assert.deepEqual(service.useAnonymousTrial({ anonymousId: "anon-1", durationSeconds: 60 }), { accepted: true, remainingTrials: 0 });
  assert.throws(() => service.useAnonymousTrial({ anonymousId: "anon-1", durationSeconds: 30 }), { code: "ANONYMOUS_TRIAL_USED" });
  assert.throws(() => service.useAnonymousTrial({ anonymousId: "anon-2", durationSeconds: 61 }), { code: "ANONYMOUS_DURATION_EXCEEDED" });
});
