import { API_PREFIX, api } from "./client.js";

const path = (suffix) => `${API_PREFIX}${suffix}`;

/** 所有 REST 路径集中维护，页面只表达用户动作。 */
export function createResources(options = {}) {
  const client = options.client ?? api;
  const fetchImpl = options.fetchImpl ?? fetch;
  const hashBlob = options.sha256Hex ?? sha256Hex;

  return {
    health: () => client.get("/health"),
    ensureAnonymous: () => client.post(path("/anonymous/session")),
    session: () => client.get(path("/session")),
    logout: () => client.post(path("/auth/logout")),
    requestMagicLink: (email, redirectUri, turnstileToken) => client.post(path("/auth/magic-link"), { email, redirectUri, turnstileToken }),
    consumeMagicLink: (token) => client.post(path("/auth/magic-link/consume"), { token }),
    // Turnstile token 不能进入 URL，避免代理、浏览器历史和 Referer 意外记录一次性验证凭证。
    startGoogle: (redirectUri, turnstileToken) => client.post(path("/auth/google/start"), { redirectUri, turnstileToken }),
    completeGoogle: (state, code) => client.post(path("/auth/google/complete"), { state, code }),
    createAnalysis: (retainAudio, turnstileToken, key = crypto.randomUUID()) => client.post(path("/analyses"), { retainAudio, turnstileToken }, {
      headers: { "idempotency-key": key },
    }),
    uploadAudio: async (id, audio) => {
      // Storage bucket 只允许标准 MIME；录音 Blob 即使携带 codecs 参数也统一作为 audio/webm 上传。
      const mime = "audio/webm";
      const sha256 = await hashBlob(audio);
      // Worker 只签发当前任务单一对象的上传授权，浏览器随后直接把音频发送到私有对象存储。
      const ticket = await client.post(path(`/analyses/${id}/audio-upload`), { size: audio.size, mime, sha256 });
      const response = await fetchImpl(ticket.uploadUrl, {
        method: "PUT",
        body: audio,
        headers: { ...ticket.headers, "content-type": mime },
      });
      if (!response.ok) throw new Error(`Direct audio upload failed with status ${response.status}.`);
      if (ticket.directComplete) {
        const payload = await response.json();
        return payload.data;
      }
      return client.post(path(`/analyses/${id}/audio-complete`), {
        objectKey: ticket.objectKey,
        size: audio.size,
        mime,
        sha256,
      });
    },
    analysis: (id, signal) => client.get(path(`/analyses/${id}`), { signal }),
    cancelAnalysis: (id) => client.post(path(`/analyses/${id}/cancel`)),
    retryAnalysis: (id) => client.post(path(`/analyses/${id}/retry`)),
    deleteAnalysis: (id) => client.delete(path(`/analyses/${id}`)),
    history: (query = {}) => client.get(`${path("/analyses")}?${new URLSearchParams(cleanQuery(query))}`),
    report: (id) => client.get(path(`/analyses/${id}/report`)),
    compare: (beforeAnalysisId, afterAnalysisId) => client.post(path("/comparisons"), { beforeAnalysisId, afterAnalysisId }),
    privacy: () => client.get(path("/privacy")),
    updatePrivacy: (retainAudio) => client.put(path("/privacy"), { retainAudio }),
    deleteAccount: () => client.delete(path("/account")),
    plans: () => client.get(path("/plans")),
    balance: () => client.get(path("/billing/balance")),
    ledger: () => client.get(path("/billing/ledger")),
    orders: () => client.get(path("/billing/orders")),
    subscriptions: () => client.get(path("/billing/subscriptions")),
    createOrder: (productCode) => client.post(path("/billing/orders"), { productCode }),
    cancelSubscription: (id) => client.post(path(`/billing/subscriptions/${id}/cancel`)),
    refundOrder: (id, reason) => client.post(path(`/billing/orders/${id}/refund`), { reason }),
    // 免费 Beta 管理面只读取 D1 已持久化的失败任务；不会暴露 Queue/DLQ 消息正文。
    adminFailedAnalyses: (query = {}) => client.get(`${path("/admin/analyses")}?${new URLSearchParams({ status: "failed", ...cleanQuery(query) })}`),
    adminRetry: (id) => client.post(path(`/admin/analyses/${id}/retry`)),
  };
}

export const resources = createResources();

/** 浏览器端只计算完整性摘要，不把音频或摘要暴露给日志。 */
async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanQuery(query) {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
