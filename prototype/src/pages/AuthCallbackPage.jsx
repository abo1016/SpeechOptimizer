import { CheckCircle2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { resources } from "../api/resources.js";
import { logEvent } from "../lib/logEvent.js";
import { useApp } from "../state/AppProvider.jsx";

/** OAuth 回跳页仅消费 URL 中的临时 code，成功后立即回到工具首页。 */
export function AuthCallbackPage({ navigate }) {
  const { refreshSession } = useApp();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const state = params.get("state");
  const code = params.get("code");

  const complete = useCallback(async () => {
    if (!state || !code) {
      setStatus("error");
      setError("The sign-in response is incomplete. Return to the home page and try again.");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      await resources.completeGoogle(state, code);
      await refreshSession();
      logEvent("auth.google_completed");
      navigate("/");
    } catch (requestError) {
      setStatus("error");
      setError(requestError.message);
      logEvent("auth.google_completion_failed", { code: requestError.code ?? "UNKNOWN" });
    }
  }, [code, navigate, refreshSession, state]);

  useEffect(() => { complete(); }, [complete]);

  return (
    <section className="centered-page" aria-live="polite" aria-busy={status === "loading"}>
      <CheckCircle2 size={34} aria-hidden="true" />
      <p className="eyebrow">Sign in</p>
      <h1>{status === "loading" ? "Finishing your sign in" : "We could not finish signing you in"}</h1>
      <p className="page-lede" role={status === "error" ? "alert" : undefined}>{status === "loading" ? "Confirming your account with the configured provider." : error}</p>
      {status === "error" && <div className="processing-actions"><button className="button button-primary" onClick={complete}><RotateCcw size={17} />Try again</button><button className="button button-secondary" onClick={() => navigate("/")}>Return home</button></div>}
    </section>
  );
}
