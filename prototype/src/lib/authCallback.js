/**
 * 解析登录回跳参数并调用对应认证端点。
 * Magic Link 与 Google OAuth 共用 `/auth/callback`，避免邮件登录和 OAuth 各维护一套回跳页面。
 */
export async function completeAuthCallback(search, authResources) {
  const params = new URLSearchParams(search);
  const token = params.get("token");
  if (token) {
    await authResources.consumeMagicLink(token);
    return { provider: "magic_link" };
  }

  const state = params.get("state");
  const code = params.get("code");
  if (state && code) {
    await authResources.completeGoogle(state, code);
    return { provider: "google" };
  }

  throw Object.assign(new Error("The sign-in response is incomplete. Return to the home page and try again."), {
    code: "INVALID_AUTH_CALLBACK",
  });
}
