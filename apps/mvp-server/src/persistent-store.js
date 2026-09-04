import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MemoryStore } from "../../../services/account-billing/src/index.js";

const MAP_FIELDS = ["users", "usersByEmail", "sessions", "magicLinks", "oauthStates", "grants", "holds",
  "orders", "subscriptions", "webhookEvents", "analyses"];
const ARRAY_FIELDS = ["ledger", "audit"];

/** 在本地 MemoryStore 契约之上提供请求级快照，便于开发服务重启后恢复账户与计费状态。 */
export class PersistentStore extends MemoryStore {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const snapshot = JSON.parse(await readFile(this.filePath, "utf8"));
      for (const field of MAP_FIELDS) this[field] = new Map(snapshot[field] ?? []);
      for (const field of ARRAY_FIELDS) this[field] = snapshot[field] ?? [];
      this.anonymousTrials = new Set(snapshot.anonymousTrials ?? []);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this;
  }

  async flush() {
    const operation = this.queue.then(() => this.#write());
    this.queue = operation.catch(() => {});
    return operation;
  }

  async #write() {
    const snapshot = { anonymousTrials: [...this.anonymousTrials] };
    for (const field of MAP_FIELDS) snapshot[field] = [...this[field].entries()];
    for (const field of ARRAY_FIELDS) snapshot[field] = this[field];
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
