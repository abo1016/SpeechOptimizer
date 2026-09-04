import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("dist");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "apps/mvp-server"), { recursive: true });
await copy("apps/mvp-server/src");
await copy("services/core-platform/src");
await copy("services/account-billing/src");
await copy("services/account-billing/fixtures");
await copy("packages/speech-engine/src");
await copy("packages/provider-adapters/src");
await cp(resolve("CONTRACT.md"), resolve(output, "apps/mvp-server/CONTRACT.md"));
await cp(resolve("package.json"), resolve(output, "apps/mvp-server/package.json"));
await import(new URL("../dist/apps/mvp-server/src/index.js", import.meta.url));
console.info("[mvp-server:build] 已生成 dist 运行时产物");

async function copy(relativePath) {
  const repositoryRoot = resolve("../..");
  await cp(resolve(repositoryRoot, relativePath), resolve(output, relativePath), { recursive: true });
}
