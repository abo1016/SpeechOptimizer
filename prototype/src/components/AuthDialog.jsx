import { AudioLines, Mail, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resources } from "../api/resources.js";
import { logEvent } from "../lib/logEvent.js";
import { useApp } from "../state/AppProvider.jsx";

/** 登录弹窗调用真实认证端点，并将服务端失败信息以可读状态反馈给键盘与读屏用户。 */
export function AuthDialog({ open, onClose }) {
  const { providerMode, refreshSession } = useApp();
  const closeRef = useRef(null);
  const [email, setEmail] = useState("");
  const [previewToken, setPreviewToken] = useState("");
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  const requestLink = (event) => {
    event.preventDefault();
    return run("magic-link", async () => {
      const result = await resources.requestMagicLink(email, authRedirectUri());
      setPreviewToken(result.previewToken ?? "");
      setNotice(result.previewToken ? "A local preview link is ready below." : "Check your email for the sign-in link.");
    });
  };

  const consumePreview = () => run("magic-preview", async () => {
    await resources.consumeMagicLink(previewToken);
    await refreshSession();
    logEvent("auth.magic_link_completed");
    onClose();
  });

  const startGoogle = () => run("google", async () => {
    const result = await resources.startGoogle(authRedirectUri());
    if (providerMode === "mock") {
      await resources.completeGoogle(result.state, "valid-local-code");
      await refreshSession();
      logEvent("auth.local_google_completed");
      onClose();
      return;
    }
    window.location.assign(result.authorizationUrl);
  });

  async function run(action, operation) {
    setPending(action);
    setError("");
    setNotice("");
    try {
      await operation();
      logEvent("auth.action_completed", { action, providerMode });
    } catch (requestError) {
      setError(requestError.message || "Sign-in could not be completed. Try again.");
      logEvent("auth.action_failed", { action, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setPending("");
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-description" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} className="icon-button dialog-close" onClick={onClose} aria-label="Close sign in"><X size={20} /></button>
        <span className="brand-mark auth-mark" aria-hidden="true"><AudioLines size={23} /></span>
        <p className="eyebrow">Save your progress</p>
        <h2 id="auth-title">Keep every take in one place</h2>
        <p id="auth-description">Sign in to retain reports, compare recordings, and manage minutes.</p>
        <button className="button button-dark auth-action" disabled={Boolean(pending)} onClick={startGoogle}>
          <UserRound size={18} />{providerMode === "mock" ? "Continue with local Google" : "Continue with Google"}
        </button>
        <form onSubmit={requestLink}>
          <label className="field-label" htmlFor="magic-email">Email address</label>
          <input id="magic-email" className="text-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          <button className="button button-secondary auth-action" type="submit" disabled={!email || Boolean(pending)}>
            <Mail size={18} />Email me a magic link
          </button>
        </form>
        {previewToken && <button className="text-button auth-preview" disabled={Boolean(pending)} onClick={consumePreview}>Use local preview link</button>}
        {notice && <p className="dialog-message" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <small>{providerMode === "mock" ? "Local development mode uses explicit test identity providers." : "Authentication is completed by the configured production provider."}</small>
      </section>
    </div>
  );
}

function authRedirectUri() {
  return `${window.location.origin}/auth/callback`;
}
