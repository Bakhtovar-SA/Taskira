import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, watchSystemTheme } from "./theme";
import { I18nProvider, loadLang, storedLang } from "./i18n";
import { dismissSplash } from "./splash";

// Внешний theme-init.js ставит data-theme до загрузки CSS без нарушения CSP;
// здесь применяем ещё и пресет фона --c-canvas, затем следим за системой.
applyTheme();
watchSystemTheme();

const root = ReactDOM.createRoot(document.getElementById("root")!);

// /dev/ui — витрина компонентов (ТЗ 5.7). Под import.meta.env.DEV: в продовой сборке условие — константа
// false, ветка и динамический импорт вырезаются, чанка DevUI в dist нет (проверяет scripts/check-bundle-size.mjs).
if (import.meta.env.DEV && location.pathname.replace(/\/$/, "") === "/dev/ui") {
  void import("./dev/DevUI").then(({ default: DevUI }) => {
    root.render(<DevUI />);
    dismissSplash();
  });
} else {
  // Выбран английский — дождаться его словаря (отдельный чанк), чтобы первый кадр был уже на нём.
  void loadLang(storedLang()).finally(() => {
    root.render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    requestAnimationFrame(dismissSplash);
  });
}
