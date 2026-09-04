import { ArrowRight, CheckCircle2, Mic, Quote, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../api/resources.js";
import { logEvent } from "../lib/logEvent.js";
import { historyRow, reportFeedback, reportMetrics } from "../lib/viewModels.js";
import { useApp } from "../state/AppProvider.jsx";

function PriorityCard({ item, index }) {
  const tone = item.priority === "high" ? "blue" : item.priority === "medium" ? "amber" : "green";
  return (
    <article className={`priority-card tone-${tone}`}>
      <span className="priority-rank">{String(index + 1).padStart(2, "0")}</span>
      <div className="priority-content">
        <h3>{item.issue}</h3>
        <p>{item.evidence}</p>
        <dl>
          <div><dt>Change</dt><dd>{item.revision}</dd></div>
          <div><dt>Next-take cue</dt><dd>{item.rerecordPrompt}</dd></div>
        </dl>
      </div>
    </article>
  );
}

/** 报告页只渲染服务端生成的 metrics 和 feedback，不从静态演示数据补全内容。 */
export function ResultPage({ analysisId, navigate }) {
  const { bootError, booting, setReport } = useApp();
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [report, setLocalReport] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextReport, history] = await Promise.all([
        resources.report(analysisId),
        resources.history({ status: "completed", limit: 100 }),
      ]);
      setLocalReport(nextReport);
      setReport(nextReport);
      setComparison(findComparison(history.items, analysisId));
      logEvent("report.loaded", { analysisId, comparisonAvailable: Boolean(findComparison(history.items, analysisId)) });
    } catch (requestError) {
      setError(requestError.message || "The report could not be loaded.");
      logEvent("report.load_failed", { analysisId, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setLoading(false);
    }
  }, [analysisId, setReport]);

  useEffect(() => {
    // 深链接进入报告页时，先恢复 Cookie 对应身份再读取受保护的报告。
    if (!booting && !bootError) load();
  }, [bootError, booting, load]);

  if (booting) return <section className="centered-page" aria-live="polite"><h1>Preparing your secure session</h1><p className="page-lede">Restoring access to this analysis.</p></section>;
  if (bootError) return <section className="centered-page"><h1>The report service is unavailable</h1><p className="page-lede">Restore the service connection, then return to this report.</p></section>;
  if (loading) return <section className="centered-page" aria-live="polite"><h1>Loading your report</h1><p className="page-lede">Retrieving the measured feedback for this analysis.</p></section>;
  if (error) return <section className="centered-page"><h1>We couldn’t load this report</h1><p className="form-error" role="alert">{error}</p><div className="processing-actions"><button className="button button-primary" onClick={load}>Try again</button><button className="button button-secondary" onClick={() => navigate(`/analysis/${encodeURIComponent(analysisId)}/processing`)}>View analysis status</button></div></section>;

  const feedback = reportFeedback(report);
  const metrics = reportMetrics(report);
  const firstEvidence = feedback[0];

  return (
    <div className="report-page page-container">
      <header className="page-heading report-heading">
        <div>
          <p className="eyebrow">Report ready</p>
          <h1>Your evidence-based practice report</h1>
          <p className="page-lede">Start with the measured changes below, then make a focused next take.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-primary" onClick={() => navigate("/")}><Mic size={18} />Record another take</button>
        </div>
      </header>

      <section className="priority-section" aria-labelledby="priority-title">
        <div className="section-heading compact"><div><p className="eyebrow">Start here</p><h2 id="priority-title">Your priorities</h2></div><span className="complete-label"><CheckCircle2 size={17} />Measured feedback</span></div>
        {feedback.length > 0 ? <div className="priority-grid">{feedback.map((item, index) => <PriorityCard item={item} index={index} key={`${item.issue}-${index}`} />)}</div> : <p className="empty-copy">This analysis did not produce additional practice priorities.</p>}
      </section>

      <section className="metric-section" aria-labelledby="metrics-title">
        <div className="section-heading compact"><div><p className="eyebrow">Supporting detail</p><h2 id="metrics-title">Delivery metrics</h2></div></div>
        {metrics.length > 0 ? <div className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.unit}</small><em>{metric.state}</em></article>)}</div> : <p className="empty-copy">Measured metrics are unavailable for this report.</p>}
      </section>

      {firstEvidence && <section className="evidence-strip" aria-label="First evidence item"><Quote size={23} aria-hidden="true" /><div><strong>Evidence from this take</strong><p>{firstEvidence.evidence}</p></div><span>{firstEvidence.priority} priority</span></section>}

      <section className="next-take-band">
        <div><p className="eyebrow">Close the loop</p><h2>Make one better take while the feedback is fresh.</h2></div>
        <div>
          <button className="button button-secondary" onClick={() => navigate("/")}><RotateCcw size={17} />Re-record</button>
          <button className="button button-dark" disabled={!comparison} onClick={() => comparison && navigate(`/compare/${encodeURIComponent(comparison.before.id)}/${encodeURIComponent(comparison.after.id)}`)}>Compare completed takes <ArrowRight size={17} /></button>
        </div>
      </section>
      {!comparison && <p className="empty-copy">Complete another take to compare measured changes.</p>}
    </div>
  );
}

function findComparison(items, analysisId) {
  const current = items.find((item) => item.id === analysisId);
  const candidate = items.find((item) => item.id !== analysisId);
  if (!current || !candidate) return null;
  const currentTime = Date.parse(current.createdAt);
  const candidateTime = Date.parse(candidate.createdAt);
  const before = candidateTime <= currentTime ? candidate : current;
  const after = before === current ? candidate : current;
  return { before: historyRow(before), after: historyRow(after) };
}
