import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const roots = [resolve("src"), resolve("test"), resolve("scripts")];
for (const root of roots) await visit(root);
console.info("[mvp-server:check] JavaScript 语法检查通过");

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) check(path);
  }
}

function check(path) {
  const result = spawnSync(process.execPath, ["--check", path], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
