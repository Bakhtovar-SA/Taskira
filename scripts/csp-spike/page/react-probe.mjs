// Проба: обычный React 19 `style` prop БЕЗ src/secure-jsx — применяет ли его браузер под
// production CSP. run.mjs собирает этот файл esbuild'ом (react/react-dom из node_modules
// репозитория, production-сборка React) и отдаёт как /vendor/react-probe.mjs.
import { createElement, version } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

export const reactVersion = version;

/** Монтирует <div style={first}>, затем перерисовывает с `second`; `measure(node)` — после каждого шага. */
export function renderStyled(container, first, second, measure) {
  const root = createRoot(container);
  const out = [];
  flushSync(() => root.render(createElement("div", { className: "bar", style: first })));
  out.push(measure(container.firstChild));
  flushSync(() => root.render(createElement("div", { className: "bar", style: second })));
  out.push(measure(container.firstChild));
  root.unmount();
  return out;
}
