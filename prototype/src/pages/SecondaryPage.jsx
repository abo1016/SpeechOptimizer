import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Database,
  FileAudio,
  Mail,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { routeTable, sessions } from "../data/productData.js";
import { logEvent } from "../lib/logEvent.js";

function HistoryContent({ navigate }) {
  return (
    <div className="history-table">
      <div className="history-row history-header"><span>Session</span><span>Status</span><span>Duration</span><span>Score</span><span /></div>
      {sessions.map((session, index) => (
        <div className="history-row" key={session.title}>
          <span><strong>{session.title}</strong><small>{session.date}</small></span>
          <span className="status-chip"><Check size={14} />Complete</span>
          <span>{session.duration}</span><span>{session.score}</span>
          <span className="row-actions"><button className="icon-button" aria-label={`Delete ${session.title}`} onClick={() => logEvent("history.delete_requested", { index })}><Trash2 size={17} /></button><button className="icon-button" aria-label={`Open ${session.title}`} onClick={() => navigate("/analysis/demo-result")}><ChevronRight size={18} /></button></span>
        </div>
      ))}
    </div>
  );
}

const plans = [
  { name: "Free", price: "$0", detail: "5 minutes each month", action: "Current plan", features: ["Saved reports", "Basic comparisons"] },
  { name: "Pro", price: "$12", detail: "60 minutes each month", action: "Choose Pro", features: ["Full feedback", "Unlimited history", "Take comparisons"], featured: true },
  { name: "Minutes pack", price: "$6", detail: "30 minutes, one time", action: "Buy minutes", features: ["No subscription", "Uses Waffo checkout"] },
];

function PricingContent() {
  return <div className="pricing-grid">{plans.map((plan) => (
    <article className={plan.featured ? "plan-card is-featured" : "plan-card"} key={plan.name}>
      {plan.featured && <span className="plan-label">Best for regular practice</span>}
      <h2>{plan.name}</h2><strong>{plan.price}<small>{plan.name === "Pro" ? "/month" : ""}</small></strong><p>{plan.detail}</p>
      <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>
      <button className={plan.featured ? "button button-primary" : "button button-secondary"} onClick={() => logEvent("pricing.plan_selected", { plan: plan.name })}>{plan.action}</button>
    </article>
  ))}</div>;
}

function BillingContent() {
  return (
    <div className="settings-layout">
      <section className="settings-main">
        <div className="balance-panel"><span><Clock3 size={22} />Minutes available</span><strong>157</strong><p>of 300 minutes remain this billing period.</p><div className="wide-meter"><span style={{ width: "52%" }} /></div></div>
        <div className="setting-row"><span className="setting-icon"><CreditCard size={20} /></span><div><strong>Pro monthly</strong><p>Renews September 18, 2026 via Waffo.</p></div><button className="button button-secondary">Manage</button></div>
        <div className="setting-row"><span className="setting-icon"><RefreshCw size={20} /></span><div><strong>Recent minute activity</strong><p>14 minutes used · August 30, 2026</p></div><button className="text-button">View ledger <ArrowRight size={16} /></button></div>
      </section>
      <aside className="info-panel"><ShieldCheck size={22} /><h2>Payment status</h2><p>This prototype uses simulated Waffo states and never opens checkout.</p></aside>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="settings-main privacy-settings">
      <div className="setting-row"><span className="setting-icon"><FileAudio size={20} /></span><div><strong>Save original audio</strong><p>Off by default. Reports and metrics remain available without the audio.</p></div><button className="toggle" aria-pressed="false" onClick={() => logEvent("privacy.audio_toggle_clicked")}><span /></button></div>
      <div className="setting-row"><span className="setting-icon"><Database size={20} /></span><div><strong>Delete a single analysis</strong><p>Removes its report, transcript, metrics, and any retained audio.</p></div><button className="button button-secondary">Review history</button></div>
      <div className="setting-row danger-row"><span className="setting-icon"><Trash2 size={20} /></span><div><strong>Delete account</strong><p>Starts a tracked deletion request for all account data.</p></div><button className="button button-danger" onClick={() => logEvent("privacy.account_delete_requested")}>Request deletion</button></div>
    </div>
  );
}

function AdminContent() {
  const items = [["Users", "1,284", UserRound], ["Processing", "12", RefreshCw], ["Failed tasks", "3", AlertCircle], ["Audio retained", "7%", FileAudio]];
  return <><div className="admin-metrics">{items.map(([label, value, Icon]) => <article key={label}><Icon size={20} /><span>{label}</span><strong>{value}</strong></article>)}</div><div className="admin-queue"><h2>Needs attention</h2><div className="queue-row"><AlertCircle size={18} /><span><strong>3 analysis tasks failed</strong><small>Mock queue · no production data</small></span><button className="button button-secondary">Review</button></div><div className="queue-row"><ShieldCheck size={18} /><span><strong>1 deletion request pending</strong><small>Due within 6 days</small></span><button className="button button-secondary">Open</button></div></div></>;
}

function ContactContent() {
  const contacts = [
    { title: "Product feedback", detail: "Share workflow friction or a feature idea.", email: "feedback@speechoptimizer.app", icon: MessageSquareText },
    { title: "Billing support", detail: "Ask about plans, minutes, charges, or refunds.", email: "billing@speechoptimizer.app", icon: CreditCard },
    { title: "Privacy requests", detail: "Request data access, correction, or deletion.", email: "privacy@speechoptimizer.app", icon: ShieldCheck },
  ];

  return (
    <div className="contact-grid">
      {contacts.map(({ title, detail, email, icon: Icon }) => (
        <article className="contact-item" key={title}>
          <span className="setting-icon"><Icon size={20} /></span>
          <div><h2>{title}</h2><p>{detail}</p></div>
          <button className="button button-secondary" onClick={() => logEvent("contact.mock_selected", { channel: title })}><Mail size={17} />{email}</button>
        </article>
      ))}
      <p className="contact-note"><Clock3 size={17} />Mock contact channels for product review. No email is sent from this prototype.</p>
    </div>
  );
}

function LegalContent({ title }) {
  return <article className="legal-draft"><span><AlertCircle size={18} />Draft structure — not reviewed legal text</span><h2>Purpose and scope</h2><p>This page reserves the final information architecture for {title.toLowerCase()}. Product claims and legal language must be reviewed before launch.</p><h2>What still needs confirmation</h2><ul><li>Business entity and jurisdiction</li><li>Waffo payment and refund responsibilities</li><li>Audio, transcript, and report retention periods</li><li>Contact and deletion request channels</li></ul></article>;
}

export function SecondaryPage({ path, navigate }) {
  const page = routeTable[path];
  return (
    <div className="secondary-page page-container">
      <header className="page-heading"><div><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1></div></header>
      {page.kind === "history" && <HistoryContent navigate={navigate} />}
      {page.kind === "pricing" && <PricingContent />}
      {page.kind === "billing" && <BillingContent />}
      {page.kind === "privacy" && <PrivacyContent />}
      {page.kind === "admin" && <AdminContent />}
      {page.kind === "contact" && <ContactContent />}
      {page.kind === "legal" && <LegalContent title={page.title} />}
    </div>
  );
}
