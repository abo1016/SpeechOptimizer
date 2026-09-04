import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { AppProvider } from "./state/AppProvider.jsx";
import "./styles.css";

// 全局 Provider 在首屏建立匿名或账户会话，所有受保护页面共用同一份状态。
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
