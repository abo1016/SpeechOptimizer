import assert from "node:assert/strict";
import test from "node:test";
import { loadSessionWithAnonymousFallback } from "../src/state/sessionBootstrap.js";

test("首次无匿名 Cookie 时应初始化匿名会话并重试 session", async () => {
  const calls = [];
  const resources = {
    async session() {
      calls.push("session");
      if (calls.length === 1) throw Object.assign(new Error("需要会话"), {
        code: "AUTHENTICATION_REQUIRED", status: 401,
      });
      return { identity: { type: "anonymous", id: "anon_test" } };
    },
    async ensureAnonymous() { calls.push("ensureAnonymous"); },
  };
  const session = await loadSessionWithAnonymousFallback(resources);
  assert.deepEqual(session.identity, { type: "anonymous", id: "anon_test" });
  assert.deepEqual(calls, ["session", "ensureAnonymous", "session"]);
});
