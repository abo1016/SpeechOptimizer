import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

// 本包没有转译依赖；构建只发布经过测试的 ESM 源码和契约，保持产物可审计。
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("src", "dist/src", { recursive: true });
cpSync("CONTRACT.md", "dist/CONTRACT.md");
writeFileSync("dist/BUILD_INFO.json", `${JSON.stringify({ format: "esm", node: ">=20" }, null, 2)}\n`);
