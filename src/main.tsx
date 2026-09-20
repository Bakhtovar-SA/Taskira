import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, watchSystemTheme } from "./theme";
import { I18nProvider } from "./i18n";

// Внешний theme-init.js ставит data-theme до загрузки CSS без нарушения CSP;
// здесь применяем ещё и пресет фона --c-canvas, затем следим за системой.
applyTheme();
watchSystemTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
