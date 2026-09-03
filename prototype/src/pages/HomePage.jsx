import { ArrowRight, FileText, PlayCircle } from "lucide-react";
import { feedbackPreview, sessions } from "../data/productData.js";
import { RecorderWorkspace } from "../components/RecorderWorkspace.jsx";

function FeedbackPanel({ navigate }) {
  return (
    <aside className="feedback-panel" aria-labelledby="feedback-title">
      <p className="eyebrow">Sample report</p>
      <h2 id="feedback-title">What you’ll get</h2>
      <p className="panel-intro">Feedback tied to observable moments in your recording.</p>
      <div className="feedback-list">
        {feedbackPreview.map(({ title, description, evidence, icon: Icon, tone }) => (
          <article className={`feedback-item tone-${tone}`} key={title}>
            <span className="feedback-icon"><Icon size={21} /></span>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="evidence"><ArrowRight size={15} />{evidence}</span>
            </div>
          </article>
        ))}
      </div>
      <button className="text-button" onClick={() => navigate("/analysis/demo-result")}>
        See full sample report <ArrowRight size={17} />
      </button>
    </aside>
  );
}

function RecentSessions({ navigate }) {
  return (
    <section className="recent-section" aria-labelledby="recent-title">
      <div className="section-heading compact">
        <div><p className="eyebrow">Keep improving</p><h2 id="recent-title">Recent sessions</h2></div>
        <button className="text-button" onClick={() => navigate("/history")}>View all <ArrowRight size={17} /></button>
      </div>
      <div className="session-list">
        {sessions.map((session) => (
          <button className="session-row" key={session.title} onClick={() => navigate("/analysis/demo-result")}>
            <PlayCircle size={22} />
            <span className="session-title"><strong>{session.title}</strong><small>{session.date}</small></span>
            <span className="session-duration">{session.duration}</span>
            <span className="session-metric">{session.metric}</span>
            <span className="session-status">{session.focus}</span>
            <FileText size={18} className="session-open" />
          </button>
        ))}
      </div>
    </section>
  );
}

export function HomePage({ navigate }) {
  return (
    <div className="home-grid">
      <RecorderWorkspace navigate={navigate} />
      <RecentSessions navigate={navigate} />
      <FeedbackPanel navigate={navigate} />
    </div>
  );
}
