import assert from "node:assert/strict";
import test from "node:test";
import { createResources } from "../src/api/resources.js";

const CHECKSUM = "a".repeat(64);

test("三段式上传先申请单对象 URL，再完成服务端核验", async () => {
  const calls = [];
  const audio = new Blob(["webm"], { type: "audio/webm" });
  const client = {
    async post(path, body) {
      calls.push({ path, body });
      if (path.endsWith("/audio-upload")) {
        return {
          uploadUrl: "https://storage.example.test/upload-ticket",
          objectKey: "audio/anonymous-anon_1/ana_1/source.webm",
          headers: { "x-upsert": "false", "x-metadata": "encoded-checksum" },
        };
      }
      return { id: "ana_1", status: "uploaded" };
    },
  };
  let directRequest;
  const resources = createResources({
    client,
    fetchImpl: async (url, init) => {
      directRequest = { url, init };
      return new Response(null, { status: 200 });
    },
    sha256Hex: async () => CHECKSUM,
  });

  const result = await resources.uploadAudio("ana_1", audio);

  assert.deepEqual(result, { id: "ana_1", status: "uploaded" });
  assert.deepEqual(calls, [
    {
      path: "/api/v1/analyses/ana_1/audio-upload",
      body: { size: audio.size, mime: "audio/webm", sha256: CHECKSUM },
    },
    {
      path: "/api/v1/analyses/ana_1/audio-complete",
      body: {
        objectKey: "audio/anonymous-anon_1/ana_1/source.webm",
        size: audio.size,
        mime: "audio/webm",
        sha256: CHECKSUM,
      },
    },
  ]);
  assert.equal(directRequest.url, "https://storage.example.test/upload-ticket");
  assert.equal(directRequest.init.method, "PUT");
  assert.equal(directRequest.init.body, audio);
  assert.deepEqual(directRequest.init.headers, {
    "x-upsert": "false",
    "x-metadata": "encoded-checksum",
    "content-type": "audio/webm",
  });
});

test("本地直传兼容路径直接采用上传端点返回的分析任务", async () => {
  const calls = [];
  const client = {
    async post(path) {
      calls.push(path);
      return {
        uploadUrl: "http://localhost:8787/api/v1/analyses/ana_1/audio",
        directComplete: true,
        headers: { "x-audio-sha256": CHECKSUM },
      };
    },
  };
  const resources = createResources({
    client,
    fetchImpl: async () => new Response(JSON.stringify({ data: { id: "ana_1", status: "uploaded" } }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
    sha256Hex: async () => CHECKSUM,
  });

  const result = await resources.uploadAudio("ana_1", new Blob(["webm"], { type: "audio/webm" }));

  assert.deepEqual(result, { id: "ana_1", status: "uploaded" });
  assert.deepEqual(calls, ["/api/v1/analyses/ana_1/audio-upload"]);
});

test("对象存储直传失败时不伪造 audio-complete 请求", async () => {
  const calls = [];
  const client = {
    async post(path) {
      calls.push(path);
      return { uploadUrl: "https://storage.example.test/rejected", objectKey: "audio/ana_1/source.webm" };
    },
  };
  const resources = createResources({
    client,
    fetchImpl: async () => new Response(null, { status: 403 }),
    sha256Hex: async () => CHECKSUM,
  });

  await assert.rejects(resources.uploadAudio("ana_1", new Blob(["webm"])), /status 403/);
  assert.deepEqual(calls, ["/api/v1/analyses/ana_1/audio-upload"]);
});

test("免费 Beta 管理面只读取失败分析并请求受控重试端点", async () => {
  const calls = [];
  const resources = createResources({
    client: {
      async get(path) { calls.push({ method: "GET", path }); return { items: [] }; },
      async post(path) { calls.push({ method: "POST", path }); return { id: "ana_failed", status: "uploaded" }; },
    },
  });

  await resources.adminFailedAnalyses({ limit: 50 });
  await resources.adminRetry("ana_failed");

  assert.deepEqual(calls, [
    { method: "GET", path: "/api/v1/admin/analyses?status=failed&limit=50" },
    { method: "POST", path: "/api/v1/admin/analyses/ana_failed/retry" },
  ]);
});
