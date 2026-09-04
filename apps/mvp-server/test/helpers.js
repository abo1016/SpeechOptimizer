import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProviders } from "../src/providers.js";
import { createRuntime } from "../src/index.js";
import { loadConfig } from "../src/config.js";

const NODE_LOGGER = { info() {}, warn() {}, error() {} };

export async function startFixture(providerOverrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "speechoptimizer-mvp-"));
  const config = loadConfig({}, { rootDirectory: directory, port: 9876,
    // 测试夹具必须覆盖本地前端实际使用的两个主机名，避免 CORS 契约与默认配置漂移。
    allowedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"] });
  const providers = { ...createProviders(config, NODE_LOGGER), ...providerOverrides };
  const runtime = await createRuntime({ config, providers, logger: NODE_LOGGER });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  return {
    ...runtime, baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => runtime.server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function api(fixture, path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.cookie) headers.cookie = options.cookie;
  let body = options.body;
  if (body && !Buffer.isBuffer(body) && typeof body !== "string") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(`${fixture.baseUrl}${path}`, { method: options.method ?? "GET", headers, body });
  const payload = await response.json();
  return { status: response.status, payload, cookie: response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie") };
}

export function wav(durationSeconds = 1) {
  const sampleRate = 8_000;
  const dataSize = sampleRate * durationSeconds;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + dataSize, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate, 28);
  bytes.writeUInt16LE(1, 32); bytes.writeUInt16LE(8, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}

export async function waitForStatus(fixture, cookie, id, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await api(fixture, `/api/v1/analyses/${id}`, { cookie });
    if (result.payload.data?.status === expected) return result.payload.data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待状态 ${expected} 超时`);
}
