import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const t0 = performance.now();
console.log("[init] main.tsx: 엔트리 로드", new Date().toISOString());

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
console.log("[init] React 마운트 완료, 경과(ms):", (performance.now() - t0).toFixed(0));
