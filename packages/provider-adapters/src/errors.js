/**
 * Provider 统一错误。业务层只依赖稳定 code 与 retryable，不依赖供应商原始响应。
 */
export class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.details = options.details;
  }
}

export function assertConfig(value, code, message) {
  if (!value) throw new ProviderError(code, message);
  return value;
}
