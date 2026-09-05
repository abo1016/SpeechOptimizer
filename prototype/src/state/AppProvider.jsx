import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { resources } from "../api/resources.js";
import { logEvent } from "../lib/logEvent.js";
import { loadSessionWithAnonymousFallback } from "./sessionBootstrap.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [providerMode, setProviderMode] = useState("unknown");
  const [authMode, setAuthMode] = useState("unknown");
  const [retainAudio, setRetainAudio] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [report, setReport] = useState(null);
  const [bootError, setBootError] = useState("");
  const [booting, setBooting] = useState(true);

  const refreshSession = useCallback(async () => {
    // 会话失效与首次访问都回到匿名会话，避免页面继续展示已失效的账户信息。
    const next = await loadSessionWithAnonymousFallback(resources);
    setSession(next);
    const preference = await resources.privacy();
    setRetainAudio(preference.retainAudio === true);
    return next;
  }, []);

  const applyBootstrap = useCallback((value) => {
    setProviderMode(value.health.mode);
    setAuthMode(value.health.authMode ?? value.health.mode);
    setSession(value.session);
    setRetainAudio(value.privacy.retainAudio === true);
    logEvent("app.bootstrap_ready", {
      providerMode: value.health.mode,
      authMode: value.health.authMode ?? value.health.mode,
      identityType: value.session.identity.type,
    });
    return value;
  }, []);

  const retryBootstrap = useCallback(async () => {
    setBooting(true);
    setBootError("");
    try {
      return applyBootstrap(await bootstrap());
    } catch (error) {
      setBootError(error.message);
      logEvent("app.bootstrap_failed", { code: error.code ?? "UNKNOWN" });
      throw error;
    } finally {
      setBooting(false);
    }
  }, [applyBootstrap]);

  useEffect(() => {
    let active = true;
    setBooting(true);
    setBootError("");
    bootstrap().then((value) => {
      if (active) applyBootstrap(value);
    }).catch((error) => {
      if (!active) return;
      setBootError(error.message);
      logEvent("app.bootstrap_failed", { code: error.code ?? "UNKNOWN" });
    }).finally(() => {
      if (active) setBooting(false);
    });
    return () => { active = false; };
  }, [applyBootstrap]);

  const updatePrivacy = useCallback(async (next) => {
    const result = await resources.updatePrivacy(next);
    setRetainAudio(result.retainAudio);
    logEvent("privacy.preference_updated", { retainAudio: result.retainAudio === true });
    return result;
  }, []);

  const logout = useCallback(async () => {
    await resources.logout();
    setReport(null);
    setCurrentAnalysis(null);
    const next = await refreshSession();
    logEvent("auth.logout_completed", { identityType: next.identity.type });
    return next;
  }, [refreshSession]);

  const value = useMemo(() => ({
    session, providerMode, authMode, retainAudio, currentAnalysis, report, bootError, booting,
    setCurrentAnalysis, setReport, refreshSession, retryBootstrap, updatePrivacy, logout,
  }), [session, providerMode, authMode, retainAudio, currentAnalysis, report, bootError, booting, refreshSession, retryBootstrap, updatePrivacy, logout]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

async function bootstrap() {
  // 同时订阅健康检查与会话初始化，避免 health 过早失败时形成未处理的 Promise 拒绝。
  const [health, session] = await Promise.all([
    resources.health(),
    loadSessionWithAnonymousFallback(resources),
  ]);
  const privacy = await resources.privacy();
  return { health, session, privacy };
}

/** 首屏无 Cookie 时先初始化匿名会话，再重试会话读取，避免把正常冷启动误报为服务不可用。 */
