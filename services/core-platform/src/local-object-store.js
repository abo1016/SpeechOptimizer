import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** 本地对象存储适配器；对象键由核心服务生成，不接受用户传入路径。 */
export class LocalObjectStore {
  constructor(rootDirectory) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async put(objectKey, bytes) {
    const filePath = this.#path(objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes, { mode: 0o600 });
    return { objectKey, size: bytes.byteLength };
  }

  async get(objectKey) {
    return readFile(this.#path(objectKey));
  }

  async delete(objectKey) {
    await rm(this.#path(objectKey), { force: true });
  }

  #path(objectKey) {
    const filePath = resolve(join(this.rootDirectory, objectKey));
    if (!filePath.startsWith(`${this.rootDirectory}/`)) throw new Error("非法对象键");
    return filePath;
  }
}
