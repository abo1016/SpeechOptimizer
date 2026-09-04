import { AlertCircle, Clock3, CreditCard, Mail, MessageSquareText, ShieldCheck } from "lucide-react";
import { routeTable } from "../data/productData.js";
import { AdminContent } from "./secondary/AdminContent.jsx";
import { BillingContent, PricingContent } from "./secondary/BillingContent.jsx";
import { HistoryContent } from "./secondary/HistoryContent.jsx";
import { PrivacyContent } from "./secondary/PrivacyContent.jsx";

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
          <span className="setting-icon" aria-hidden="true"><Icon size={20} /></span>
          <div><h2>{title}</h2><p>{detail}</p></div>
          <a className="button button-secondary" href={`mailto:${email}`}><Mail size={17} />{email}</a>
        </article>
      ))}
      <p className="contact-note"><Clock3 size={17} aria-hidden="true" />Email links open your configured mail application.</p>
    </div>
  );
}

function LegalContent({ title }) {
  return <article className="legal-draft"><span><AlertCircle size={18} />Draft structure — not reviewed legal text</span><h2>Purpose and scope</h2><p>This page reserves the final information architecture for {title.toLowerCase()}. Product claims and legal language must be reviewed before launch.</p><h2>What still needs confirmation</h2><ul><li>Business entity and jurisdiction</li><li>Payment and refund responsibilities</li><li>Audio, transcript, and report retention periods</li><li>Contact and deletion request channels</li></ul></article>;
}

/** 次级路由将有 API 的功能交给对应真实模块，静态法律草案不伪装为服务端内容。 */
export function SecondaryPage({ path, navigate }) {
  const page = routeTable[path];
  return (
    <div className="secondary-page page-container">
      <header className="page-heading"><div><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1></div></header>
      {page.kind === "history" && <HistoryContent navigate={navigate} />}
      {page.kind === "pricing" && <PricingContent />}
      {page.kind === "billing" && <BillingContent />}
      {page.kind === "privacy" && <PrivacyContent navigate={navigate} />}
      {page.kind === "admin" && <AdminContent />}
      {page.kind === "contact" && <ContactContent />}
      {page.kind === "legal" && <LegalContent title={page.title} />}
    </div>
  );
}
