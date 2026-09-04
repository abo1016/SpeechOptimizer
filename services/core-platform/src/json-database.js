import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY_DATABASE = Object.freeze({ analyses: {}, idempotency: {}, audits: [] });

/**
 * 小型本地 JSON 数据库。写操作在进程内串行，并通过同目录临时文件 rename 原子替换。
 * 该实现服务于本地 MVP；多实例部署时必须替换为具备事务能力的数据库适配器。
 */
export class JsonDatabase {
  #queue = Promise.resolve();

  constructor(filePath) {
    this.filePath = filePath;
  }

  async read(reader) {
    await this.#queue;
    return reader(structuredClone(await this.#load()));
  }

  async write(mutator) {
    const operation = this.#queue.then(async () => {
      const data = await this.#load();
      const result = await mutator(data);
      await this.#save(data);
      return structuredClone(result);
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }

  async #load() {
    try {
      const data = JSON.parse(await readFile(this.filePath, "utf8"));
      return { ...structuredClone(EMPTY_DATABASE), ...data };
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(EMPTY_DATABASE);
      throw error;
    }
  }

  async #save(data) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
