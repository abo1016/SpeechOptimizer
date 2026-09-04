/** 领域错误携带稳定错误码，HTTP 或 RPC 适配层可以据此转换响应。 */
export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new DomainError(code, message, details);
}
