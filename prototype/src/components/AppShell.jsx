import { Clock3, LogOut, Menu, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { resources } from "../api/resources.js";
import { accountNavigation, primaryNavigation } from "../data/productData.js";
import { logEvent } from "../lib/logEvent.js";
import { useApp } from "../state/AppProvider.jsx";
import { AuthDialog } from "./AuthDialog.jsx";

function Brand({ navigate }) {
  return (
    <button className="brand" onClick={() => navigate("/")} aria-label="SpeechOptimizer home">
      <img src="/assets/speechoptimizer-lockup.png" alt="SpeechOptimizer" />
    </button>
  );
}

/** 顶栏只显示当前会话与服务端余额，避免把演示账户和固定分钟数混入真实流程。 */
export function AppShell({ activePath, authOpen, children, navigate, onAuthChange }) {
  const { bootError, booting, logout, retryBootstrap, session } = useApp();
  const [accountOpen, setAccountOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const [balanceError, setBalanceError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const user = session?.user;
  const isCurrent = (path) => path === "/" ? activePath === "/" : activePath.startsWith(path);
  const minutes = balance?.minutes;
  const meterWidth = Number.isFinite(minutes) ? `${Math.min(Math.max(minutes, 0), 100)}%` : "0%";

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setBalance(null);
      setBalanceError("");
      return () => { active = false; };
    }
    resources.balance().then((next) => {
      if (active) setBalance(next);
    }).catch((error) => {
      if (!active) return;
      setBalanceError(error.message);
      logEvent("billing.header_balance_failed", { code: error.code ?? "UNKNOWN" });
    });
    return () => { active = false; };
  }, [user?.id]);

  const go = (path) => {
    setAccountOpen(false);
    setMenuOpen(false);
    navigate(path);
  };

  const signOut = async () => {
    setSigningOut(true);
    setBalanceError("");
    try {
      await logout();
      setAccountOpen(false);
      logEvent("header.sign_out_completed");
    } catch (error) {
      setBalanceError(error.message);
      logEvent("header.sign_out_failed", { code: error.code ?? "UNKNOWN" });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="app-frame">
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
          <button className="minute-meter" onClick={() => go("/settings/billing")} aria-label={user ? "View available minutes" : "Sign in to view minutes"}>
            <span><Clock3 size={16} />{user ? (Number.isFinite(minutes) ? `${minutes} minutes available` : "Loading minutes") : "Sign in to save work"}</span>
            {user && <span className="meter-track"><span style={{ width: meterWidth }} /></span>}
          </button>
          <button className="account-button" onClick={() => user ? setAccountOpen((open) => !open) : onAuthChange(true)} aria-expanded={user ? accountOpen : undefined} aria-haspopup={user ? "menu" : undefined}>
            <span className="avatar">{user ? initials(user.email) : <UserRound size={17} />}</span><span>{user ? user.email : "Sign in"}</span>
          </button>
          {user && accountOpen && <div role="menu" aria-label="Account menu"><button className="text-button" role="menuitem" disabled={signingOut} onClick={signOut}><LogOut size={16} />{signingOut ? "Signing out" : "Sign out"}</button></div>}
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>
      {(bootError || balanceError) && <aside role="alert" className="form-error"><p>{bootError ? `Service connection failed: ${bootError}` : `Billing data could not load: ${balanceError}`}</p>{bootError && <button className="text-button" disabled={booting} onClick={() => retryBootstrap().catch(() => undefined)}>{booting ? "Retrying connection" : "Retry connection"}</button>}</aside>}
      <main>{children}</main>
      <footer className="site-footer">
        <span>SpeechOptimizer</span>
        <nav aria-label="Legal links">
          <button onClick={() => go("/privacy")}>Privacy</button>
          <button onClick={() => go("/terms")}>Terms</button>
          <button onClick={() => go("/refund-policy")}>Refunds</button>
          <button onClick={() => go("/data-deletion")}>Delete data</button>
        </nav>
      </footer>
      <AuthDialog open={authOpen} onClose={() => onAuthChange(false)} />
    </div>
  );
}

function initials(email) {
  return String(email ?? "Account").slice(0, 2).toUpperCase();
}
