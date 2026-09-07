const WORKFLOW_ERROR_PREFIX = "SO_WORKFLOW_ERROR";
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Cloudflare Workflow step 只保证 Error 的标准字段跨重试/持久化边界稳定存在。
 * 因此把允许持久化的稳定字段编码进 message；绝不包含 Provider body、URL、对象 key 或凭证。
 */
export function encodeWorkflowError(error) {
  const code = SAFE_ERROR_CODE.test(String(error?.code ?? "")) ? String(error.code) : "PROCESSING_FAILED";
  const retryable = error?.retryable !== false;
  const providerStatus = safeProviderStatus(error?.providerStatus);
  return `${WORKFLOW_ERROR_PREFIX}:${code}:${retryable ? 1 : 0}:${providerStatus ?? 0}`;
}

/** 从 Workflow 重新构造的普通 Error 中恢复安全的稳定失败语义。 */
export function decodeWorkflowError(error) {
  const message = String(error?.message ?? "");
  const match = message.match(/(?:^|:\s*)SO_WORKFLOW_ERROR:([A-Z][A-Z0-9_]{0,63}):(0|1):(0|[1-5][0-9]{2})$/);
  if (!match) return null;
  const providerStatus = Number(match[3]);
  return {
    code: match[1],
    retryable: match[2] === "1",
    providerStatus: providerStatus === 0 ? null : providerStatus,
  };
}

function safeProviderStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}
