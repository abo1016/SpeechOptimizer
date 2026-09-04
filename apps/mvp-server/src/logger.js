/** 安全日志器仅记录显式字段，禁止输出请求体、音频、token、Cookie 或密钥。 */
export function createLogger(sink = console) {
  return {
    info(event, details = {}) { sink.info?.(format("info", event, details)); },
    warn(event, details = {}) { sink.warn?.(format("warn", event, details)); },
    error(event, details = {}) { sink.error?.(format("error", event, details)); },
  };
}

function format(level, event, details) {
  const safe = Object.fromEntries(Object.entries(details).filter(([key]) => !isSensitive(key)));
  return JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safe });
}

function isSensitive(key) {
  return /audio|bytes|body|cookie|secret|token|transcript|authorization/i.test(key);
}
