import { API_PREFIX, api } from "./client.js";

const path = (suffix) => `${API_PREFIX}${suffix}`;

/** 所有 REST 路径集中维护，页面只表达用户动作。 */
export const resources = {
  health: () => api.get("/health"),
  ensureAnonymous: () => api.post(path("/anonymous/session")),
  session: () => api.get(path("/session")),
  logout: () => api.post(path("/auth/logout")),
  requestMagicLink: (email, redirectUri) => api.post(path("/auth/magic-link"), { email, redirectUri }),
  consumeMagicLink: (token) => api.post(path("/auth/magic-link/consume"), { token }),
  startGoogle: (redirectUri) => api.get(`${path("/auth/google/start")}?${new URLSearchParams({ redirectUri })}`),
  completeGoogle: (state, code) => api.post(path("/auth/google/complete"), { state, code }),
  createAnalysis: (retainAudio, key = crypto.randomUUID()) => api.post(path("/analyses"), { retainAudio }, {
    headers: { "idempotency-key": key },
  }),
  uploadAudio: (id, audio) => api.upload(path(`/analyses/${id}/audio`), audio),
  analysis: (id, signal) => api.get(path(`/analyses/${id}`), { signal }),
  cancelAnalysis: (id) => api.post(path(`/analyses/${id}/cancel`)),
  retryAnalysis: (id) => api.post(path(`/analyses/${id}/retry`)),
  deleteAnalysis: (id) => api.delete(path(`/analyses/${id}`)),
  history: (query = {}) => api.get(`${path("/analyses")}?${new URLSearchParams(cleanQuery(query))}`),
  report: (id) => api.get(path(`/analyses/${id}/report`)),
  compare: (beforeAnalysisId, afterAnalysisId) => api.post(path("/comparisons"), { beforeAnalysisId, afterAnalysisId }),
  privacy: () => api.get(path("/privacy")),
  updatePrivacy: (retainAudio) => api.put(path("/privacy"), { retainAudio }),
  deleteAccount: () => api.delete(path("/account")),
  plans: () => api.get(path("/plans")),
  balance: () => api.get(path("/billing/balance")),
  ledger: () => api.get(path("/billing/ledger")),
  orders: () => api.get(path("/billing/orders")),
  subscriptions: () => api.get(path("/billing/subscriptions")),
  createOrder: (productCode) => api.post(path("/billing/orders"), { productCode }),
  cancelSubscription: (id) => api.post(path(`/billing/subscriptions/${id}/cancel`)),
  refundOrder: (id, reason) => api.post(path(`/billing/orders/${id}/refund`), { reason }),
  adminUser: (id) => api.get(path(`/admin/users/${id}`)),
  disableUser: (id, reason) => api.post(path(`/admin/users/${id}/disable`), { reason }),
  returnMinutes: (id, minutes, reason) => api.post(path(`/admin/users/${id}/return-minutes`), { minutes, reason }),
  adminRetry: (id) => api.post(path(`/admin/analyses/${id}/retry`)),
};

function cleanQuery(query) {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
