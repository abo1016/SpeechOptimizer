import { MemoryStore } from "../src/store.js";

export const silentLogger = { info() {}, warn() {}, error() {} };

export function sequenceId(prefix = "test") {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

export function harness(now = 1_000_000) {
  return { store: new MemoryStore(), id: sequenceId(), clock: () => now, logger: silentLogger };
}
