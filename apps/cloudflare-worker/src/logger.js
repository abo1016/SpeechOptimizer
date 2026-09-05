const SENSITIVE_FIELD = /(authorization|cookie|token|secret|api[._-]?key|password|body|response|email|audio|object|path|url)/i;
const MAX_DETAIL_KEYS = 12;

/**
 * 输出结构化日志，并在最终写入前移除凭证、请求/响应正文和对象标识。
 * 调用方仍应只传运维所需的安全字段；这里是防止后续误传的最后一道保护。
 * @param {"info" | "warn" | "error"} level
 * @param {string} event
 * @param {Record<string, unknown>} details
 */
export function logEvent(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeDetails(details),
  };

  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
    return;
  }
  if (level === "warn") {
    console.warn(output);
    return;
  }
  console.log(output);
}

/** 仅保留短的标量上下文，避免 Error、Provider body 或嵌套对象意外进入 Workers Logs。 */
function safeDetails(details) {
  return Object.fromEntries(Object.entries(details).slice(0, MAX_DETAIL_KEYS).map(([key, value]) => {
    if (SENSITIVE_FIELD.test(key)) return [key, "[REDACTED]"];
    if (typeof value === "string") return [key, value.slice(0, 160)];
    if (typeof value === "number" || typeof value === "boolean" || value === null) return [key, value];
    return [key, "[OMITTED]"];
  }));
}
