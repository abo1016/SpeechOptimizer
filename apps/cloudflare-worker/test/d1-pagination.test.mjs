import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const APP_DIR = join(import.meta.dirname, "..");
const CONFIG = "test/wrangler.d1-pagination.jsonc";
const DATABASE = "speechoptimizer-d1-pagination-test";

test("真实 Wrangler local D1 在同一 created_at 下按复合游标无遗漏无重复", async () => {
  const persistDir = await mkdtemp(join(tmpdir(), "speechoptimizer-d1-pagination-"));
  const port = await findFreePort();
  const logs = [];
  let server;
  try {
    // 迁移 CLI 与后续 dev 进程共享同一个临时持久化目录，因此测试覆盖真实迁移后的 D1 schema。
    await execFileAsync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", DATABASE,
      "--local", "--config", CONFIG, "--persist-to", persistDir], { cwd: APP_DIR });
    server = startWranglerServer(port, persistDir, logs);
    await waitForHarness(port, logs, server);

    const seeded = await requestJson(port, "/seed");
    assert.equal(seeded.seeded, 150);
    const result = await requestJson(port, "/paginate");
    const expectedIds = Array.from({ length: 150 }, (_, index) => `ana_${String(index).padStart(3, "0")}`).reverse();

    assert.deepEqual(result.pageSizes, [100, 50]);
    assert.equal(result.ids.length, 150);
    assert.equal(new Set(result.ids).size, 150);
    assert.deepEqual(result.ids, expectedIds);

    const ticketRace = await requestJson(port, "/upload-ticket-race");
    assert.equal(ticketRace.first.objectKey, ticketRace.second.objectKey);
    assert.equal(ticketRace.first.objectKey, ticketRace.ticket.objectKey);
    assert.equal(ticketRace.storageBytes, 123);
    assert.equal(ticketRace.conflictCode, "UPLOAD_TICKET_CONFLICT");
  } finally {
    if (server) await stopProcess(server);
    // 临时 D1 状态随测试销毁，避免污染工作区 .wrangler 或任何远端数据库。
    await rm(persistDir, { recursive: true, force: true });
  }
});

function startWranglerServer(port, persistDir, logs) {
  const child = execFile("pnpm", ["exec", "wrangler", "dev", "--local", "--config", CONFIG,
    "--port", String(port), "--persist-to", persistDir, "--show-interactive-dev-session", "false"], { cwd: APP_DIR });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  return child;
}

async function waitForHarness(port, logs, server) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Wrangler exited before startup:\n${logs.join("")}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // 启动窗口内端口尚未监听，短暂重试而不是依赖固定 sleep。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Wrangler harness:\n${logs.join("")}`);
}

async function requestJson(port, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function findFreePort() {
  const { createServer } = await import("node:net");
  const listener = createServer();
  await new Promise((resolve, reject) => listener.listen(0, "127.0.0.1", () => resolve()));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}
