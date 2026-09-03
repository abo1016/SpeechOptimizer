import {
  AudioLines,
  ChevronDown,
  Clock3,
  Mail,
  Menu,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { accountNavigation, primaryNavigation } from "../data/productData.js";
import { logEvent } from "../lib/logEvent.js";

function Brand({ navigate }) {
  return (
    <button className="brand" onClick={() => navigate("/")} aria-label="SpeechOptimizer home">
      <img className="brand-lockup" src="/assets/speechoptimizer-lockup.png" alt="SpeechOptimizer" />
    </button>
  );
}

function AuthDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button dialog-close" onClick={onClose} aria-label="Close sign in"><X size={20} /></button>
        <span className="brand-mark auth-mark"><AudioLines size={23} /></span>
        <p className="eyebrow">Save your progress</p>
        <h2 id="auth-title">Keep every take in one place</h2>
        <p>Sign in to compare recordings, keep reports, and manage your minutes.</p>
        <button className="button button-dark auth-action" onClick={() => logEvent("auth.google.selected")}>
          <UserRound size={18} /> Continue with Google
        </button>
        <button className="button button-secondary auth-action" onClick={() => logEvent("auth.magic_link.selected")}>
          <Mail size={18} /> Email me a magic link
        </button>
        <small>Mock sign-in only. No account will be created.</small>
      </section>
    </div>
  );
}

export function AppShell({ activePath, authOpen, children, navigate, onAuthChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const focusMode = activePath === "/analysis/demo-result";
  const isCurrent = (path) => path === "/" ? activePath === "/" : activePath.startsWith(path);

  const go = (path) => {
    setMenuOpen(false);
    navigate(path);
  };

  return (
    <div className={focusMode ? "app-frame app-frame-focus" : "app-frame"}>
      <header className="topbar">
        <Brand navigate={go} />
        <nav className={menuOpen ? "primary-nav is-open" : "primary-nav"} aria-label="Primary navigation">
          {primaryNavigation.map(({ label, path }) => (
            <button key={path} className={isCurrent(path) ? "nav-link is-active" : "nav-link"} onClick={() => go(path)}>{label}</button>
          ))}
          <div className="mobile-account-links">
            {accountNavigation.map(({ label, path, icon: Icon }) => (
              <button key={path} className="nav-link" onClick={() => go(path)}><Icon size={17} />{label}</button>
            ))}
          </div>
        </nav>
        <div className="account-cluster">
          <button className="minute-meter" onClick={() => go("/settings/billing")} aria-label="143 of 300 minutes used">
            <span><Clock3 size={16} />143 / 300 minutes used</span>
            <span className="meter-track"><span style={{ width: "48%" }} /></span>
          </button>
          <button className="account-button" onClick={() => onAuthChange(true)}>
            <span className="avatar">AK</span><span>Alex Kim</span><ChevronDown size={16} />
          </button>
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle navigation">
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>
      <main>{children}</main>
      {!focusMode && <footer className="site-footer">
        <span>SpeechOptimizer prototype</span>
        <nav aria-label="Legal links">
          <button onClick={() => go("/contact")}>Contact</button>
          <button onClick={() => go("/privacy")}>Privacy</button>
          <button onClick={() => go("/terms")}>Terms</button>
          <button onClick={() => go("/refund-policy")}>Refunds</button>
          <button onClick={() => go("/data-deletion")}>Delete data</button>
        </nav>
      </footer>}
      <AuthDialog open={authOpen} onClose={() => onAuthChange(false)} />
    </div>
  );
}
