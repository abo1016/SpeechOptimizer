export class HttpError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function requireInput(condition, code, message, status = 400) {
  if (!condition) throw new HttpError(code, message, status);
}
