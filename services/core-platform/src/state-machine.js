import { fail } from "./errors.js";

export const ANALYSIS_STATUSES = Object.freeze([
  "created", "uploaded", "transcribing", "analyzing", "completed", "failed", "cancelled",
]);

const TRANSITIONS = Object.freeze({
  created: new Set(["uploaded", "cancelled"]),
  uploaded: new Set(["transcribing", "failed", "cancelled"]),
  transcribing: new Set(["analyzing", "failed", "cancelled"]),
  analyzing: new Set(["completed", "failed", "cancelled"]),
  failed: new Set(["uploaded", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
});

/** 状态迁移必须经过此门禁，禁止调用方直接写入任意状态。 */
export function assertTransition(currentStatus, targetStatus) {
  if (!TRANSITIONS[currentStatus]?.has(targetStatus)) {
    fail(`${currentStatus} 不能迁移到 ${targetStatus}`, "INVALID_STATE_TRANSITION", 409, {
      currentStatus,
      targetStatus,
    });
  }
}

export function isTerminal(status) {
  return status === "completed" || status === "cancelled";
}
