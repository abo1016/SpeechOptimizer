/** Worker 业务错误统一携带稳定错误码和 HTTP 状态，避免路由层自行拼装错误语义。 */
export class WorkerError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 条件不满足时抛出可公开的业务错误。 */
export function invariant(condition, code, message, status = 400, details) {
  if (!condition) throw new WorkerError(code, message, status, details);
}
