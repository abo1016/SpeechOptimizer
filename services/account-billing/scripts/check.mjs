import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// check 脚本递归验证源码语法，避免新增文件后忘记维护固定文件清单。
function files(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".js") || path.endsWith(".mjs") ? [path] : [];
  });
}

for (const file of [...files("src"), ...files("fixtures"), ...files("scripts"), ...files("test")]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
