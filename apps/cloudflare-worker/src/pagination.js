import { WorkerError, invariant } from "./errors.js";

/** 复合游标绑定 created_at 和 id，保证同一时间戳下的排序与翻页条件完全一致。 */
export function encodeAnalysisCursor(analysis) {
  return btoa(JSON.stringify({ createdAt: analysis.createdAt, id: analysis.id }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 无效游标统一返回公开 400，避免把底层 Base64/JSON 错误泄露给调用方。 */
export function decodeAnalysisCursor(value) {
  try {
    const raw = String(value);
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    invariant(typeof parsed.createdAt === "string" && typeof parsed.id === "string", "INVALID_CURSOR", "分页游标无效", 400);
    return parsed;
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    throw new WorkerError("INVALID_CURSOR", "分页游标无效", 400);
  }
}
