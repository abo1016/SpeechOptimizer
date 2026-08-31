import { ArrowRight, CheckCircle2, Clock3, Mic, Play, Quote, RotateCcw } from "lucide-react";
import { metrics, priorities } from "../data/productData.js";
import { logEvent } from "../lib/logEvent.js";

function PriorityCard({ item }) {
  return (
    <article className={`priority-card tone-${item.tone}`}>
      <span className="priority-rank">{item.rank}</span>
      <div className="priority-content">
        <h3>{item.title}</h3>
        <p>{item.finding}</p>
        <dl>
          <div><dt>Change</dt><dd>{item.action}</dd></div>
          <div><dt>Next-take cue</dt><dd>{item.cue}</dd></div>
        </dl>
      </div>
    </article>
  );
}

export function ResultPage({ navigate }) {
  const startRetake = () => {
    logEvent("retake.started", { sourceReport: "demo-result" });
    navigate("/");
  };

  return (
    <div className="report-page page-container">
      <header className="page-heading report-heading">
        <div>
          <p className="eyebrow">Report ready · Aug 30, 2026</p>
          <h1>Your clearest opportunities are in the opening and transitions</h1>
          <p className="page-lede">Start with these three changes. The numbers below explain why they matter.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={() => logEvent("audio.preview_played")}><Play size={17} fill="currentColor" />Play take</button>
          <button className="button button-primary" onClick={startRetake}><Mic size={18} />Record another take</button>
        </div>
      </header>

      <section className="priority-section" aria-labelledby="priority-title">
        <div className="section-heading compact"><div><p className="eyebrow">Start here</p><h2 id="priority-title">Your three priorities</h2></div><span className="complete-label"><CheckCircle2 size={17} />Evidence-based</span></div>
        <div className="priority-grid">{priorities.map((item) => <PriorityCard item={item} key={item.rank} />)}</div>
      </section>

      <section className="metric-section" aria-labelledby="metrics-title">
        <div className="section-heading compact"><div><p className="eyebrow">Supporting detail</p><h2 id="metrics-title">Delivery metrics</h2></div></div>
        <div className="metric-grid">
          {metrics.map((metric) => (
            <article className="metric-card" key={metric.label}>
              <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.unit}</small><em>{metric.state}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="evidence-strip">
        <Quote size={23} />
        <div><strong>Evidence at 00:34</strong><p>“And, um, the second thing I wanted to say is…”</p></div>
        <span><Clock3 size={15} />Transition pause: 3.7s</span>
      </section>

      <section className="next-take-band">
        <div><p className="eyebrow">Close the loop</p><h2>Make one better take while the feedback is fresh.</h2></div>
        <div>
          <button className="button button-secondary" onClick={startRetake}><RotateCcw size={17} />Re-record</button>
          <button className="button button-dark" onClick={() => navigate("/compare/demo")}>View sample comparison <ArrowRight size={17} /></button>
        </div>
      </section>
    </div>
  );
}
