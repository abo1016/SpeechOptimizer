import { Check, CircleDashed, Clock3, FileAudio, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { logEvent } from "../lib/logEvent.js";

const steps = [
  { label: "Upload complete", detail: "Your 1:14 audio file is ready.", icon: FileAudio },
  { label: "Transcribing speech", detail: "Finding words, timing, and pauses.", icon: CircleDashed },
  { label: "Building your feedback", detail: "Prioritizing the next three actions.", icon: Sparkles },
];

export function ProcessingPage({ navigate }) {
  const [activeStep, setActiveStep] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed || activeStep >= 2) return undefined;
    const timer = window.setTimeout(() => setActiveStep((value) => value + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [activeStep, failed]);

  useEffect(() => {
    if (failed || activeStep !== 2) return undefined;
    const timer = window.setTimeout(() => {
      logEvent("analysis.mock_completed", { durationMs: 4200 });
      navigate("/analysis/demo-result");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [activeStep, failed, navigate]);

  const retry = () => {
    setFailed(false);
    setActiveStep(1);
    logEvent("analysis.retry_selected");
  };

  return (
    <section className="centered-page processing-page" aria-live="polite" aria-busy={!failed}>
      <div className="processing-orbit"><Sparkles size={34} /><span /></div>
      <p className="eyebrow">Analysis in progress</p>
      <h1>{failed ? "We couldn’t finish this report" : "Turning your take into a focused practice plan"}</h1>
      <p className="page-lede">{failed ? "Your audio is safe. Retry the Mock analysis or return to the recorder." : "This Mock flow demonstrates stable progress and will open the sample report automatically."}</p>

      <div className="process-steps">
        {steps.map(({ label, detail, icon: Icon }, index) => {
          const state = index < activeStep ? "done" : index === activeStep ? "active" : "pending";
          return (
            <div className={`process-step is-${state}`} key={label}>
              <span className="process-icon">{state === "done" ? <Check size={20} /> : <Icon size={20} />}</span>
              <span><strong>{label}</strong><small>{detail}</small></span>
              {state === "active" && <Clock3 size={17} className="process-clock" />}
            </div>
          );
        })}
      </div>

      <div className="processing-actions">
        {failed ? (
          <button className="button button-primary" onClick={retry}><RotateCcw size={17} />Retry analysis</button>
        ) : (
          <button className="button button-quiet" onClick={() => setFailed(true)}>Preview failure state</button>
        )}
        <button className="button button-secondary" onClick={() => navigate("/")}>Cancel and return</button>
      </div>
    </section>
  );
}
