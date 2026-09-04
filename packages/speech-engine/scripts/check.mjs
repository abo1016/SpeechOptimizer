import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// 递归收集源码与测试脚本，确保独立包内所有 JavaScript 都经过语法检查。
async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const basePath = directory instanceof URL ? fileURLToPath(directory) : directory;
    const path = join(basePath, entry.name);
    return entry.isDirectory() ? collectJavaScriptFiles(path) : [path];
  }));
  return nested.flat().filter((path) => path.endsWith(".js") || path.endsWith(".mjs"));
}

const files = [
  ...(await collectJavaScriptFiles(new URL("../src", import.meta.url))),
  ...(await collectJavaScriptFiles(new URL("../test", import.meta.url))),
  new URL("./build.mjs", import.meta.url).pathname,
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.info(`[speech-engine] 语法检查完成，共检查 ${files.length} 个文件`);
