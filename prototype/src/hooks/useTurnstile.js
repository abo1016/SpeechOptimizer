import { useEffect, useRef, useState } from "react";

/** Turnstile 仅在生产认证模式加载；site key 由 Worker health 返回，避免构建机持有部署配置。 */
export function useTurnstile({ enabled, siteKey, onConfigurationError }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    // 关闭弹窗、切换账户或重建 widget 时立即丢弃旧 token；Turnstile token 不能跨一次提交复用。
    setToken("");
    if (!enabled) {
      // Bootstrap 完成后如果当前用户无需 Turnstile，要同步清掉早期配置态留下的提示，
      // 避免已登录用户仍看到“未配置人机验证”的陈旧错误。
      onConfigurationError("");
      return undefined;
    }
    if (!siteKey) {
      onConfigurationError("Human verification is not configured for this deployment.");
      return undefined;
    }
    onConfigurationError("");
    return mountTurnstile(containerRef, widgetIdRef, siteKey, setToken, onConfigurationError);
  }, [enabled, onConfigurationError, siteKey]);

  const reset = () => {
    setToken("");
    if (widgetIdRef.current !== null && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  };
  return { containerRef, token, reset };
}

function mountTurnstile(containerRef, widgetIdRef, siteKey, setToken, onConfigurationError) {
  let cancelled = false;
  const render = () => {
    if (cancelled || !containerRef.current || !window.turnstile) return;
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        // 保留服务端 Turnstile 校验，但正常访问不常驻显示验证控件；
        // 仅当 Cloudflare 判定需要用户交互时才展示 challenge，降低对录音与登录流程的打扰。
        appearance: "interaction-only",
        callback: setToken,
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      });
    } catch {
      setToken("");
      onConfigurationError("Human verification could not be initialized. Refresh and try again.");
    }
  };
  const fail = () => {
    if (cancelled) return;
    setToken("");
    onConfigurationError("Human verification could not be loaded. Refresh and try again.");
  };
  const script = ensureScript();
  if (window.turnstile) render();
  else {
    script.addEventListener("load", render, { once: true });
    script.addEventListener("error", fail, { once: true });
  }
  return () => {
    cancelled = true;
    script.removeEventListener("load", render);
    script.removeEventListener("error", fail);
    if (widgetIdRef.current !== null && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    widgetIdRef.current = null;
  };
}

function ensureScript() {
  const existing = document.getElementById("cloudflare-turnstile-script");
  if (existing) return existing;
  const script = document.createElement("script");
  script.id = "cloudflare-turnstile-script";
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
  return script;
}
