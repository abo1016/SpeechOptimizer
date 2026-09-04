import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
import { AuthCallbackPage } from "./pages/AuthCallbackPage.jsx";
import { ComparePage } from "./pages/ComparePage.jsx";
import { HomePage } from "./pages/HomePage.jsx";
import { ProcessingPage } from "./pages/ProcessingPage.jsx";
import { ResultPage } from "./pages/ResultPage.jsx";
import { SecondaryPage } from "./pages/SecondaryPage.jsx";
import { routeTable } from "./data/productData.js";
import { logEvent } from "./lib/logEvent.js";

function currentPath() {
  return window.location.pathname || "/";
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const handleHistoryChange = () => setPath(currentPath());
    window.addEventListener("popstate", handleHistoryChange);
    return () => window.removeEventListener("popstate", handleHistoryChange);
  }, []);

  const navigate = (nextPath) => {
    if (nextPath === path) return;
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: "smooth" });
    logEvent("navigation.changed", { from: path, to: nextPath });
  };

  let page = <HomePage navigate={navigate} />;
  const route = analysisRoute(path);
  if (path === "/auth/callback") page = <AuthCallbackPage navigate={navigate} />;
  if (route?.kind === "processing") page = <ProcessingPage analysisId={route.analysisId} navigate={navigate} />;
  if (route?.kind === "report") page = <ResultPage analysisId={route.analysisId} navigate={navigate} />;
  if (route?.kind === "compare") page = <ComparePage beforeAnalysisId={route.beforeAnalysisId} afterAnalysisId={route.afterAnalysisId} navigate={navigate} />;
  if (routeTable[path]) page = <SecondaryPage path={path} navigate={navigate} />;

  return (
    <AppShell
      activePath={path}
      authOpen={authOpen}
      navigate={navigate}
      onAuthChange={setAuthOpen}
    >
      {page}
    </AppShell>
  );
}

/** 动态任务路径只接受 API 生成的标识，避免旧演示路径误进入真实处理流程。 */
function analysisRoute(path) {
  const processing = path.match(/^\/analysis\/([^/]+)\/processing$/);
  if (processing) return { kind: "processing", analysisId: processing[1] };
  const report = path.match(/^\/analysis\/([^/]+)\/report$/);
  if (report) return { kind: "report", analysisId: report[1] };
  const compare = path.match(/^\/compare\/([^/]+)\/([^/]+)$/);
  if (compare) return { kind: "compare", beforeAnalysisId: compare[1], afterAnalysisId: compare[2] };
  return null;
}
