import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// 递归检查包内手写 JavaScript，避免新增文件遗漏语法门禁。
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const base = directory instanceof URL ? fileURLToPath(directory) : directory;
    const path = join(base, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  }));
  return files.flat().filter((file) => file.endsWith(".js") || file.endsWith(".mjs"));
}

const files = [
  ...(await collect(new URL("../src", import.meta.url))),
  ...(await collect(new URL("../fixtures", import.meta.url))),
  ...(await collect(new URL("../test", import.meta.url))),
  new URL("./build.mjs", import.meta.url).pathname,
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.info(`[provider-adapters] 语法检查完成，共检查 ${files.length} 个文件`);
