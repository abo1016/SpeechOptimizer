/**
 * 输出结构化日志，字段只接受路由与运行环境等非敏感上下文。
 * 后续认证、Cookie、Token、音频信息不得直接传入 details。
 * @param {"info" | "warn" | "error"} level
 * @param {string} event
 * @param {Record<string, unknown>} details
 */
export function logEvent(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
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
