import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const output = new URL("../dist", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// 构建仅复制运行时源码、测试夹具与契约，不触发网络请求或安装依赖。
await cp(new URL("../src", import.meta.url), new URL("../dist/src", import.meta.url), { recursive: true });
await cp(new URL("../fixtures", import.meta.url), new URL("../dist/fixtures", import.meta.url), { recursive: true });
await cp(new URL("../CONTRACT.md", import.meta.url), new URL("../dist/CONTRACT.md", import.meta.url));
await cp(new URL("../.env.example", import.meta.url), new URL("../dist/.env.example", import.meta.url));

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await writeFile(new URL("../dist/package.json", import.meta.url), `${JSON.stringify({
  name: manifest.name, version: manifest.version, private: manifest.private, type: manifest.type, exports: "./src/index.js",
}, null, 2)}\n`);
console.info("[provider-adapters] 构建完成：未执行任何外部请求");
