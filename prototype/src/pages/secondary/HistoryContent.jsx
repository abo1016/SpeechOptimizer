import { AlertCircle, Check, ChevronRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../../api/resources.js";
import { logEvent } from "../../lib/logEvent.js";
import { historyRow } from "../../lib/viewModels.js";
import { useApp } from "../../state/AppProvider.jsx";

/** 历史页始终从当前身份的 API 列表读取，并要求显式确认后才删除分析。 */
export function HistoryContent({ navigate }) {
  const { bootError, booting } = useApp();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await resources.history({ limit: 100 });
      setItems(result.items.map(historyRow));
      logEvent("history.loaded", { count: result.items.length });
    } catch (requestError) {
      setError(requestError.message || "History could not be loaded.");
      logEvent("history.load_failed", { code: requestError.code ?? "UNKNOWN" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 匿名 Cookie 就绪后再请求，保证冷启动时的空历史不是认证竞态造成的错误。
    if (!booting && !bootError) load();
  }, [bootError, booting, load]);

  const remove = async (id) => {
    setDeletingId(id);
    setError("");
    try {
      await resources.deleteAnalysis(id);
      setConfirmId("");
      logEvent("history.analysis_deleted", { analysisId: id });
      await load();
    } catch (requestError) {
      setError(requestError.message || "The analysis could not be deleted.");
      logEvent("history.delete_failed", { analysisId: id, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setDeletingId("");
    }
  };

  if (booting) return <p className="empty-copy" aria-live="polite">Preparing your secure session…</p>;
  if (bootError) return <p className="empty-copy">History will load after the service connection is restored.</p>;
  if (loading) return <p className="empty-copy" aria-live="polite">Loading history…</p>;
  if (error && !items.length) return <div role="alert"><p className="form-error">{error}</p><button className="text-button" onClick={load}>Try again</button></div>;
  if (!items.length) return <div className="empty-state"><AlertCircle size={22} aria-hidden="true" /><h2>No analyses yet</h2><p>Completed, processing, failed, and cancelled tasks will appear here.</p><button className="button button-primary" onClick={() => navigate("/")}>Record your first take</button></div>;

  return <><div className="history-table"><div className="history-row history-header"><span>Session</span><span>Status</span><span>Duration</span><span>Result</span><span /></div>{items.map((item) => <div className="history-row" key={item.id}><span><strong>{item.title}</strong><small>{item.date}</small></span><span className={`status-chip is-${item.status}`}>{item.status === "completed" && <Check size={14} />}{item.statusLabel}</span><span>{item.duration}</span><span>{item.status === "completed" ? "Ready" : "--"}</span><span className="row-actions">{confirmId === item.id ? <span className="inline-confirm" role="group" aria-label={`Confirm deletion of ${item.title}`}><button className="text-button danger-text" disabled={deletingId === item.id} onClick={() => remove(item.id)}>{deletingId === item.id ? "Deleting" : "Confirm"}</button><button className="text-button" disabled={Boolean(deletingId)} onClick={() => setConfirmId("")}>Keep</button></span> : <button className="icon-button" aria-label={`Delete ${item.title}`} onClick={() => setConfirmId(item.id)}><Trash2 size={17} /></button>}<button className="icon-button" aria-label={`Open ${item.title}`} onClick={() => openItem(item, navigate)}><ChevronRight size={18} /></button></span></div>)}</div>{error && <p className="form-error" role="alert">{error}</p>}</>;
}

function openItem(item, navigate) {
  const suffix = item.status === "completed" ? "report" : "processing";
  navigate(`/analysis/${encodeURIComponent(item.id)}/${suffix}`);
}
