import { ArrowRight, FileText, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../api/resources.js";
import { RecorderWorkspace } from "../components/RecorderWorkspace.jsx";
import { feedbackPreview } from "../data/productData.js";
import { logEvent } from "../lib/logEvent.js";
import { historyRow } from "../lib/viewModels.js";
import { useApp } from "../state/AppProvider.jsx";

function FeedbackPanel() {
  return (
    <aside className="feedback-panel" aria-labelledby="feedback-title">
      <p className="eyebrow">Evidence-first feedback</p>
      <h2 id="feedback-title">What your report includes</h2>
      <p className="panel-intro">Feedback is tied to observable moments in your recording.</p>
      <div className="feedback-list">
        {feedbackPreview.map(({ title, description, evidence, icon: Icon, tone }) => (
          <article className={`feedback-item tone-${tone}`} key={title}>
            <span className="feedback-icon" aria-hidden="true"><Icon size={21} /></span>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="evidence"><ArrowRight size={15} aria-hidden="true" />{evidence}</span>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

/** 首页最近任务直接读取当前身份的历史列表，不展示虚构评分或示例报告。 */
function RecentSessions({ navigate }) {
  const { bootError, booting } = useApp();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await resources.history({ limit: 3 });
      setItems(result.items.map(historyRow));
      logEvent("home.history_loaded", { count: result.items.length });
    } catch (requestError) {
      setError(requestError.message);
      logEvent("home.history_failed", { code: requestError.code ?? "UNKNOWN" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 冷启动先完成匿名 Cookie 建立，历史请求才不会把正常首访误报为未认证。
    if (!booting && !bootError) load();
  }, [bootError, booting, load]);

  const waitingForSession = booting || Boolean(bootError);

  return (
    <section className="recent-section" aria-labelledby="recent-title" aria-busy={loading}>
      <div className="section-heading compact">
        <div><p className="eyebrow">Keep improving</p><h2 id="recent-title">Recent sessions</h2></div>
        <button className="text-button" onClick={() => navigate("/history")}>View all <ArrowRight size={17} /></button>
      </div>
      {waitingForSession && <p className="empty-copy" aria-live="polite">Preparing your secure session…</p>}
      {!waitingForSession && loading && <p className="empty-copy" aria-live="polite">Loading recent sessions…</p>}
      {!waitingForSession && !loading && error && <div role="alert"><p className="form-error">{error}</p><button className="text-button" onClick={load}>Try again</button></div>}
      {!waitingForSession && !loading && !error && !items.length && <p className="empty-copy">Your completed and in-progress analyses will appear here.</p>}
      {!waitingForSession && !loading && !error && items.length > 0 && <div className="session-list">
        {items.map((item) => (
          <button className="session-row" key={item.id} onClick={() => openAnalysis(item, navigate)}>
            <PlayCircle size={22} aria-hidden="true" />
            <span className="session-title"><strong>{item.title}</strong><small>{item.date}</small></span>
            <span className="session-duration">{item.duration}</span>
            <span className={`status-chip is-${item.status}`}>{item.statusLabel}</span>
            <span className="session-status">{item.status === "completed" ? "Report ready" : "Open status"}</span>
            <FileText size={18} className="session-open" aria-hidden="true" />
          </button>
        ))}
      </div>}
    </section>
  );
}

function openAnalysis(item, navigate) {
  const suffix = item.status === "completed" ? "report" : "processing";
  navigate(`/analysis/${encodeURIComponent(item.id)}/${suffix}`);
}

export function HomePage({ navigate }) {
  return (
    <div className="home-grid">
      <RecorderWorkspace navigate={navigate} />
      <RecentSessions navigate={navigate} />
      <FeedbackPanel />
    </div>
  );
}
