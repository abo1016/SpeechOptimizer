import { ArrowLeft, ArrowRight, Check, Equal, Sparkles } from "lucide-react";
import { comparisonMetrics } from "../data/productData.js";

export function ComparePage({ navigate }) {
  return (
    <div className="compare-page page-container">
      <button className="back-button" onClick={() => navigate("/analysis/demo-result")}><ArrowLeft size={17} />Back to report</button>
      <header className="page-heading compare-heading">
        <div>
          <p className="eyebrow">Take 1 vs. Take 2</p>
          <h1>Your second take is easier to follow</h1>
          <p className="page-lede">The recordings are similar enough to compare. Pace and transition control improved most.</p>
        </div>
        <span className="comparison-verdict"><Sparkles size={19} />Meaningful improvement</span>
      </header>

      <section className="compare-table" aria-label="Metric comparison">
        <div className="compare-row compare-header"><span>Metric</span><span>First take</span><span>Second take</span><span>Change</span></div>
        {comparisonMetrics.map((metric) => (
          <div className="compare-row" key={metric.label}>
            <strong>{metric.label}</strong><span>{metric.before}</span><span className="after-value">{metric.after}</span><span className="delta"><Check size={15} />{metric.delta}</span>
          </div>
        ))}
      </section>

      <section className="compare-notes">
        <article>
          <span className="note-icon positive"><Check size={19} /></span>
          <div><p className="eyebrow">Improved</p><h2>Your transitions now have room to breathe</h2><p>You replaced five filler words with short, intentional pauses while keeping the same structure.</p></div>
        </article>
        <article>
          <span className="note-icon neutral"><Equal size={19} /></span>
          <div><p className="eyebrow">Keep practicing</p><h2>The opening is still doing too much</h2><p>The main idea now appears at 00:11 instead of 00:18. Try placing it in the first sentence.</p></div>
        </article>
      </section>

      <section className="next-take-band">
        <div><p className="eyebrow">Next session</p><h2>Keep the structure. Tighten the first sentence.</h2></div>
        <button className="button button-dark" onClick={() => navigate("/")}>Start a new take <ArrowRight size={17} /></button>
      </section>
    </div>
  );
}
