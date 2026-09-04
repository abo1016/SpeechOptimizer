#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 统一门禁只编排仓库已有命令，不在验证阶段安装依赖或修改锁文件。
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROTOTYPE_DIR = path.join(REPO_ROOT, "prototype");
const INTEGRATIONS_DIR = path.join(REPO_ROOT, "spikes", "sdk-integrations");
const INFRA_DIR = path.join(REPO_ROOT, "infra", "local");
const PNPM_BIN = process.env.PNPM_BIN || "pnpm";
const VALID_SCOPES = new Set(["all", "prototype", "integrations", "services"]);

// 运行时包统一执行三道门禁，确保实现、测试和产物均可验证。
const RUNTIME_PACKAGES = [
  ["语音分析引擎", path.join(REPO_ROOT, "packages", "speech-engine")],
  ["Provider 适配层", path.join(REPO_ROOT, "packages", "provider-adapters")],
  ["核心平台服务", path.join(REPO_ROOT, "services", "core-platform")],
  ["账户计费服务", path.join(REPO_ROOT, "services", "account-billing")],
  ["MVP HTTP 服务", path.join(REPO_ROOT, "apps", "mvp-server")],
];

function log(message) {
  console.log(`[quality-gate] ${message}`);
}

function fail(message) {
  console.error(`[quality-gate] 失败：${message}`);
  return false;
}

function run(label, command, args, cwd) {
  log(`开始：${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    return fail(`${label} 无法启动：${result.error.message}`);
  }
  if (result.status !== 0) {
    return fail(`${label} 退出码为 ${result.status ?? "未知"}`);
  }

  log(`通过：${label}`);
  return true;
}

function readScripts(packageDir) {
  const packagePath = path.join(packageDir, "package.json");
  if (!existsSync(packagePath)) {
    return null;
  }

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  return packageJson.scripts ?? {};
}

function listFeatureTests() {
  const testsDir = path.join(PROTOTYPE_DIR, "tests");
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.mjs"))
    .filter((name) => name !== "sites-worker.test.mjs")
    .map((name) => path.join("tests", name));
}

function runPrototype(requireFeatureTests) {
  const tests = listFeatureTests();
  const results = [
    run("原型生产构建", PNPM_BIN, ["run", "build"], PROTOTYPE_DIR),
    run("Sites Worker 测试", PNPM_BIN, ["run", "test:sites"], PROTOTYPE_DIR),
  ];

  if (tests.length > 0) {
    results.push(run("原型功能定向测试", process.execPath, ["--test", ...tests], PROTOTYPE_DIR));
  } else if (requireFeatureTests) {
    results.push(fail("要求功能定向测试，但 prototype/tests 中没有新增测试文件"));
  } else {
    log("基线模式：当前未发现额外功能定向测试");
  }

  return results.every(Boolean);
}

function runIntegrations() {
  const scripts = readScripts(INTEGRATIONS_DIR);
  if (!scripts) {
    return fail("集成 SDK 包尚不存在，不能跳过该门禁");
  }

  const requiredScripts = ["check", "test", "build"];
  const missing = requiredScripts.filter((name) => !scripts[name]);
  if (missing.length > 0) {
    return fail(`集成 SDK 缺少脚本：${missing.join(", ")}`);
  }

  return requiredScripts
    .map((name) => run(`集成 SDK ${name}`, PNPM_BIN, ["run", name], INTEGRATIONS_DIR))
    .every(Boolean);
}

function runPackage(label, packageDir) {
  const scripts = readScripts(packageDir);
  if (!scripts) {
    return fail(`${label} 缺少 package.json，不能跳过该门禁`);
  }
  const requiredScripts = ["check", "test", "build"];
  const missing = requiredScripts.filter((name) => !scripts[name]);
  if (missing.length > 0) {
    return fail(`${label} 缺少脚本：${missing.join(", ")}`);
  }
  return requiredScripts
    .map((name) => run(`${label} ${name}`, PNPM_BIN, ["run", name], packageDir))
    .every(Boolean);
}

function runServices() {
  return RUNTIME_PACKAGES.map(([label, packageDir]) => runPackage(label, packageDir)).every(Boolean);
}

function runInfrastructure() {
  // 基础设施只运行静态契约门禁，不启动容器或连接外部服务。
  const check = run("本地基础设施静态检查", "sh", ["scripts/check.sh"], INFRA_DIR);
  const test = run("本地基础设施契约测试", "sh", ["scripts/test.sh"], INFRA_DIR);
  return check && test;
}

function main() {
  const scope = process.argv[2] ?? "all";
  const requireFeatureTests = process.argv.includes("--require-feature-tests");
  if (!VALID_SCOPES.has(scope)) {
    console.error("用法：node scripts/quality-gate.mjs [all|prototype|integrations|services] [--require-feature-tests]");
    process.exitCode = 2;
    return;
  }

  const results = [];
  if (scope === "all" || scope === "prototype") {
    results.push(runPrototype(requireFeatureTests));
  }
  if (scope === "all" || scope === "integrations") {
    results.push(runIntegrations());
  }
  if (scope === "all" || scope === "services") {
    results.push(runServices());
    results.push(runInfrastructure());
  }

  process.exitCode = results.every(Boolean) ? 0 : 1;
  log(process.exitCode === 0 ? "全部门禁通过" : "存在未通过门禁");
}

main();
