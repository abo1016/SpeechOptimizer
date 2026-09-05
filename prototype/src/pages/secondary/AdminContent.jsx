import { AlertCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../../api/resources.js";
import { logEvent } from "../../lib/logEvent.js";
import { useApp } from "../../state/AppProvider.jsx";

/** 管理页只展示 D1 已持久化的失败任务；DLQ 正文不进入浏览器或页面状态。 */
export function AdminContent() {
  const { bootError, booting, session } = useApp();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await resources.adminFailedAnalyses({ limit: 50 });
      setItems(result.items ?? []);
      logEvent("admin.failed_analyses_loaded", { count: result.items?.length ?? 0 });
    } catch (requestError) {
      setError(`${requestError.code ?? "ERROR"}: ${requestError.message}`);
      logEvent("admin.failed_analyses_load_failed", { code: requestError.code ?? "UNKNOWN" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!booting && !bootError && session?.user?.role === "admin") load();
  }, [bootError, booting, load, session?.user?.role]);

  const retry = async (analysisId) => {
    setRetryingId(analysisId);
    setError("");
    setNotice("");
    try {
      await resources.adminRetry(analysisId);
      setNotice("Retry queued for the failed analysis.");
      logEvent("admin.analysis_retry_requested", { analysisId });
      await load();
    } catch (requestError) {
      setError(`${requestError.code ?? "ERROR"}: ${requestError.message}`);
      logEvent("admin.analysis_retry_failed", { analysisId, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setRetryingId("");
    }
  };

  if (booting) return <p className="empty-copy" aria-live="polite">Preparing your secure session…</p>;
  if (bootError) return <p className="empty-copy">Admin tools will load after the service connection is restored.</p>;
  if (session?.user?.role !== "admin") return <div className="empty-state"><ShieldCheck size={24} aria-hidden="true" /><h2>Admin permission required</h2><p>The server enforces the admin role for every operation. Hiding controls is not an authorization boundary.</p></div>;

  return <section className="admin-queue" aria-busy={loading}>
    <h2>Failed analyses</h2>
    {loading && <p className="empty-copy" aria-live="polite">Loading failed analyses…</p>}
    {!loading && !items.length && <p className="empty-copy">No failed analyses require intervention.</p>}
    {!loading && items.map((item) => <div className="queue-row" key={item.id}>
      <AlertCircle size={18} aria-hidden="true" />
      <span><strong>{item.id}</strong><small>{failureSummary(item)}</small></span>
      <button className="button button-secondary" disabled={Boolean(retryingId) || item.error?.retryable === false}
        onClick={() => retry(item.id)}><RefreshCw size={16} />{retryingId === item.id ? "Retrying" : "Retry"}</button>
    </div>)}
    {notice && <p className="dialog-message" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

/** 页面只展示稳定错误码、阶段、时间和 attempt，不将对象路径或第三方异常详情暴露给管理员浏览器。 */
function failureSummary(item) {
  const stage = item.error?.stage ?? "unknown";
  const time = item.error?.at ? new Date(item.error.at).toLocaleString() : "time unavailable";
  return `${item.error?.code ?? "PROCESSING_FAILED"} · ${stage} · attempt ${item.attempt} · ${time}`;
}
