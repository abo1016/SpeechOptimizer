import { AlertCircle, Check, CircleDashed, Clock3, FileAudio, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resources } from "../api/resources.js";
import { analysisStep, pollAnalysis, TERMINAL_ANALYSIS_STATUSES } from "../lib/analysisFlow.js";
import { logEvent } from "../lib/logEvent.js";
import { useApp } from "../state/AppProvider.jsx";

const steps = [
  { label: "Upload complete", detail: "Your audio is ready for server processing.", icon: FileAudio },
  { label: "Transcribing speech", detail: "Finding words, timing, and pauses.", icon: CircleDashed },
  { label: "Building your feedback", detail: "Prioritizing the next practical actions.", icon: Sparkles },
];

/** 页面轮询服务端任务状态；取消、离页和重试都会中止旧请求，避免并发状态回写。 */
export function ProcessingPage({ analysisId, navigate }) {
  const { bootError, booting, setCurrentAnalysis } = useApp();
  const controllerRef = useRef(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const status = analysis?.status ?? "uploaded";
  const terminal = TERMINAL_ANALYSIS_STATUSES.has(status);

  useEffect(() => {
    // 任务查询依赖匿名或账户 Cookie；冷启动完成前不应抢先请求并制造 401 错误。
    if (booting || bootError) return undefined;
    const controller = new AbortController();
    let active = true;
    controllerRef.current = controller;
    setError("");

    pollAnalysis(analysisId, {
      signal: controller.signal,
      read: resources.analysis,
      onUpdate(next) {
        if (!active || controller.signal.aborted) return;
        setAnalysis(next);
        setCurrentAnalysis(next);
        logEvent("analysis.poll_updated", { analysisId, status: next.status });
      },
    }).then((result) => {
      if (!active || controller.signal.aborted) return;
      if (result.status === "completed") {
        logEvent("analysis.poll_completed", { analysisId });
        navigate(`/analysis/${encodeURIComponent(analysisId)}/report`);
      }
    }).catch((requestError) => {
      if (!active || isAbortError(requestError)) return;
      setError(requestError.message || "The analysis status could not be loaded.");
      logEvent("analysis.poll_failed", { analysisId, code: requestError.code ?? "UNKNOWN" });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [analysisId, bootError, booting, navigate, retryVersion, setCurrentAnalysis]);

  const retry = async () => {
    controllerRef.current?.abort();
    setPending("retry");
    setError("");
    try {
      const next = await resources.retryAnalysis(analysisId);
      setAnalysis(next.analysis ?? next);
      setCurrentAnalysis(next.analysis ?? next);
      setRetryVersion((version) => version + 1);
      logEvent("analysis.retry_requested", { analysisId });
    } catch (requestError) {
      setError(requestError.message || "The analysis could not be retried.");
      logEvent("analysis.retry_failed", { analysisId, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setPending("");
    }
  };

  const cancel = async () => {
    controllerRef.current?.abort();
    setPending("cancel");
    setError("");
    try {
      const next = await resources.cancelAnalysis(analysisId);
      setAnalysis(next.analysis ?? next);
      setCurrentAnalysis(next.analysis ?? next);
      logEvent("analysis.cancelled", { analysisId });
    } catch (requestError) {
      setError(requestError.message || "The analysis could not be cancelled.");
      logEvent("analysis.cancel_failed", { analysisId, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setPending("");
    }
  };

  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const retryable = analysis?.error?.retryable !== false;
  const heading = failed ? "We couldn’t finish this report" : cancelled ? "This analysis was cancelled" : "Turning your take into a focused practice plan";
  const description = failed ? failureCopy(analysis) : cancelled ? "No report was generated. You can record or upload a new take whenever you are ready." : "The progress below comes from the analysis service and will update automatically.";

  if (booting) return <section className="centered-page" aria-live="polite"><h1>Preparing your secure session</h1><p className="page-lede">Restoring access to this analysis.</p></section>;
  if (bootError) return <section className="centered-page"><h1>The analysis service is unavailable</h1><p className="page-lede">Restore the service connection, then return to this analysis.</p></section>;

  return (
    <section className="centered-page processing-page" aria-live="polite" aria-busy={!terminal && !error}>
      <div className="processing-orbit"><Sparkles size={34} aria-hidden="true" /><span /></div>
      <p className="eyebrow">Analysis status</p>
      <h1>{heading}</h1>
      <p className="page-lede">{description}</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="process-steps">
        {steps.map(({ label, detail, icon: Icon }, index) => {
          const state = stepState(index, status);
          return (
            <div className={`process-step is-${state}`} key={label}>
              <span className="process-icon">{state === "done" ? <Check size={20} /> : <Icon size={20} />}</span>
              <span><strong>{label}</strong><small>{detail}</small></span>
              {state === "active" && <Clock3 size={17} className="process-clock" aria-label="In progress" />}
            </div>
          );
        })}
      </div>

      <div className="processing-actions">
        {failed && retryable && <button className="button button-primary" disabled={Boolean(pending)} onClick={retry}><RotateCcw size={17} />{pending === "retry" ? "Retrying analysis" : "Retry analysis"}</button>}
        {!terminal && <button className="button button-quiet" disabled={Boolean(pending)} onClick={cancel}>Cancel analysis</button>}
        {error && !terminal && <button className="button button-primary" disabled={Boolean(pending)} onClick={() => setRetryVersion((version) => version + 1)}><RotateCcw size={17} />Check status again</button>}
        <button className="button button-secondary" onClick={() => navigate("/")}>{cancelled || failed ? "Return to recorder" : "Keep working while this runs"}</button>
      </div>
    </section>
  );
}

function stepState(index, status) {
  if (status === "failed" || status === "cancelled") return index < analysisStep(status) ? "done" : "pending";
  const activeStep = analysisStep(status);
  return index < activeStep ? "done" : index === activeStep ? "active" : "pending";
}

function failureCopy(analysis) {
  if (analysis?.error?.code) return `The service stopped this analysis (${analysis.error.code}). Retry if the source audio is still available.`;
  return "The service could not finish this analysis. Retry if the source audio is still available.";
}

function isAbortError(error) {
  return error?.name === "AbortError";
}
