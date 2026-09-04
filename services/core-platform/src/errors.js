/** 核心服务统一业务错误，HTTP 适配层只映射 code，不泄露内部异常。 */
export class CoreError extends Error {
  constructor(message, { code = "CORE_ERROR", status = 500, details, cause } = {}) {
    super(message, { cause });
    this.name = "CoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function fail(message, code, status = 400, details) {
  throw new CoreError(message, { code, status, details });
}

export function requireValue(condition, message, code = "INVALID_INPUT") {
  if (!condition) fail(message, code, 400);
}
