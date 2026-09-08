import { ArrowRight, CheckCircle2, Mic, Quote, RotateCcw, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../api/resources.js";
import { logEvent } from "../lib/logEvent.js";
import { formatDuration, historyRow, reportFeedback, reportMetrics } from "../lib/viewModels.js";
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

function reportValues(report) {
  return report?.report?.metrics ?? report?.metrics ?? {};
}

function reportTranscript(report) {
  return report?.report?.transcript ?? report?.transcript ?? null;
}

function measuredSignals(metrics) {
  const pace = Number.isFinite(metrics.wordsPerMinute) ? metrics.wordsPerMinute : "--";
  const fillerTotal = Number.isFinite(metrics.fillers?.total) ? metrics.fillers.total : "--";
  const pauseTotal = Array.isArray(metrics.longPauses) ? metrics.longPauses.length : "--";
  return [
    { label: "Pace", value: pace === "--" ? pace : `${pace} WPM`, detail: pace === "--" ? "No pace reading" : pace >= 120 && pace <= 170 ? "Within target" : "Measured pace" },
    { label: "Fillers", value: fillerTotal, detail: Number.isFinite(metrics.fillers?.perMinute) ? `${metrics.fillers.perMinute} per min` : "No rate reading" },
    { label: "Long pauses", value: pauseTotal, detail: pauseTotal === "--" ? "No pause reading" : "over 3 seconds" },
  ];
}

function evidenceEvents(metrics) {
  const fillers = Array.isArray(metrics.fillers?.occurrences) ? metrics.fillers.occurrences.map((entry) => ({
    atSeconds: entry.atSeconds,
    label: `Filler “${entry.phrase}”`,
    detail: "Detected filler word",
  })) : [];
  const pauses = Array.isArray(metrics.longPauses) ? metrics.longPauses.map((entry) => ({
    atSeconds: entry.startSeconds,
    label: `${entry.durationSeconds}s pause`,
    detail: "Pause longer than 3 seconds",
  })) : [];
  return [...fillers, ...pauses].sort((left, right) => (left.atSeconds ?? 0) - (right.atSeconds ?? 0));
}

function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
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
  const rawMetrics = reportValues(report);
  const transcript = reportTranscript(report);
  const signals = measuredSignals(rawMetrics);
  const events = evidenceEvents(rawMetrics);
  const timingEvidenceAvailable = Boolean(rawMetrics.fillers) && Array.isArray(rawMetrics.longPauses);
  const takeaway = feedback.length
    ? `${feedback.length} measured ${feedback.length === 1 ? "priority" : "priorities"} to work on.`
    : "No corrective delivery priority was triggered.";
  const takeawayDetail = feedback.length
    ? "Start with the first item below, then record the same message again so the change is easier to compare."
    : "The current checks did not flag pace, filler use, or long pauses for correction. Review the measurements below and repeat the take to test consistency.";
  const nextTakeCue = feedback[0]?.rerecordPrompt ?? "Repeat the same message once and try to keep the measured delivery stable.";
  const transcriptDuration = Number.isFinite(rawMetrics.totalDurationSeconds) ? formatDuration(rawMetrics.totalDurationSeconds * 1000) : "--";

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

      <section className="report-overview" aria-labelledby="takeaway-title">
        <article className="take-summary-card">
          <p className="eyebrow">Measured takeaway</p>
          <h2 id="takeaway-title">{takeaway}</h2>
          <p>{takeawayDetail}</p>
          <div className="summary-signals">
            {signals.map((signal) => <div className="summary-signal" key={signal.label}><span>{signal.label}</span><strong>{signal.value}</strong><small>{signal.detail}</small></div>)}
          </div>
        </article>
        <aside className="practice-brief">
          <Target size={24} aria-hidden="true" />
          <p className="eyebrow">Next take</p>
          <h2>One focused practice cue</h2>
          <p>{nextTakeCue}</p>
          <small>For a cleaner comparison, keep the message itself as similar as you can.</small>
        </aside>
      </section>

      <section className="priority-section" aria-labelledby="priority-title">
        <div className="section-heading compact"><div><p className="eyebrow">Start here</p><h2 id="priority-title">Your priorities</h2></div><span className="complete-label"><CheckCircle2 size={17} />Measured feedback</span></div>
        {feedback.length > 0 ? <div className="priority-grid">{feedback.map((item, index) => <PriorityCard item={item} index={index} key={`${item.issue}-${index}`} />)}</div> : <div className="priority-empty-card"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>No correction crossed the current feedback thresholds.</strong><p>That result is still useful: the analyzer did not find a pace, filler, or long-pause issue that needs a corrective cue in this take.</p></div></div>}
      </section>

      <section className="metric-section" aria-labelledby="metrics-title">
        <div className="section-heading compact"><div><p className="eyebrow">Supporting detail</p><h2 id="metrics-title">Delivery metrics</h2></div></div>
        {metrics.length > 0 ? <div className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.unit}</small><em>{metric.state}</em></article>)}</div> : <p className="empty-copy">Measured metrics are unavailable for this report.</p>}
      </section>

      <section className="report-evidence-section" aria-labelledby="evidence-title">
        <div className="section-heading compact"><div><p className="eyebrow">Inspect the evidence</p><h2 id="evidence-title">Transcript & timing</h2></div><span className="evidence-meta">{rawMetrics.wordCount ?? "--"} words · {transcriptDuration}</span></div>
        <div className="report-evidence-grid">
          <article className="transcript-panel">
            <div className="panel-title-row"><span><Quote size={19} aria-hidden="true" />Transcript</span><small>What the analyzer heard</small></div>
            {transcript?.text ? <blockquote>{transcript.text}</blockquote> : <p className="empty-copy">Transcript text is unavailable for this report.</p>}
          </article>
          <article className="timing-panel">
            <div className="panel-title-row"><span>Timestamp evidence</span><small>Fillers and pauses</small></div>
            {events.length > 0 ? <div className="evidence-events">{events.slice(0, 8).map((event, index) => <div className="evidence-event" key={`${event.label}-${event.atSeconds}-${index}`}><time>{formatTimestamp(event.atSeconds)}</time><div><strong>{event.label}</strong><small>{event.detail}</small></div></div>)}</div> : timingEvidenceAvailable ? <div className="evidence-empty"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>No timestamped issues to review.</strong><p>No filler occurrences or pauses over 3 seconds were detected in this take.</p></div></div> : <p className="empty-copy">Timestamp evidence is unavailable for this report.</p>}
          </article>
        </div>
      </section>

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
