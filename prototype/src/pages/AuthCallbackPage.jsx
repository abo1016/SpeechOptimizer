import { CheckCircle2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../api/resources.js";
import { completeAuthCallback } from "../lib/authCallback.js";
import { logEvent } from "../lib/logEvent.js";
import { useApp } from "../state/AppProvider.jsx";

/** 登录回跳页统一消费 Magic Link token 或 Google OAuth code，成功后立即回到工具首页。 */
export function AuthCallbackPage({ navigate }) {
  const { refreshSession } = useApp();
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const complete = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const result = await completeAuthCallback(window.location.search, resources);
      await refreshSession();
      logEvent("auth.callback_completed", { provider: result.provider });
      navigate("/");
    } catch (requestError) {
      setStatus("error");
      setError(requestError.message || "Sign-in could not be completed. Try again.");
      logEvent("auth.callback_failed", { code: requestError.code ?? "UNKNOWN" });
    }
  }, [navigate, refreshSession]);

  useEffect(() => { complete(); }, [complete]);

  return (
    <section className="centered-page" aria-live="polite" aria-busy={status === "loading"}>
      <CheckCircle2 size={34} aria-hidden="true" />
      <p className="eyebrow">Sign in</p>
      <h1>{status === "loading" ? "Finishing your sign in" : "We could not finish signing you in"}</h1>
      <p className="page-lede" role={status === "error" ? "alert" : undefined}>{status === "loading" ? "Confirming your one-time sign-in response." : error}</p>
      {status === "error" && <div className="processing-actions"><button className="button button-primary" onClick={complete}><RotateCcw size={17} />Try again</button><button className="button button-secondary" onClick={() => navigate("/")}>Return home</button></div>}
    </section>
  );
}
