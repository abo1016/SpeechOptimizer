import { AlertCircle, FileAudio, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { resources } from "../../api/resources.js";
import { logEvent } from "../../lib/logEvent.js";
import { useApp } from "../../state/AppProvider.jsx";

/** 管理页仅在服务端已认证的管理员会话下展示；所有高权限动作仍由 API 再次授权。 */
export function AdminContent() {
  const { bootError, booting, session } = useApp();
  const [userId, setUserId] = useState("");
  const [analysisId, setAnalysisId] = useState("");
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");

  const run = async (action, operation) => {
    setPending(action);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      setNotice("Admin operation completed and audited.");
      logEvent("admin.operation_completed", { action });
      return result;
    } catch (requestError) {
      setError(`${requestError.code ?? "ERROR"}: ${requestError.message}`);
      logEvent("admin.operation_failed", { action, code: requestError.code ?? "UNKNOWN" });
      return null;
    } finally {
      setPending("");
    }
  };

  const inspect = async () => {
    const result = await run("inspect", () => resources.adminUser(userId));
    if (result) setOverview(result);
  };

  if (booting) return <p className="empty-copy" aria-live="polite">Preparing your secure session…</p>;
  if (bootError) return <p className="empty-copy">Admin tools will load after the service connection is restored.</p>;
  if (session?.user?.role !== "admin") return <div className="empty-state"><ShieldCheck size={24} aria-hidden="true" /><h2>Admin permission required</h2><p>The server enforces the admin role for every operation. Hiding controls is not an authorization boundary.</p></div>;

  const items = [["Analyses", overview?.analyses.length ?? 0, FileAudio], ["Subscriptions", overview?.subscriptions.length ?? 0, RefreshCw], ["Ledger entries", overview?.ledger.length ?? 0, AlertCircle], ["Role", overview?.user.role ?? "--", UserRound]];
  return <><div className="admin-controls"><label className="field-label" htmlFor="admin-user-id">Target user ID</label><input id="admin-user-id" className="text-input" value={userId} onChange={(event) => setUserId(event.target.value)} /><button className="button button-primary" disabled={!userId || Boolean(pending)} onClick={inspect}>{pending === "inspect" ? "Loading user" : "Load user"}</button></div><div className="admin-metrics">{items.map(([label, value, Icon]) => <article key={label}><Icon size={20} /><span>{label}</span><strong>{value}</strong></article>)}</div>{overview && <div className="admin-queue"><h2>{overview.user.email}</h2><div className="queue-row"><AlertCircle size={18} /><span><strong>Disable account</strong><small>Revokes sessions and records an audit.</small></span><button className="button button-danger" disabled={Boolean(pending)} onClick={() => run("disable", () => resources.disableUser(userId, "admin_console"))}>Disable</button></div><div className="queue-row"><RefreshCw size={18} /><span><strong>Return 5 minutes</strong><small>Creates a manual entitlement ledger entry.</small></span><button className="button button-secondary" disabled={Boolean(pending)} onClick={() => run("return-minutes", () => resources.returnMinutes(userId, 5, "support_adjustment"))}>Return minutes</button></div><div className="queue-row"><FileAudio size={18} /><span><strong>Retry failed analysis</strong><small>Only a failed task with retained audio is retryable.</small><input className="text-input compact-input" value={analysisId} onChange={(event) => setAnalysisId(event.target.value)} placeholder="analysis ID" /></span><button className="button button-secondary" disabled={!analysisId || Boolean(pending)} onClick={() => run("retry-analysis", () => resources.adminRetry(analysisId))}>Retry</button></div></div>}{notice && <p className="dialog-message" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}</>;
}
