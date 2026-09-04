import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("proxies API requests to the configured origin", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/api/v1/session?fresh=1", {
      headers: { accept: "application/json", cookie: "so_session=test" },
    }),
    {
      API_ORIGIN: "https://speechoptimizer-api.example",
      API: {
        fetch: async (request) => {
          calls.push({ url: request.url, cookie: request.headers.get("cookie") });
          return Response.json({ data: { ok: true } });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{
    url: "https://speechoptimizer-api.example/api/v1/session?fresh=1",
    cookie: "so_session=test",
  }]);
});

test("returns a stable error when the API origin is missing", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/v1/session", { headers: { accept: "application/json" } }),
    { ASSETS: { fetch: async () => new Response("asset") } },
  );

  assert.equal(response.status, 503);
});

test("does not turn write requests into the app shell", async () => {
  let calls = 0;
  const response = await worker.fetch(
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});
