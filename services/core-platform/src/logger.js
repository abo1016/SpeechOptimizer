const ALLOWED_FIELDS = new Set([
  "analysisId", "accountId", "action", "attempt", "eventId", "objectKey",
  "ownerType", "status", "targetStatus",
]);

/**
 * 结构化安全日志器：只输出白名单元数据，主动丢弃音频、转写、密钥和任意内容字段。
 */
export function createSafeLogger(sink = console) {
  function write(level, event, fields = {}) {
    const safeFields = Object.fromEntries(
      Object.entries(fields).filter(([key]) => ALLOWED_FIELDS.has(key)),
    );
    sink[level]?.(JSON.stringify({ event, ...safeFields }));
  }
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}
