import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const outputDirectory = new URL("../dist", import.meta.url);

// 构建只复制已通过检查的 ESM 源码，不引入打包器或隐式网络依赖。
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(new URL("../src", import.meta.url), new URL("../dist/src", import.meta.url), {
  recursive: true,
});

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const distributionManifest = {
  name: packageJson.name,
  version: packageJson.version,
  private: packageJson.private,
  type: packageJson.type,
  exports: "./src/index.js",
};
await writeFile(join(packageRoot.pathname, "dist", "package.json"), `${JSON.stringify(distributionManifest, null, 2)}\n`);
console.info("[speech-engine] 构建完成：dist 包仅包含运行时源码与清单");
