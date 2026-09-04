import { ArrowLeft, ArrowRight, Check, Equal, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../api/resources.js";
import { logEvent } from "../lib/logEvent.js";
import { useApp } from "../state/AppProvider.jsx";

const COMPARISON_METRICS = [
  { key: "paceDistance", label: "Distance from target pace", unit: "WPM" },
  { key: "fillerRate", label: "Filler-word rate", unit: "per min" },
  { key: "longPauseRate", label: "Long-pause rate", unit: "per min" },
  { key: "repeatedPhraseRate", label: "Repeated-phrase rate", unit: "per min" },
];

/** 比较页完全依赖服务端比较结果，并显式展示“不适合比较”而不是编造改善结论。 */
export function ComparePage({ afterAnalysisId, beforeAnalysisId, navigate }) {
  const { bootError, booting } = useApp();
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await resources.compare(beforeAnalysisId, afterAnalysisId);
      setComparison(result);
      logEvent("comparison.loaded", { beforeAnalysisId, afterAnalysisId, status: result.status });
    } catch (requestError) {
      setError(requestError.message || "The takes could not be compared.");
      logEvent("comparison.load_failed", { beforeAnalysisId, afterAnalysisId, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setLoading(false);
    }
  }, [afterAnalysisId, beforeAnalysisId]);

  useEffect(() => {
    // 深链接比较也必须等待当前身份恢复，避免比较接口因 Cookie 竞态返回 401。
    if (!booting && !bootError) load();
  }, [bootError, booting, load]);

  if (booting) return <section className="centered-page" aria-live="polite"><h1>Preparing your secure session</h1><p className="page-lede">Restoring access to both completed takes.</p></section>;
  if (bootError) return <section className="centered-page"><h1>The comparison service is unavailable</h1><p className="page-lede">Restore the service connection, then return to this comparison.</p></section>;
  if (loading) return <section className="centered-page" aria-live="polite"><h1>Comparing your completed takes</h1><p className="page-lede">Checking normalized speech measures from both reports.</p></section>;
  if (error) return <section className="centered-page"><h1>We couldn’t compare these takes</h1><p className="form-error" role="alert">{error}</p><div className="processing-actions"><button className="button button-primary" onClick={load}>Try again</button><button className="button button-secondary" onClick={() => navigate(`/analysis/${encodeURIComponent(afterAnalysisId)}/report`)}>Back to report</button></div></section>;
  if (comparison.status === "not_comparable") return <NotComparable comparison={comparison} afterAnalysisId={afterAnalysisId} navigate={navigate} />;

  const improved = comparison.status === "improved";
  const metrics = COMPARISON_METRICS.map((definition) => ({ ...definition, value: comparison.metrics?.[definition.key] })).filter((metric) => metric.value);

  return (
    <div className="compare-page page-container">
      <button className="back-button" onClick={() => navigate(`/analysis/${encodeURIComponent(afterAnalysisId)}/report`)}><ArrowLeft size={17} />Back to report</button>
      <header className="page-heading compare-heading">
        <div>
          <p className="eyebrow">Completed take comparison</p>
          <h1>{improved ? "Your second take shows measured improvement" : "Your completed takes show mixed or small changes"}</h1>
          <p className="page-lede">{comparison.summary}</p>
        </div>
        <span className="comparison-verdict"><Sparkles size={19} />{improved ? "Measured improvement" : "Review the evidence"}</span>
      </header>

      <section className="compare-table" aria-label="Measured comparison">
        <div className="compare-row compare-header"><span>Metric</span><span>First take</span><span>Second take</span><span>Change</span></div>
        {metrics.map((metric) => <div className="compare-row" key={metric.key}><strong>{metric.label}</strong><span>{formatValue(metric.value.before, metric.unit)}</span><span className="after-value">{formatValue(metric.value.after, metric.unit)}</span><span className={`delta is-${metric.value.outcome}`}><Check size={15} aria-hidden="true" />{outcomeLabel(metric.value.outcome, metric.value.delta, metric.unit)}</span></div>)}
      </section>

      <FeedbackChanges changes={comparison.feedbackChanges} />
      <section className="next-take-band">
        <div><p className="eyebrow">Next session</p><h2>Use the measured changes to focus your next recording.</h2></div>
        <button className="button button-dark" onClick={() => navigate("/")}>Start a new take <ArrowRight size={17} /></button>
      </section>
    </div>
  );
}

function NotComparable({ comparison, afterAnalysisId, navigate }) {
  return (
    <section className="centered-page">
      <Equal size={34} aria-hidden="true" />
      <p className="eyebrow">Comparison unavailable</p>
      <h1>These takes are not comparable yet</h1>
      <p className="page-lede">{comparison.summary} {reasonLabel(comparison.reason)}</p>
      <div className="processing-actions"><button className="button button-primary" onClick={() => navigate("/")}>Record a comparable take</button><button className="button button-secondary" onClick={() => navigate(`/analysis/${encodeURIComponent(afterAnalysisId)}/report`)}>Back to report</button></div>
    </section>
  );
}

function FeedbackChanges({ changes }) {
  const rows = [
    { key: "resolved", label: "Resolved feedback", icon: Check, tone: "positive" },
    { key: "persisting", label: "Still present", icon: Equal, tone: "neutral" },
    { key: "introduced", label: "New feedback", icon: Sparkles, tone: "neutral" },
  ].filter((row) => changes?.[row.key]?.length);
  if (!rows.length) return <p className="empty-copy">No feedback changes were identified between these reports.</p>;
  return <section className="compare-notes" aria-label="Feedback changes">{rows.map(({ icon: Icon, key, label, tone }) => <article key={key}><span className={`note-icon ${tone}`}><Icon size={19} /></span><div><p className="eyebrow">{label}</p><h2>{changes[key][0]}</h2>{changes[key].length > 1 && <p>{changes[key].slice(1).join(" ")}</p>}</div></article>)}</section>;
}

function formatValue(value, unit) {
  return `${Number(value).toFixed(2)} ${unit}`;
}

function outcomeLabel(outcome, delta, unit) {
  if (outcome === "improved") return `Improved by ${Math.abs(delta)} ${unit}`;
  if (outcome === "regressed") return `Changed by ${Math.abs(delta)} ${unit}`;
  return "No meaningful change";
}

function reasonLabel(reason) {
  if (reason === "TOO_FEW_WORDS") return "Each take needs more spoken words for a fair comparison.";
  if (reason === "DURATION_MISMATCH") return "The takes differ too much in duration.";
  if (reason === "CONTENT_LENGTH_MISMATCH") return "The takes differ too much in content length.";
  return "Try two takes with similar content and length.";
}
