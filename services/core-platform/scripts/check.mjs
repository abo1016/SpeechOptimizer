import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "fixtures", "scripts", "test"];
const files = (await Promise.all(roots.map((root) => collect(root)))).flat();
for (const file of files) {
  const source = await readFile(file, "utf8");
  const lineCount = source.split("\n").length;
  if (lineCount > 300) throw new Error(`${file} 超过 300 行：${lineCount}`);
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${file} 语法检查失败`);
}
console.log(`[check] ${files.length} 个 JavaScript 文件通过语法与文件长度门禁`);

async function collect(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  }));
  return nested.flat().filter((file) => file.endsWith(".js") || file.endsWith(".mjs"));
}
