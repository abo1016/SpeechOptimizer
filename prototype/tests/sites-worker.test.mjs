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

test("falls back to index.html for GET and HEAD unknown app routes", async () => {
  for (const method of ["GET", "HEAD"]) {
    const calls = [];
    const response = await worker.fetch(
      new Request("https://example.test/flow/step-two?source=share", {
        method,
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

    assert.equal(response.status, 200, method);
    assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"], method);
  }
});

test("proxies /health to the configured origin", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/health"),
    {
      API_ORIGIN: "https://speechoptimizer-api.example",
      API: {
        fetch: async (request) => {
          calls.push({ method: request.method, url: request.url });
          return Response.json({ data: { status: "ok" } });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ method: "GET", url: "https://speechoptimizer-api.example/health" }]);
});

test("forwards API write method, body and request headers", async () => {
  const calls = [];
  for (const method of ["POST", "PUT"]) {
    const body = JSON.stringify({ method });
    const response = await worker.fetch(
      new Request(`https://example.test/api/v1/session?method=${method}`, {
        method,
        body,
        headers: {
          "content-type": "application/json",
          "cookie": "so_session=test",
          "x-client-trace": "trace-123",
        },
      }),
      {
        API_ORIGIN: "https://speechoptimizer-api.example",
        API: {
          fetch: async (request) => {
            calls.push({
              body: await request.text(),
              contentType: request.headers.get("content-type"),
              cookie: request.headers.get("cookie"),
              method: request.method,
              trace: request.headers.get("x-client-trace"),
              url: request.url,
            });
            return Response.json({ data: { ok: true } });
          },
        },
      },
    );

    assert.equal(response.status, 200, method);
  }

  assert.deepEqual(calls, ["POST", "PUT"].map((method) => ({
    body: JSON.stringify({ method }),
    contentType: "application/json",
    cookie: "so_session=test",
    method,
    trace: "trace-123",
    url: `https://speechoptimizer-api.example/api/v1/session?method=${method}`,
  })));
});

test("returns a stable 503 for missing or invalid API origin", async () => {
  const cases = [
    { name: "missing", env: {} },
    { name: "malformed", env: { API_ORIGIN: "not a URL" } },
    { name: "unsupported scheme", env: { API_ORIGIN: "ftp://internal.example" } },
  ];
  for (const { name, env } of cases) {
    const response = await worker.fetch(
      new Request("https://example.test/api/v1/session", { headers: { accept: "application/json" } }),
      env,
    );

    assert.equal(response.status, 503, name);
    assert.equal(await response.text(), "API is unavailable", name);
  }
});

test("returns 502 without exposing upstream fetch errors", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/v1/session"),
    {
      API_ORIGIN: "https://speechoptimizer-api.example",
      API: { fetch: async () => { throw new Error("private upstream diagnostic"); } },
    },
  );

  assert.equal(response.status, 502);
  assert.equal(await response.text(), "API is unavailable");
});

test("does not turn write requests into the app shell", async () => {
  for (const method of ["POST", "PUT"]) {
    let calls = 0;
    const response = await worker.fetch(
      new Request("https://example.test/flow", { method, headers: { accept: "text/html" } }),
      {
        ASSETS: {
          fetch: async () => {
            calls += 1;
            return new Response("missing", { status: 404 });
          },
        },
      },
    );

    assert.equal(response.status, 404, method);
    assert.equal(calls, 1, method);
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});
