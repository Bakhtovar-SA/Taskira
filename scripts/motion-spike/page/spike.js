// ADR-0035 — проверки библиотеки motion в браузере под production CSP (заголовок ставит csp-spike/server.mjs).
// Метод тот же, что у csp-spike (ADR-0010): каждая проверка — применился ли эффект (по getComputedStyle /
// геометрии, покадрово) и какие securitypolicyviolation пришли, пока она шла. Итог — window.__spike.
// ?reduced=1 — второй проход: run.mjs эмулирует prefers-reduced-motion: reduce и запускает только группу (d).

const violations = window.__violations;
const parseTime = violations.slice();
const reducedPass = new URLSearchParams(location.search).has("reduced");

const stage = document.getElementById("stage");
const results = [];
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cs = (node) => getComputedStyle(node);

function el(tag, className = "", parent = stage) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}
function totalRules() {
  let n = 0;
  for (const s of document.styleSheets) {
    try {
      n += s.cssRules.length;
    } catch {
      /* чужой лист */
    }
  }
  return n;
}
const styleElements = () => document.querySelectorAll("style").length;

/** Покадровая выборка fn() в течение ms. */
async function frames(fn, ms) {
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    out.push(fn());
    await raf();
  }
  out.push(fn());
  return out;
}
const num = (v) => parseFloat(v);
const tx = (node) => new DOMMatrixReadOnly(cs(node).transform === "none" ? undefined : cs(node).transform).m41;
const ty = (node) => new DOMMatrixReadOnly(cs(node).transform === "none" ? undefined : cs(node).transform).m42;
/** Были ли промежуточные значения строго между a и b и пришли ли к b. */
function tweened(samples, a, b, eps = 0.5) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const mid = samples.filter((v) => v > lo + eps && v < hi - eps).length;
  const end = Math.abs(samples[samples.length - 1] - b) <= eps;
  return { mid, end, max: Math.max(...samples), min: Math.min(...samples) };
}
const fmt = (n) => Math.round(n * 100) / 100;

async function check(id, label, fn, { parseTimeViolations = false } = {}) {
  stage.replaceChildren();
  const before = violations.length;
  const rulesBefore = totalRules();
  const stylesBefore = styleElements();
  let out;
  try {
    out = await fn();
  } catch (err) {
    out = { works: false, observed: `exception: ${err && err.message ? err.message : err}` };
  }
  await wait(40);
  const seen = violations.slice(before);
  results.push({
    id,
    label,
    works: out.works === null ? null : !!out.works,
    observed: out.observed,
    rulesDelta: totalRules() - rulesBefore,
    styleElementsDelta: styleElements() - stylesBefore,
    violations: parseTimeViolations ? [...parseTime, ...seen] : seen,
  });
}

const mini = await import("/vendor/mini/mini.js");
const hybrid = await import("/vendor/hybrid/hybrid.js");
const react = await import("/vendor/react/react-probe.js");
const wrapper = await import("/vendor/wrapper/motion-wrapper.js");

// ── Контроли: CSP действует (обязаны НЕ сработать) ─────────────────────────────────────
await check("ctl-markup", 'Контроль: style="" в HTML-разметке', () => {
  const c = cs(document.getElementById("ctl-markup")).color;
  return { works: c === "rgb(255, 0, 0)", observed: `color=${c}` };
}, { parseTimeViolations: true });
await check("ctl-style-element", "Контроль: вставка <style> с текстом", () => {
  const s = document.createElement("style");
  s.textContent = ".ctl-style-el { color: rgb(255, 0, 0); }";
  document.head.appendChild(s);
  const n = el("div", "ctl-style-el");
  const c = cs(n).color;
  s.remove();
  return { works: c === "rgb(255, 0, 0)", observed: `color=${c}` };
});

if (!reducedPass) {
  // ── (a) vanilla animate(): mini (только WAAPI) ───────────────────────────────────────
  await check("a-mini-opacity", "(a) motion/mini animate: opacity 0→1", async () => {
    const n = el("div", "box");
    mini.animate(n, { opacity: [0, 1] }, { duration: 0.2 });
    const r = tweened(await frames(() => num(cs(n).opacity), 300), 0, 1, 0.01);
    return { works: r.mid > 0 && r.end, observed: `промежуточных кадров=${r.mid}, итог=${cs(n).opacity}` };
  });
  await check("a-mini-transform", "(a) motion/mini animate: transform translateX 0→100px", async () => {
    const n = el("div", "box");
    mini.animate(n, { transform: ["translateX(0px)", "translateX(100px)"] }, { duration: 0.2 });
    const r = tweened(await frames(() => tx(n), 300), 0, 100);
    return { works: r.mid > 0 && r.end, observed: `промежуточных кадров=${r.mid}, итог x=${fmt(tx(n))}` };
  });
  await check("a-mini-var", "(a) motion/mini animate: CSS-переменная --reg (@property в статическом CSS)", async () => {
    const n = el("div", "bar-reg");
    mini.animate(n, { "--reg": [0, 100] }, { duration: 0.2 });
    const r = tweened(await frames(() => num(cs(n).width), 300), 0, 100);
    return { works: r.mid > 0 && r.end, observed: `промежуточных кадров=${r.mid}, width=${cs(n).width}` };
  });
  await check("a-mini-spring", "(a) motion/mini animate + spring → WAAPI easing linear(…)", async () => {
    const n = el("div", "box");
    mini.animate(n, { transform: ["translateX(0px)", "translateX(100px)"] }, { type: mini.spring, visualDuration: 0.3, bounce: 0.4 });
    await raf();
    const anim = n.getAnimations()[0];
    const t = anim?.effect?.getTiming();
    const easing = String(t?.easing ?? "");
    const r = tweened(await frames(() => tx(n), 900), 0, 100);
    return {
      works: /^linear\(/.test(easing) && r.max > 100.5 && r.end,
      observed: `easing=${easing.slice(0, 28)}…, duration=${fmt(Number(t?.duration))} мс, перелёт max x=${fmt(r.max)}, итог=${fmt(tx(n))}`,
    };
  });

  // ── (a) vanilla animate(): hybrid ────────────────────────────────────────────────────
  await check("a-hybrid-opacity", "(a) motion animate (hybrid): opacity", async () => {
    const n = el("div", "box");
    hybrid.animate(n, { opacity: [0, 1] }, { duration: 0.2 });
    const r = tweened(await frames(() => num(cs(n).opacity), 300), 0, 1, 0.01);
    return { works: r.mid > 0 && r.end, observed: `промежуточных кадров=${r.mid}, итог=${cs(n).opacity}` };
  });
  await check("a-hybrid-x-spring", "(a) motion animate (hybrid): независимый x + spring (main thread → element.style)", async () => {
    const n = el("div", "box");
    hybrid.animate(n, { x: [0, 100] }, { type: "spring", visualDuration: 0.3, bounce: 0.4 });
    const r = tweened(await frames(() => tx(n), 900), 0, 100);
    return { works: r.mid > 0 && r.max > 100.5 && r.end, observed: `кадров в пути=${r.mid}, перелёт max x=${fmt(r.max)}, итог=${fmt(tx(n))}, inline transform=«${n.style.transform}»` };
  });
  await check("a-hybrid-var-plain", "(a) motion animate (hybrid): незарегистрированная CSS-переменная --plain", async () => {
    const n = el("div", "bar-plain");
    hybrid.animate(n, { "--plain": [0, 100] }, { duration: 0.2 });
    const r = tweened(await frames(() => num(cs(n).width), 300), 0, 100);
    return { works: r.mid > 0 && r.end, observed: `промежуточных кадров=${r.mid}, width=${cs(n).width}` };
  });
  await check("a-hybrid-stagger", "(a) motion animate (hybrid): появление 5 строк со stagger", async () => {
    const list = el("ul", "list");
    const items = Array.from({ length: 5 }, () => el("li", "", list));
    hybrid.animate(items, { opacity: [0, 1], y: [8, 0] }, { delay: hybrid.stagger(0.03), duration: 0.2 });
    await wait(60);
    const ops = items.map((i) => fmt(num(cs(i).opacity)));
    const staggered = ops[0] > ops[4];
    await wait(400);
    const end = items.every((i) => cs(i).opacity === "1" && Math.abs(ty(i)) < 0.5);
    return { works: staggered && end, observed: `через 60 мс opacity=[${ops.join(", ")}], итог ok=${end}` };
  });
  await check("a-hybrid-counter", "(a) motion animate (hybrid): счётчик 0→100 через onUpdate (textContent, без стилей)", async () => {
    const n = el("span");
    const seen = new Set();
    hybrid.animate(0, 100, { duration: 0.3, onUpdate: (v) => { n.textContent = String(Math.round(v)); seen.add(n.textContent); } });
    await wait(450);
    return { works: seen.size > 3 && n.textContent === "100", observed: `разных значений=${seen.size}, итог=${n.textContent}` };
  });
  await check("e-animate-view", "(e) motion animateView (View Transitions helper)", async () => {
    const n = el("div", "box");
    const v0 = violations.length;
    const builder = hybrid.animateView(() => { n.classList.toggle("moved"); }).add(n);
    const res = await Promise.race([Promise.resolve(builder.then ? builder : builder.readyPromise).then(() => "resolved", (e) => `rejected: ${e?.message ?? e}`), wait(1500).then(() => "timeout")]);
    await wait(700);
    const blocked = violations.length - v0;
    return { works: res === "resolved" && blocked === 0, observed: `переход завершился (${res}), но заблокировано ${blocked} вставок <style id="motion-view"> — правила псевдоэлементов (тайминг, обрезка) не применены` };
  });

  // ── (b) React: motion/react ──────────────────────────────────────────────────────────
  await check("b-lazy-m", "(b) <m.div> + LazyMotion(domAnimation): initial→animate opacity/y, spring", async () => {
    const host = el("div");
    const root = react.mountLazyM(host);
    const n = host.firstChild;
    const r = tweened(await frames(() => ty(n), 800), 16, 0);
    const out = { works: r.mid > 0 && r.end && cs(n).opacity === "1", observed: `кадров в пути=${r.mid}, итог y=${fmt(ty(n))}, opacity=${cs(n).opacity}, атрибут style в DOM=«${n.getAttribute("style")}»` };
    root.unmount();
    return out;
  });
  await check("b-motion-var", "(b) <motion.div> animate по CSS-переменной --plain", async () => {
    const host = el("div");
    const root = react.mountMotionVars(host);
    const n = host.firstChild;
    const r = tweened(await frames(() => num(cs(n).width), 450), 0, 100);
    root.unmount();
    return { works: r.mid > 0 && r.end, observed: `промежуточных кадров=${r.mid}, итог width=${fmt(r.max)}` };
  });
  await check("b-style-motionvalue", "(b) <motion.div style={{ x: motionValue }}> из НАШЕГО JSX (secure-jsx перехватывает style)", async () => {
    const host = el("div");
    const root = react.mountMotionValueStyle(host);
    await frames(() => 0, 50);
    const n = host.firstChild;
    const out = { works: Math.abs(tx(n) - 50) < 0.5, observed: `x=${fmt(tx(n))} (ожидалось 50), class=«${n.className}», атрибут style=«${n.getAttribute("style")}»` };
    root.unmount();
    return out;
  });
  await check("b-style-static", "(b) <motion.div style={{ opacity: 0.5 }} animate={{ x }}> из нашего JSX", async () => {
    const host = el("div");
    const root = react.mountStaticStyle(host);
    await wait(350);
    const n = host.firstChild;
    const out = { works: cs(n).opacity === "0.5" && Math.abs(tx(n) - 20) < 0.5, observed: `opacity=${cs(n).opacity}, x=${fmt(tx(n))}, class=«${n.className}»` };
    root.unmount();
    return out;
  });
  for (const mode of ["sync", "wait", "popLayout"]) {
    await check(`b-presence-${mode}`, `(b) <AnimatePresence mode="${mode}">: exit-анимация и удаление`, async () => {
      const host = el("div");
      const api = react.mountPresence(host, mode);
      await wait(320);
      const n = host.querySelector(".presence-item");
      api.hide();
      const xs = await frames(() => (n.isConnected ? tx(n) : -1), 450);
      const r = tweened(xs.filter((v) => v >= 0), 0, 40);
      const removed = !n.isConnected;
      api.root.unmount();
      return { works: r.mid > 0 && removed, observed: `кадров exit=${r.mid}, удалён=${removed}` };
    });
  }
  await check("c-layout-reorder", "(c) <motion.li layout>: перестановка строк (FLIP силами motion)", async () => {
    const host = el("div");
    const api = react.mountLayoutList(host, ["a", "b", "c", "d"]);
    const li = () => host.querySelector('[data-key="a"]');
    const top0 = li().getBoundingClientRect().top;
    api.reorder(["b", "c", "d", "a"]);
    const tops = await frames(() => li().getBoundingClientRect().top - top0, 900);
    const r = tweened(tops, 0, 60);
    api.root.unmount();
    return { works: r.mid > 0 && r.end, observed: `видимое смещение «a»: кадров в пути=${r.mid}, итог=${fmt(tops[tops.length - 1])}px (ожидалось 60)` };
  });
  await check("c-layout-id-tab", "(c) layoutId: индикатор активной вкладки перелетает", async () => {
    const host = el("div");
    const api = react.mountTabs(host);
    const ind = () => host.querySelector(".tab-indicator");
    await wait(100);
    const x0 = ind().getBoundingClientRect().left;
    api.select(2);
    const xs = await frames(() => ind().getBoundingClientRect().left - x0, 900);
    const r = tweened(xs, 0, 200);
    api.root.unmount();
    return { works: r.mid > 0 && r.end, observed: `кадров в пути=${r.mid}, итог=${fmt(xs[xs.length - 1])}px (ожидалось 200)` };
  });

  // ── (c) свой FLIP поверх mini (прототип src/motion) ─────────────────────────────────
  await wrapper.preloadMotion();
  await check("c-wrapper-flip", "(c) прототип flipSnapshot(): перестановка строк, mini animate + spring", async () => {
    const list = el("ul", "list");
    const items = ["a", "b", "c", "d"].map((k) => {
      const li = el("li", "", list);
      li.dataset.flip = k;
      li.textContent = k;
      return li;
    });
    const top0 = items[0].getBoundingClientRect().top;
    const play = wrapper.flipSnapshot(list);
    list.append(items[0]); // «a» в конец
    const anims = play();
    const tops = await frames(() => items[0].getBoundingClientRect().top - top0, 900);
    const r = tweened(tops, 0, 60);
    return { works: anims.length === 4 && r.mid > 0 && r.end, observed: `анимаций=${anims.length}, кадров в пути=${r.mid}, итог=${fmt(tops[tops.length - 1])}px` };
  });
  await check("c-wrapper-enter-exit", "(c) прототип enter()/exit()", async () => {
    const n = el("div", "box");
    wrapper.enter(n);
    const a = tweened(await frames(() => num(cs(n).opacity), 600), 0, 1, 0.01);
    await wrapper.exit(n);
    const gone = cs(n).opacity;
    return { works: a.mid > 0 && a.end, observed: `enter: кадров=${a.mid}; exit resolved, opacity после=${gone} (fill не держится — вызывающий удаляет узел)` };
  });
}

// ── (d) prefers-reduced-motion ───────────────────────────────────────────────────────
const mq = matchMedia("(prefers-reduced-motion: reduce)").matches;
await check("d-media", "(d) matchMedia('(prefers-reduced-motion: reduce)')", () => ({ works: null, observed: `matches=${mq}` }));
await check("d-mini-raw", "(d) motion/mini animate без защиты — уважает ли reduce сам", async () => {
  const n = el("div", "box");
  mini.animate(n, { transform: ["translateX(0px)", "translateX(100px)"] }, { duration: 0.3 });
  const r = tweened(await frames(() => tx(n), 400), 0, 100);
  return { works: null, observed: `кадров в пути=${r.mid} → ${r.mid > 0 ? "анимирует (reduce не учитывает)" : "мгновенно"}` };
});
await check("d-hybrid-raw", "(d) motion animate (hybrid) без защиты", async () => {
  const n = el("div", "box");
  hybrid.animate(n, { x: [0, 100] }, { duration: 0.3 });
  const r = tweened(await frames(() => tx(n), 400), 0, 100);
  return { works: null, observed: `кадров в пути=${r.mid} → ${r.mid > 0 ? "анимирует (reduce не учитывает)" : "мгновенно"}` };
});
await check("d-global-skip", "(d) MotionGlobalConfig.skipAnimations = true (глобальный выключатель)", async () => {
  hybrid.MotionGlobalConfig.skipAnimations = true;
  const n = el("div", "box");
  hybrid.animate(n, { x: [0, 100] }, { duration: 0.3 });
  const r = tweened(await frames(() => tx(n), 200), 0, 100);
  hybrid.MotionGlobalConfig.skipAnimations = false;
  return { works: r.mid === 0 && r.end, observed: `кадров в пути=${r.mid}, итог=${fmt(tx(n))}` };
});
for (const mode of ["user", "always"]) {
  await check(`d-config-${mode}`, `(d) <MotionConfig reducedMotion="${mode}">: x и opacity`, async () => {
    const host = el("div");
    const root = react.mountReducedConfig(host, mode);
    const n = host.firstChild;
    const xs = await frames(() => tx(n), 450);
    const rx = tweened(xs, 0, 100);
    const out = { works: null, observed: `x: кадров в пути=${rx.mid} (${rx.mid ? "анимирует" : "мгновенно"}), итог x=${fmt(tx(n))}, opacity=${cs(n).opacity}` };
    root.unmount();
    return out;
  });
}
await wrapper.preloadMotion();
await check("d-wrapper", "(d) прототип: enter()/flip под reduce или setReducedMotion(true)", async () => {
  if (!mq) wrapper.setReducedMotion(true);
  const n = el("div", "box");
  const a = wrapper.enter(n);
  const done = await Promise.race([wrapper.exit(n).then(() => "resolved"), wait(50).then(() => "pending")]);
  wrapper.setReducedMotion(false);
  return { works: a === null && done === "resolved", observed: `enter вернул ${a === null ? "null (мгновенно)" : "анимацию"}, exit=${done}${mq ? " (системный reduce)" : " (выключатель)"}` };
});

window.__spike = { userAgent: navigator.userAgent, reducedPass, results, violationsTotal: violations.length };
document.body.dataset.done = "1";
