import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("sends JSON with credentials and preserves custom idempotency headers", async () => {
  let request;
  const client = createApiClient({ baseUrl: "http://api.test", fetchImpl: async (url, init) => {
    request = { url, init };
    return jsonResponse({ data: { accepted: true } }, 202);
  } });
  const result = await client.post("/api/v1/analyses", { retainAudio: false }, { headers: { "idempotency-key": "test-key-123" } });
  assert.deepEqual(result, { accepted: true });
  assert.equal(request.url, "http://api.test/api/v1/analyses");
  assert.equal(request.init.credentials, "include");
  assert.equal(request.init.headers["content-type"], "application/json");
  assert.equal(request.init.headers["idempotency-key"], "test-key-123");
});

test("uploads audio as an octet stream without serializing the Blob", async () => {
  const blob = new Blob(["audio"], { type: "audio/webm" });
  let request;
  const client = createApiClient({ fetchImpl: async (_url, init) => {
    request = init;
    return jsonResponse({ data: { status: "uploaded" } }, 202);
  } });
  await client.upload("/api/v1/analyses/a1/audio", blob);
  assert.equal(request.body, blob);
  assert.equal(request.headers["content-type"], "application/octet-stream");
});

test("raises the stable service error code and details", async () => {
  const client = createApiClient({ fetchImpl: async () => jsonResponse({ error: {
    code: "ANONYMOUS_TRIAL_USED", message: "trial used", details: { remaining: 0 },
  } }, 409) });
  await assert.rejects(client.get("/api/v1/session"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "ANONYMOUS_TRIAL_USED");
    assert.equal(error.status, 409);
    assert.deepEqual(error.details, { remaining: 0 });
    return true;
  });
});

test("turns transport failures into a recoverable network error", async () => {
  const client = createApiClient({ fetchImpl: async () => { throw new TypeError("offline"); } });
  await assert.rejects(client.get("/health"), { code: "NETWORK_ERROR", message: "offline" });
});

test("preserves an aborted request so polling can stop without a false network error", async () => {
  const controller = new AbortController();
  const aborted = Object.assign(new Error("stopped"), { name: "AbortError" });
  controller.abort(aborted);
  const client = createApiClient({ fetchImpl: async () => { throw aborted; } });
  await assert.rejects(client.get("/api/v1/analyses/a1", { signal: controller.signal }), (error) => error === aborted);
});
