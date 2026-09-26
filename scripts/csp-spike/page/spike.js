// ТЗ 5.2, ADR-0010 — проверки в браузере под production CSP (заголовок ставит server.mjs).
// Каждая проверка: применился ли эффект (по getComputedStyle / геометрии) и какие
// securitypolicyviolation пришли, пока она шла. Итог — window.__spike, флаг готовности —
// document.body.dataset.done.

// Подписка на securitypolicyviolation — в early.js (до разбора <body>).
const violations = window.__violations;
/** Нарушения, случившиеся при разборе разметки, — до первой проверки (контроль ctl-markup). */
const parseTime = violations.slice();

const stage = document.getElementById("stage");
const results = [];
const settle = () => new Promise((r) => setTimeout(r, 40));

function el(tag, className = "", parent = stage) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}
const cs = (node) => getComputedStyle(node);
/** Сравнение пикселей с допуском: 99.9% от 200px Chromium отдаёт как 199.797px. */
const px = (value, expected) => Math.abs(parseFloat(value) - expected) < 0.5;

/** Сколько CSS-правил сейчас в документе (включая adoptedStyleSheets). */
function totalRules() {
  let n = 0;
  for (const s of document.styleSheets) n += s.cssRules.length;
  for (const s of document.adoptedStyleSheets) n += s.cssRules.length;
  return n;
}

/** fn возвращает { works, observed }; rulesDelta считается здесь — рост числа CSS-правил за проверку. */
async function check(id, label, fn, { parseTimeViolations = false } = {}) {
  const before = violations.length;
  const rulesBefore = totalRules();
  let out;
  try {
    out = await fn();
  } catch (err) {
    out = { works: false, observed: `exception: ${err && err.message ? err.message : err}` };
  }
  await settle();
  await settle();
  const seen = violations.slice(before);
  results.push({
    id,
    label,
    works: !!out.works,
    observed: out.observed,
    rulesDelta: totalRules() - rulesBefore,
    violations: parseTimeViolations ? [...parseTime, ...seen] : seen,
  });
}

function track() {
  const t = el("div", "track");
  return el("div", "bar", t);
}

// ── Контроли: CSP действительно действует (эти три обязаны НЕ сработать) ─────────────
await check("ctl-markup", 'Контроль: style="" в HTML-разметке', () => {
  const c = cs(document.getElementById("ctl-markup")).color;
  return { works: c === "rgb(255, 0, 0)", observed: `color=${c}` };
}, { parseTimeViolations: true });
await check("ctl-setattribute", "Контроль: element.setAttribute('style', …)", () => {
  const n = el("div");
  n.setAttribute("style", "color: rgb(255, 0, 0)");
  const c = cs(n).color;
  return { works: c === "rgb(255, 0, 0)", observed: `color=${c}` };
});
await check("ctl-style-element", "Контроль: вставка <style> с текстом", () => {
  const s = document.createElement("style");
  s.textContent = ".ctl-style-el { color: rgb(255, 0, 0); }";
  document.head.appendChild(s);
  const n = el("div", "ctl-style-el");
  const c = cs(n).color;
  return { works: c === "rgb(255, 0, 0)", observed: `color=${c}` };
});

// ── CSSOM: прямые свойства ─────────────────────────────────────────────────────────
await check("cssom-property", "CSSOM: element.style.width = '84px'", () => {
  const n = el("div");
  n.style.width = "84px";
  const w = cs(n).width;
  return { works: w === "84px", observed: `width=${w}` };
});
await check("cssom-csstext", "CSSOM: element.style.cssText = 'width: 84px'", () => {
  const n = el("div");
  n.style.cssText = "width: 84px";
  const w = cs(n).width;
  return { works: w === "84px", observed: `width=${w}` };
});

// ── (a) Кастомные свойства через CSSOM ─────────────────────────────────────────────
await check("a-custom-property", "(a) element.style.setProperty('--p', '42') → .bar{width:calc(var(--p)*1%)}", () => {
  const bar = track();
  bar.style.setProperty("--p", "42");
  const w = cs(bar).width;
  return { works: w === "84px", observed: `width=${w} (ожидалось 84px = 42% от 200px)` };
});
await check("a-custom-property-root", "(a) document.documentElement.style.setProperty('--tone', …) — тема/фон проекта", () => {
  const bar = track();
  bar.style.setProperty("--p", "10");
  document.documentElement.style.setProperty("--tone", "rgb(1, 2, 3)");
  const bg = cs(bar).backgroundColor;
  document.documentElement.style.removeProperty("--tone");
  return { works: bg === "rgb(1, 2, 3)", observed: `background=${bg}` };
});
await check("a-scale-1000", "(a) 1000 разных значений --p на 1000 элементах: рост числа CSS-правил", () => {
  const before = totalRules();
  const bars = [];
  for (let i = 0; i < 1000; i++) {
    const bar = track();
    bar.style.setProperty("--p", String(i / 10));
    bars.push(bar);
  }
  const after = totalRules();
  const w = cs(bars[555]).width; // 55.5% от 200px = 111px
  return { works: px(w, 111), observed: `правил в документе ${before}→${after}; bars[555].width=${w}` };
});

// ── (b) Web Animations API ─────────────────────────────────────────────────────────
await check("b-waapi", "(b) element.animate([{transform}], …) — середина анимации", () => {
  const n = el("div", "anim");
  const a = n.animate([{ transform: "translateX(0px)" }, { transform: "translateX(100px)" }], { duration: 1000, fill: "both" });
  a.pause();
  a.currentTime = 500;
  const t = cs(n).transform;
  return { works: t === "matrix(1, 0, 0, 1, 50, 0)", observed: `transform=${t}` };
});
await check("b-waapi-registered-property", "(b) element.animate по кастомному свойству --angle (@property в статическом CSS)", () => {
  const n = el("div", "spin");
  const a = n.animate([{ "--angle": "0deg" }, { "--angle": "90deg" }], { duration: 1000, fill: "both" });
  a.pause();
  a.currentTime = 500;
  const v = cs(n).getPropertyValue("--angle").trim();
  return { works: v === "45deg", observed: `--angle=${v}; transform=${cs(n).transform}` };
});
await check("b-waapi-commit-styles", "(b) animation.commitStyles() — запись итогового значения обратно в element.style", () => {
  const n = el("div", "anim");
  const a = n.animate([{ opacity: 1 }, { opacity: 0.25 }], { duration: 10, fill: "forwards" });
  a.finish();
  a.commitStyles();
  a.cancel();
  const o = cs(n).opacity;
  return { works: o === "0.25", observed: `opacity=${o} после cancel(); inline=${n.style.opacity || "∅"}` };
});

// ── (c) adoptedStyleSheets ─────────────────────────────────────────────────────────
await check("c-adopted", "(c) new CSSStyleSheet() + replaceSync + document.adoptedStyleSheets", () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(".adopted-a { color: rgb(0, 128, 0); }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const n = el("div", "adopted-a");
  const c = cs(n).color;
  return { works: c === "rgb(0, 128, 0)", observed: `color=${c}` };
});
await check("c-adopted-replace-async", "(c) CSSStyleSheet.replace() (async)", async () => {
  const sheet = new CSSStyleSheet();
  await sheet.replace(".adopted-b { color: rgb(0, 0, 128); }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const n = el("div", "adopted-b");
  const c = cs(n).color;
  return { works: c === "rgb(0, 0, 128)", observed: `color=${c}` };
});
await check("c-adopted-scale-1000", "(c) правило на значение в сконструированном листе: рост числа правил", () => {
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const before = totalRules();
  let last;
  for (let i = 0; i < 1000; i++) {
    sheet.insertRule(`.adp-${i} { width: ${i / 10}%; }`, sheet.cssRules.length);
    last = el("div", `adp-${i}`, el("div", "track"));
  }
  const after = totalRules();
  return { works: px(cs(last).width, 199.8), observed: `правил в документе ${before}→${after}; last.width=${cs(last).width}` };
});

// ── (d) data-* + конечный набор классов ────────────────────────────────────────────
await check("d-data-steps", "(d) data-progress + конечный набор правил (ступени)", () => {
  const t = el("div", "track");
  const bar = el("div", "bar-step", t);
  bar.dataset.progress = "35";
  const w1 = cs(bar).width;
  bar.dataset.progress = "40";
  const w2 = cs(bar).width;
  return { works: w1 === "70px" && w2 === "80px", observed: `35→${w1}, 40→${w2}` };
});
await check("d-data-tone", "(d) data-tone='danger' — перечислимое значение", () => {
  const n = el("div", "tone");
  n.dataset.tone = "danger";
  const c = cs(n).color;
  return { works: c === "rgb(200, 30, 30)", observed: `color=${c}` };
});
await check("d-attr-typed", "(d') width: attr(data-w type(<percentage>)) — значение из data-атрибута без JS-стилей", () => {
  const t = el("div", "track");
  const bar = el("div", "bar-attr", t);
  bar.dataset.w = "42%";
  const w = cs(bar).width;
  return { works: w === "84px", observed: `width=${w}` };
});

// ── Текущий механизм продукта: insertRule в same-origin лист (dynamicStyle.ts) ───────
await check("e-insertrule-1000", "Текущий: insertRule('.taskira-dyn-N{…}') в /dynamic.css — 1000 разных значений", () => {
  const sheet = document.getElementById("taskira-dynamic-styles").sheet;
  const before = totalRules();
  let last;
  for (let i = 0; i < 1000; i++) {
    sheet.insertRule(`.taskira-dyn-${i}{width:${i / 10}%}`, sheet.cssRules.length);
    last = el("div", `taskira-dyn-${i}`, el("div", "track"));
  }
  const after = totalRules();
  return { works: px(cs(last).width, 199.8), observed: `правил в документе ${before}→${after}; last.width=${cs(last).width}` };
});

// ── Обычный React 19 `style` prop без secure-jsx (React пишет стили через CSSOM) ─────────
let react = null;
try {
  react = await import("/vendor/react-probe.mjs");
} catch {
  react = null;
}
if (react) {
  await check("g-react-style-prop", `React ${react.reactVersion}: <div style={{ width: 84, "--tone": … }}> без secure-jsx — монтирование и обновление`, () => {
    const host = el("div", "track");
    const [a, b] = react.renderStyled(
      host,
      { width: 84, "--tone": "rgb(4, 5, 6)" },
      { width: 120, "--tone": "rgb(7, 8, 9)" },
      (n) => ({ w: cs(n).width, bg: cs(n).backgroundColor, attr: n.getAttribute("style") }),
    );
    return {
      works: a.w === "84px" && a.bg === "rgb(4, 5, 6)" && b.w === "120px" && b.bg === "rgb(7, 8, 9)",
      observed: `mount: width=${a.w}, bg=${a.bg}; update: width=${b.w}, bg=${b.bg}; атрибут style в DOM: «${b.attr}»`,
    };
  });
} else {
  results.push({ id: "g-react-style-prop", label: "React style prop", works: null, observed: "skipped: нет esbuild", violations: [] });
}

// ── floating-ui ────────────────────────────────────────────────────────────────────
let fu = null;
let fuVersion = null;
try {
  fu = await import("/vendor/floating-ui-dom.mjs");
  fuVersion = (await (await fetch("/vendor/version.json")).json()).version;
} catch {
  fu = null;
}
if (fu) {
  const { computePosition, offset, flip, shift, autoUpdate } = fu;
  const place = async (strategy, useTransform) => {
    const ref = el("button", "ref");
    ref.textContent = "ref";
    const floating = el("div", "floating");
    if (strategy === "fixed") floating.style.position = "fixed";
    const { x, y } = await computePosition(ref, floating, { strategy, placement: "bottom", middleware: [offset(8), flip(), shift({ padding: 8 })] });
    if (useTransform) Object.assign(floating.style, { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` });
    else Object.assign(floating.style, { left: `${x}px`, top: `${y}px` });
    const r = ref.getBoundingClientRect();
    const f = floating.getBoundingClientRect();
    const gap = Math.round(f.top - r.bottom);
    const centered = Math.abs(f.left + f.width / 2 - (r.left + r.width / 2)) < 1;
    ref.remove();
    floating.remove();
    return { works: gap === 8 && centered, observed: `x=${x}, y=${y}; зазор=${gap}px, по центру=${centered}` };
  };
  await check("f-floating-left-top", `floating-ui ${fuVersion}: computePosition → style.left/top (absolute)`, () => place("absolute", false));
  await check("f-floating-transform", `floating-ui ${fuVersion}: computePosition → style.transform`, () => place("absolute", true));
  await check("f-floating-fixed", `floating-ui ${fuVersion}: strategy 'fixed' (position через CSSOM)`, () => place("fixed", false));
  await check("f-floating-autoupdate", `floating-ui ${fuVersion}: autoUpdate (ResizeObserver/scroll) + перерасчёт`, async () => {
    const ref = el("button", "ref");
    const floating = el("div", "floating");
    let calls = 0;
    const stop = autoUpdate(
      ref,
      floating,
      async () => {
        calls++;
        const { x, y } = await computePosition(ref, floating, { middleware: [offset(4)] });
        Object.assign(floating.style, { left: `${x}px`, top: `${y}px` });
      },
      { animationFrame: true },
    );
    await settle();
    ref.style.top = "160px"; // сдвиг опорного элемента — autoUpdate обязан пересчитать позицию сам
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    await settle();
    stop();
    const top = Math.round(floating.getBoundingClientRect().top - ref.getBoundingClientRect().bottom);
    ref.remove();
    floating.remove();
    return { works: calls >= 1 && top === 4, observed: `вызовов=${calls}, зазор=${top}px` };
  });
} else {
  results.push({ id: "f-floating", label: "floating-ui", works: null, observed: "skipped: FLOATING_UI_NODE_MODULES не задан", violations: [] });
}

window.__spike = { userAgent: navigator.userAgent, floatingUi: fuVersion, results, violationsTotal: violations.length };
document.body.dataset.done = "1";
