export class SpeechEngineError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SpeechEngineError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
