import assert from "node:assert/strict";
import test from "node:test";
import { completeAuthCallback } from "../src/lib/authCallback.js";

test("Magic Link 回跳消费 token 并标记登录来源", async () => {
  const calls = [];
  const result = await completeAuthCallback("?token=magic-token", {
    async consumeMagicLink(token) { calls.push(["magic", token]); },
    async completeGoogle() { throw new Error("不应调用 Google"); },
  });
  assert.deepEqual(calls, [["magic", "magic-token"]]);
  assert.deepEqual(result, { provider: "magic_link" });
});

test("Google OAuth 回跳消费 state 和 code", async () => {
  const calls = [];
  const result = await completeAuthCallback("?state=oauth-state&code=oauth-code", {
    async consumeMagicLink() { throw new Error("不应调用 Magic Link"); },
    async completeGoogle(state, code) { calls.push(["google", state, code]); },
  });
  assert.deepEqual(calls, [["google", "oauth-state", "oauth-code"]]);
  assert.deepEqual(result, { provider: "google" });
});

test("缺少完整登录参数时拒绝回跳", async () => {
  await assert.rejects(completeAuthCallback("?state=missing-code", {}), {
    code: "INVALID_AUTH_CALLBACK",
  });
});
