import { Database, FileAudio, Trash2 } from "lucide-react";
import { useState } from "react";
import { resources } from "../../api/resources.js";
import { logEvent } from "../../lib/logEvent.js";
import { useApp } from "../../state/AppProvider.jsx";

/** 隐私设置以账户身份为边界；匿名会话不可保留音频，也不能删除不存在的账户。 */
export function PrivacyContent({ navigate }) {
  const { refreshSession, retainAudio, session, setCurrentAnalysis, setReport, updatePrivacy } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const signedIn = Boolean(session?.user);

  const toggle = async () => {
    setPending("retention");
    setError("");
    setNotice("");
    try {
      await updatePrivacy(!retainAudio);
      setNotice("Retention preference saved.");
      logEvent("privacy.retention_changed", { retainAudio: !retainAudio });
    } catch (requestError) {
      setError(requestError.message || "The retention preference could not be saved.");
      logEvent("privacy.retention_failed", { code: requestError.code ?? "UNKNOWN" });
    } finally {
      setPending("");
    }
  };

  const deleteAccount = async () => {
    setPending("delete-account");
    setError("");
    try {
      // 删除成功后刷新为匿名会话，避免继续用已撤销 Cookie 发出任何账户请求。
      const result = await resources.deleteAccount();
      setCurrentAnalysis(null);
      setReport(null);
      await refreshSession();
      setConfirmDelete(false);
      setNotice(`Account data deleted, including ${result.analysesDeleted ?? 0} analyses.`);
      logEvent("privacy.account_deleted", { analysesDeleted: result.analysesDeleted ?? 0 });
    } catch (requestError) {
      setError(requestError.message || "The account could not be deleted.");
      logEvent("privacy.account_delete_failed", { code: requestError.code ?? "UNKNOWN" });
    } finally {
      setPending("");
    }
  };

  return <div className="settings-main privacy-settings"><div className="setting-row"><span className="setting-icon"><FileAudio size={20} /></span><div><strong>Save original audio</strong><p>{signedIn ? "Account reports remain available whether or not original audio is retained." : "Anonymous audio is always deleted. Sign in to choose an account retention preference."}</p></div><button className={`toggle ${retainAudio ? "is-on" : ""}`} aria-label="Save original audio" aria-pressed={retainAudio} disabled={!signedIn || Boolean(pending)} onClick={toggle}><span /></button></div><div className="setting-row"><span className="setting-icon"><Database size={20} /></span><div><strong>Delete a single analysis</strong><p>History provides a confirmation before removing its report and retained audio.</p></div><button className="button button-secondary" onClick={() => navigate("/history")}>Review history</button></div><div className="setting-row danger-row"><span className="setting-icon"><Trash2 size={20} /></span><div><strong>Delete account</strong><p>Deletes all owned analyses and disables this account.</p></div>{confirmDelete ? <span className="inline-confirm" role="group" aria-label="Confirm account deletion"><button className="button button-danger" disabled={Boolean(pending)} onClick={deleteAccount}>{pending === "delete-account" ? "Deleting account" : "Confirm deletion"}</button><button className="text-button" disabled={Boolean(pending)} onClick={() => setConfirmDelete(false)}>Keep account</button></span> : <button className="button button-danger" disabled={!signedIn || Boolean(pending)} onClick={() => setConfirmDelete(true)}>Delete account</button>}</div>{notice && <p className="dialog-message" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
