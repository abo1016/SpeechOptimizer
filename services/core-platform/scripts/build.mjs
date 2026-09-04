import { cp, mkdir, rm, writeFile } from "node:fs/promises";

// dist 仅包含可运行源码、契约和 fixture，不携带本地数据库或用户音频。
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("src", "dist/src", { recursive: true });
await cp("fixtures", "dist/fixtures", { recursive: true });
await cp("CONTRACT.md", "dist/CONTRACT.md");
await writeFile("dist/BUILD_INFO.json", `${JSON.stringify({
  builtAt: new Date().toISOString(),
  runtime: "node>=24",
  containsLocalData: false,
}, null, 2)}\n`);
console.log("[build] core-platform 构建完成，未包含 .local 数据");
