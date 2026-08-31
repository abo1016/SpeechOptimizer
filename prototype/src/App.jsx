import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
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
  if (path === "/analysis/demo-processing") page = <ProcessingPage navigate={navigate} />;
  if (path === "/analysis/demo-result") page = <ResultPage navigate={navigate} />;
  if (path === "/compare/demo") page = <ComparePage navigate={navigate} />;
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
