import assert from "node:assert/strict";
import test from "node:test";

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
    dependencies: { assets: true },
  });
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
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("非 API 请求交给 Static Assets binding", async () => {
  const response = await routeRequest(
    new Request("https://example.test/dashboard"),
    createEnv(new Response("spa", { status: 200, headers: { "content-type": "text/html" } })),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "spa");
});
