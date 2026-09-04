import { mkdir, cp, writeFile } from "node:fs/promises";

// 构建仅复制可发布源码并生成元数据，确保 spike 不触发任何外部服务。
await mkdir("dist", { recursive: true });
await cp("src", "dist/src", { recursive: true });
await cp("fixtures", "dist/fixtures", { recursive: true });
await writeFile("dist/BUILD_INFO.json", JSON.stringify({ builtAt: new Date().toISOString(), network: "disabled" }, null, 2));
console.log("[build] SDK integration spike 构建完成（network disabled）");
