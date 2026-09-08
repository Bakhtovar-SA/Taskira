import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, watchSystemTheme } from "./theme";

// Тему ставим до первого рендера (data-theme из index.html уже применён без
// мигания; здесь ещё и пресет фона --c-canvas), затем следим за системной темой.
applyTheme();
watchSystemTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
