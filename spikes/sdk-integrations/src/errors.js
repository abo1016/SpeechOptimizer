/**
 * 外接服务统一错误类型，业务层可据此区分可重试与不可重试失败。
 */
export class ExternalServiceError extends Error {
  constructor(message, { code = "EXTERNAL_SERVICE_ERROR", requestId = null, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = "ExternalServiceError";
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export class UnknownStatusError extends ExternalServiceError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "WAFFO_UNKNOWN_STATUS", retryable: true });
    this.name = "UnknownStatusError";
  }
}

export class DecisionRequiredError extends ExternalServiceError {
  constructor(decision) {
    super(`WAFFO_DECISION_REQUIRED: ${decision}`, { code: "WAFFO_DECISION_REQUIRED" });
    this.name = "DecisionRequiredError";
    this.decision = decision;
  }
}
