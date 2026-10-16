#!/usr/bin/env node
// ADR-0015 / ADR-0035: motion tokens, reduced motion, and one JS engine boundary.
// node scripts/check-motion.mjs [--self-test]
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Supported CJS export avoids loading hundreds of ESM files on Windows.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const { spring } = require("motion");
import { walk, splitCss, propertyName, exported, unwrap, animateCall, readMotionCss, motionConstants, motionRegistry } from "./motion-lib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKENS_MS = [100, 150, 200, 300, 450];
const MAX_MS = 450;
const SPRING_VISUAL_MS = [100, 150, 200, 250, 300];
const ALLOW_LOOPS = new Set(["dsSpin", "dsIndet", "dsShimmer", "shimmer", "wfFlow"]);
const ALLOW_TIMERS = new Set(["dsToastBar"]);
/** View Transition pseudo-element cannot be targeted by the element motion wrapper. */
const ALLOW_RAW_ANIMATE = { "src/theme.ts": "theme circle targets ::view-transition-new(root)" };
/** These functions configure/query/stop motion or load its engine without starting movement. */
const ALLOW_DYNAMIC_DELAY = { "src/motion.ts:flipFrom": "bulk wave delay; clamped to 100 ms with SPRING_ENTER or 150 ms with the 300 ms fallback" };
const NON_ANIMATING = {
  setReducedMotion: "persists preference; existing motion is allowed to finish",
  userReducedMotion: "reads personal preference",
  motionReduced: "combines system and personal preferences",
  reducedMotion: "reads system preference",
  cssZoom: "measures effective zoom",
  stopMotion: "stops existing movement",
  __resetMotionForTests: "resets state in tests",
  preloadMotion: "loads engine only",
};
const MOVING_PROPERTY = /^(?:all|transform|translate|scale|rotate|left|top|right|bottom|width|height|min-width|max-width|min-height|max-height|margin[\w-]*|background-position|stroke-dashoffset|clip-path|inset)$/;
const MOVING = /\b(transform|translate|scale|rotate|left|top|right|bottom|width|height|min-width|max-width|min-height|max-height|margin[\w-]*|background-position|stroke-dashoffset|clip-path|inset)\s*:/;

const milliseconds = (value) => {
  const token = /^var\(--dur-([1-5])(?:,.*)?\)$/.exec(value);
  if (token) return TOKENS_MS[Number(token[1]) - 1];
  const literal = /^(-?\d*\.?\d+)(ms|s)$/.exec(value);
  if (literal) return Number(literal[1]) * (literal[2] === "s" ? 1000 : 1);
  if (value === "0") return 0;
};

export function checkMotion(root) {
  const errors = [];
  const fail = (code, where, message) => errors.push({ code, text: `${where}: ${message}` });
  const { rules, keyframes } = readMotionCss(root);
  const declarations = (body) => Object.fromEntries(body.split(";").map((part) => {
    const colon = part.indexOf(":");
    return colon < 0 ? [] : [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  }).filter((part) => part.length));
  const disables = (rule, kind) => {
    const decls = declarations(rule.body);
    const value = decls[kind];
    if (value && (value === "none" || (kind === "transition" && splitCss(value).every((part) => !MOVING_PROPERTY.test(splitCss(part, " ")[0]))))) return true;
    if (kind === "animation" && value && splitCss(value).every((part) => !splitCss(part, " ").some((name) => MOVING.test(keyframes.get(name) ?? "")))) return true;
    const duration = decls[`${kind}-duration`];
    return duration !== undefined && splitCss(duration).every((part) => { const ms = milliseconds(part.replace(/\s*!important$/, "")); return ms !== undefined && ms <= 1; });
  };
  const personalSelector = /html\[data-motion=["']?reduce["']?\]/;
  const coverRules = Object.fromEntries(["animation", "transition"].map((kind) => [kind, rules.filter((rule) => (rule.reduced || rule.selectors.some((candidate) => personalSelector.test(candidate))) && disables(rule, kind))]));
  const covers = (selector, kind) => coverRules[kind].some((rule) => {
    return rule.selectors.some((candidate) => {
      const normalized = candidate.replace(personalSelector, "").trim();
      const excluded = /^:not\((.*?)\)(::before|::after)?$/.exec(normalized);
      if (excluded && selector !== "*" && !splitCss(excluded[1]).some((item) => selector.includes(item.split(/\s/)[0])) && (!excluded[2] || selector.endsWith(excluded[2]))) return true;
      return normalized === selector || (rule.reduced || personalSelector.test(candidate)) && (normalized === "*" || normalized === "*::before" && selector.endsWith("::before") || normalized === "*::after" && selector.endsWith("::after"));
    });
  });
  const universalTransitionReduce = covers("*", "transition");
  for (const rule of rules) {
    if (rule.reduced || rule.selectors.some((selector) => personalSelector.test(selector))) continue;
    const decls = declarations(rule.body);
    for (const [property, raw] of Object.entries(decls)) {
      if (!/^(animation|transition)(-duration|-delay|-property)?$/.test(property)) continue;
      const kind = property.startsWith("animation") ? "animation" : "transition";
      const value = raw.replace(/var\(--[\w-]+,\s*[^)]*\)/g, "var()");
      for (const part of splitCss(value)) {
        const words = splitCss(part, " ");
        const name = words.find((word) => keyframes.has(word)) ?? "";
        if (ALLOW_TIMERS.has(name) || ALLOW_LOOPS.has(name) && words.includes("infinite")) continue;
        for (const word of property.endsWith("-delay") ? [] : words.filter((word) => milliseconds(word) !== undefined).slice(0, 1)) {
          const ms = milliseconds(word);
          if (/^-?\d*\.?\d+(ms|s)$/.test(word)) fail("css-duration", `${rule.file}: «${rule.selectors.join(", ")}»`, `${property}: ${part} — время ${ms} мс литералом; нужен var(--dur-1…5)`);
        }
        if (property === kind) {
          const times = words.map(milliseconds).filter((time) => time !== undefined);
          const delay = times[1] ?? milliseconds(decls[`${kind}-delay`] ?? "0");
          if (times[0] !== undefined && delay !== undefined && times[0] + delay > MAX_MS) fail("css-total", rule.file, `${property}: ${part} — задержка + длительность > 450 мс`);
        }
      }
      if (property === "animation") {
        const moving = splitCss(value).some((part) => splitCss(part, " ").some((name) => MOVING.test(keyframes.get(name) ?? "") && !ALLOW_LOOPS.has(name) && !ALLOW_TIMERS.has(name)));
        if (moving && !rule.selectors.every((selector) => covers(selector, kind))) fail("css-reduce", rule.file, `«${rule.selectors.join(", ")}» двигает, но не переопределён для reduced-motion`);
      }
      if (property === "transition" || property === "transition-property") {
        const moving = splitCss(value).some((part) => MOVING_PROPERTY.test(splitCss(part, " ")[0]));
        if (moving && !rule.selectors.every((selector) => covers(selector, "transition"))) fail("css-transition-reduce", rule.file, `«${rule.selectors.join(", ")}» — двигающий transition без reduced-motion`);
      }
    }
    for (const kind of ["animation", "transition"]) {
      const delay = milliseconds(decls[kind + "-delay"] ?? "0");
      if (!delay) continue;
      const inherited = rules.find((candidate) => !candidate.reduced && candidate !== rule && candidate.selectors.some((selector) => rule.selectors.some((child) => child.replace(/:nth-child\([^)]*\)/g, "*") === selector)));
      const options = decls[kind] || decls[kind + "-duration"] ? decls : inherited ? declarations(inherited.body) : {};
      const duration = milliseconds(options[kind + "-duration"]) ?? splitCss(options[kind] ?? "", " ").map(milliseconds).find((time) => time !== undefined);
      if (duration !== undefined && duration + delay > MAX_MS) fail("css-total", rule.file, "задержка + длительность > 450 мс: " + rule.selectors.join(", "));
    }
    if (rule.selectors.some((selector) => [".anim-view", ".anim-stagger > *", ".ds-empty"].includes(selector))) {
      const names = splitCss(decls.animation ?? "").flatMap((part) => splitCss(part, " ")).filter((name) => keyframes.has(name));
      for (const name of names) if (/\b(transform|translate|scale)\s*:/.test(keyframes.get(name))) fail("screen-transform", rule.file, `«${rule.selectors.join(", ")}» → ${name}: вход экрана должен менять только прозрачность`);
    }
  }

  let jsFiles = 0;
  for (const file of walk(join(root, "src"), /\.tsx?$/)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    jsFiles++;
    const text = readFileSync(file, "utf8");
    // A lexical prefilter only skips files without any guarded identifier/class.
    // All decisions about timing, imports, calls, and functions still use the AST.
    if (!/\b(motion|animate|duration)\b|\btransition-(?:transform|\[[^\]]*(?:transform|translate|scale))|\bhover:(?:scale|-?translate)-|\\u[\da-f]/i.test(text) && !["src/motion.ts", "src/theme.ts", "src/motionEngine.ts"].includes(rel)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const where = (node) => `${rel}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    const { numeric, object } = motionConstants(source);
    const boundedDelay = (prop, initializer) => {
      let fn = prop.parent;
      while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
      if (!fn?.name || !ALLOW_DYNAMIC_DELAY[rel + ":" + fn.name.text]) return;
      const expression = unwrap(initializer);
      const seconds = ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.SlashToken && numeric(expression.right) === 1000;
      const reference = seconds ? expression.left : expression;
      if (!ts.isIdentifier(reference) || reference.text !== "delayMs") return;
      let clamp;
      let delayedPreset = false;
      const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "delayMs") clamp = unwrap(node.initializer);
        if (ts.isSpreadAssignment(node) && ts.isConditionalExpression(unwrap(node.expression))) {
          const conditional = unwrap(node.expression);
          const options = node.parent;
          const call = options.parent;
          const engineOptions = animateCall(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.expression.getText(source) === "e" && call.arguments[2] === options;
          if (engineOptions && conditional.condition.getText(source).replace(/\s/g, "") === "delayMs>0" && conditional.whenTrue.getText(source) === "SPRING_ENTER" && conditional.whenFalse.getText(source) === "SPRING") delayedPreset = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(fn);
      const isMath = (node, name) => node && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === "Math" && node.expression.name.text === name;
      if (!isMath(clamp, "min") || clamp.arguments.length !== 2 || !ts.isConditionalExpression(clamp.arguments[0])) return;
      const ceiling = clamp.arguments[0];
      if (ceiling.condition.getText(source) !== "e") return;
      const springMax = numeric(ceiling.whenTrue), fallbackMax = numeric(ceiling.whenFalse);
      if (!(springMax >= 0 && springMax <= 100 && fallbackMax >= 0 && fallbackMax <= 150) || !delayedPreset) return;
      const floor = clamp.arguments[1];
      if (!isMath(floor, "max") || floor.arguments.length !== 2 || numeric(floor.arguments[0]) !== 0 || floor.arguments[1].getText(source).replace(/\s/g, "") !== "Number.isFinite(delay)?delay:0") return;
      return Math.max(springMax, fallbackMax) / (seconds ? 1000 : 1);
    };
    const checkedOptions = new Set();
    const checkOptions = (options) => {
      if (!options || checkedOptions.has(options)) return;
      checkedOptions.add(options);
      const values = {};
      for (const prop of options.properties) {
        const name = propertyName(prop.name);
        if (name !== "duration" && name !== "delay") continue;
        const initializer = ts.isShorthandPropertyAssignment(prop) ? prop.name : ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
        const literal = numeric(initializer);
        const bound = name === "delay" && initializer ? boundedDelay(prop, initializer) : undefined;
        const value = literal ?? bound;
        if (value === undefined || !Number.isFinite(value)) { fail("js-unresolved", where(prop), `${name} должен быть числом или разрешимой локальной константой`); continue; }
        const ms = value < 10 ? value * 1000 : value;
        values[name] = ms;
        if (bound === undefined && !(name === "delay" && ms === 0) && !TOKENS_MS.some((token) => Math.abs(ms - token) < 1e-6)) fail("js-duration", where(prop), `${name}: ${value} (${ms} мс) — не токен (100/150/200/300/450)`);
      }
      if (values.duration !== undefined && values.duration + (values.delay ?? 0) > MAX_MS) fail("js-total", where(options), "delay + duration > 450 мс");
    };
    const checkSpring = (node, options, name) => {
      if (!options) { fail("spring-options", where(node), "MOTION." + name + " требует литерал настроек"); return; }
      const resolved = {};
      for (const prop of options.properties) if (ts.isPropertyAssignment(prop)) resolved[propertyName(prop.name)] = numeric(prop.initializer);
      if (!SPRING_VISUAL_MS.some(ms => Math.abs(ms - resolved.visualDuration * 1000) < 1e-6)) fail("spring-visual", where(node), "visualDuration должен быть 100/150/200/250/300 мс");
      if (!Number.isFinite(resolved.visualDuration) || !Number.isFinite(resolved.bounce) || options.properties.some(prop => !ts.isPropertyAssignment(prop))) { fail("spring-options", where(node), "пружина требует числовые visualDuration и bounce без spread"); return; }
      const duration = spring.applyToOptions(resolved).duration;
      const delay = numeric(ts.factory.createIdentifier("MAX_SPRING_DELAY_MS"));
      if (name === "enter" && delay !== undefined && duration + delay > MAX_MS) fail("spring-delay-total", where(node), "delayed MOTION.enter + MAX_SPRING_DELAY_MS > 450 мс");
      if (!Number.isFinite(duration) || duration > 500) fail("spring-duration", where(node), "пружина успокаивается за " + duration + " мс (> 500)");
    };
    if (rel === "src/motion.ts") {
      const registry = motionRegistry(source);
      if (!registry.root) fail("motion-registry", rel + ":1", "нужен единый литерал MOTION");
      else {
        if (registry.root.properties.some(prop => !ts.isPropertyAssignment(prop))) fail("motion-registry", where(registry.root), "MOTION должен содержать явные поля без spread");
        for (const name of ["spring", "enter", "pop"]) {
          const prop = registry.fields.get(name);
          if (!prop) fail("motion-registry", where(registry.root), "в MOTION отсутствует " + name);
          else checkSpring(prop, object(prop.initializer), name);
        }
        const exit = registry.fields.get("exit");
        if (!exit || !object(exit.initializer)) fail("motion-registry", where(registry.root), "в MOTION нужен exit");
        else checkOptions(object(exit.initializer));
        for (const name of ["flash", "count"]) {
          const prop = registry.fields.get(name);
          if (!prop || !TOKENS_MS.includes(numeric(prop.initializer))) fail("registry-duration", prop ? where(prop) : where(registry.root), "MOTION." + name + " — только токен 100/150/200/300/450 мс");
        }
      }
    }
    const registryAliases = { SPRING: "spring", SPRING_ENTER: "enter", SPRING_POP: "pop", EXIT: "exit", COUNT_MS: "count" };
    const checkReduced = (fn) => {
      if (!fn.body || !fn.name || NON_ANIMATING[fn.name.text]) return;
      let firstMotion = Infinity, firstReduce = Infinity;
      const visit = (node) => {
        if (ts.isCallExpression(node)) {
          const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
          if (name === "motionReduced") firstReduce = Math.min(firstReduce, node.getStart(source));
          if (animateCall(node) || ["requestAnimationFrame", "startViewTransition"].includes(name) || name === "track" && node.arguments[1]?.kind !== ts.SyntaxKind.NullKeyword) firstMotion = Math.min(firstMotion, node.getStart(source));
        }
        ts.forEachChild(node, visit);
      };
      visit(fn.body);
      if (firstMotion < Infinity && firstReduce >= firstMotion) fail("js-reduce", where(fn), `${fn.name.text}: motionReduced() должен предшествовать первому запуску движения`);
    };
    const checkTailwind = (node) => {
      const value = node.text;
      for (const match of value.matchAll(/\bduration-(\d+)\b/g)) if (!TOKENS_MS.includes(Number(match[1]))) fail("tailwind-duration", where(node), `duration-${match[1]} — не токен`);
      for (const match of value.matchAll(/\bduration-\[([^\]]+)\]/g)) if (!/^var\(--dur-[1-5]\)$/.test(match[1])) fail("tailwind-duration", where(node), `duration-[${match[1]}] — только var(--dur-1…5)`);
      if (!universalTransitionReduce && /(?:^|\s)(?:[\w-]+:)*(?:transition-transform|transition-\[[^\]]*(?:transform|translate|scale)[^\]]*\]|hover:(?:scale|-?translate)-)/.test(value)) {
        const cssClassReduce = value.split(/\s+/).some((name) => /^[a-z][\w-]*$/.test(name) && covers(`.${name}`, "transition"));
        if (!cssClassReduce && !/motion-reduce:(?:transition-none|duration-0)/.test(value)) fail("tailwind-reduce", where(node), "двигающий Tailwind-класс требует motion-reduce:transition-none или CSS reduce-ветку");
      }
    };
    const visit = (node) => {
      let module;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) module = node.moduleSpecifier;
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) module = node.moduleReference.expression;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) module = node.arguments[0];
      if (module && ts.isStringLiteralLike(module) && /^motion(?:\/|$)/.test(module.text) && rel !== "src/motionEngine.ts") fail("motion-import", where(node), `импорт ${module.text} разрешён только в src/motionEngine.ts`);
      if (animateCall(node)) {
        if (rel !== "src/motion.ts" && !ALLOW_RAW_ANIMATE[rel]) fail("raw-animate", where(node), ".animate() разрешён только в src/motion.ts и явных исключениях ALLOW_RAW_ANIMATE");
        checkOptions(object(node.arguments[1]));
      }
      if (!rel.startsWith("src/dev/")) {
        if (["src/motion.ts", "src/theme.ts"].includes(rel) && ts.isObjectLiteralExpression(node)) checkOptions(node);
        if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) checkTailwind(node);
      }
      if (rel === "src/motion.ts") {
        if (ts.isVariableStatement(node) && exported(node)) for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && registryAliases[declaration.name.text] && declaration.initializer?.getText(source).replace(/\s/g, "") !== "MOTION." + registryAliases[declaration.name.text]) fail("registry-alias", where(declaration), declaration.name.text + " должен ссылаться на MOTION." + registryAliases[declaration.name.text]);
        }
        if (ts.isFunctionDeclaration(node) && exported(node)) checkReduced(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { errors, rules: rules.length, keyframes: keyframes.size, jsFiles };
}

function selfTest() {
  // Real files in a disposable source tree; every mutant must hit its own diagnostic.
  const root = mkdtempSync(join(tmpdir(), "taskira-motion-check-"));
  const baseline = {
    "src/motion.ts": `export const MOTION = { spring: { visualDuration: 0.3, bounce: 0.15 }, enter: { visualDuration: 0.25, bounce: 0.1 }, pop: { visualDuration: 0.25, bounce: 0.2 }, exit: { duration: 0.2 }, flash: 300, count: 200 } as const;\nexport const COUNT_MS = MOTION.count;\nexport const SPRING = MOTION.spring;\nexport const SPRING_ENTER = MOTION.enter;\nexport const SPRING_POP = MOTION.pop;\nexport function motionReduced() { return false; }\nexport function enter(el: HTMLElement) { if (motionReduced()) return; el.animate([], { duration: COUNT_MS, delay: 0.1 }); }\nconst EXIT = MOTION.exit;`,
    "src/motionEngine.ts": `export { animate } from "motion/mini"; import { spring } from "motion";`,
    "src/theme.ts": `const THEME_MS = 450; root.animate([], { duration: THEME_MS });`,
    "src/component.tsx": `const classes = "transition-transform motion-reduce:transition-none duration-150";`,
    "src/index.css": `.anim-view, .anim-stagger > *, .ds-empty { animation: viewIn var(--dur-4); }\n@keyframes viewIn { from { opacity: 0; } }\n.card { transition: transform var(--dur-4); }\n@media (prefers-reduced-motion: reduce) { .card { transition: none; } }`,
  };
  baseline["src/motion.ts"] += "\nconst MAX_FLIP_DELAY_MS = 150; // 300 ms fallback + delay <= 450 ms.\nconst MAX_SPRING_DELAY_MS = 100; // SPRING_ENTER settles in 350 ms: total <= 450 ms.\nexport function flipFrom(el: HTMLElement, left: number, top: number, { lift = true, delay = 0 }: { lift?: boolean; delay?: number } = {}): Promise<void> {\r\n  if (motionReduced() || typeof el.animate !== \"function\") return Promise.resolve();\r\n  const e = ready();\n  const delayMs = Math.min(e ? MAX_SPRING_DELAY_MS : MAX_FLIP_DELAY_MS, Math.max(0, Number.isFinite(delay) ? delay : 0));\r\n  track(el, null);\r\n  const last = el.getBoundingClientRect();\r\n  // Координаты viewport → CSS px элемента: под zoom (корневой 1.1 на ≥ 2560 px) translate умножается на него.\r\n  const z = cssZoom(el);\r\n  const dx = (left - last.left) / z;\r\n  const dy = (top - last.top) / z;\r\n  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return Promise.resolve();\r\n  const from = `translate(${dx}px, ${dy}px)${lift ? \" scale(1.035)\" : \"\"}`;\r\n  // До отложенного старта элемент уже должен стоять в начальной точке, а не на новом месте.\r\n  if (delayMs > 0) el.style.transform = from;\r\n  const c = safe(() =>\r\n    e\r\n      ? track(el, e.animate(el, { transform: [from, \"translate(0px, 0px)\"] }, { type: e.spring, ...(delayMs > 0 ? SPRING_ENTER : SPRING), ...(delayMs > 0 ? { delay: delayMs / 1000 } : {}) }), [\"transform\"])\r\n      : track(el, el.animate([{ transform: from }, { transform: \"none\" }], { duration: 300, delay: delayMs, fill: \"backwards\", easing: \"cubic-bezier(0.16, 1, 0.3, 1)\" }), [\"transform\"]),\r\n  );\r\n  return done(c);\r\n}\r\n";
  baseline["src/index.css"] += "\n.anim-stagger > :nth-child(n + 6) { animation-delay: 150ms; }";
  const cases = [
    ["static motion import", "src/component.tsx", (text) => `${text}\nimport { animate } from "motion";`, "motion-import"],
    ["dynamic motion import", "src/component.tsx", (text) => `${text}\nimport("motion/mini");`, "motion-import"],
    ["TS require import", "src/component.tsx", (text) => `${text}\nimport engine = require("motion");`, "motion-import"],
    ["motion require", "src/component.tsx", (text) => `${text}\nrequire("motion");`, "motion-import"],
    ["raw animate", "src/component.tsx", (text) => `${text}\nel.animate([], {duration: 300});`, "raw-animate"],
    ["computed raw animate", "src/component.tsx", (text) => `${text}\nel["animate"]([], {duration: 300});`, "raw-animate"],
    ["seconds duration", "src/motion.ts", (text) => text.replace("duration: 0.2", "duration: 0.5"), "js-duration"],
    ["constant duration", "src/motion.ts", (text) => text.replace("count: 200", "count: 420"), "js-duration"],
    ["theme duration", "src/theme.ts", (text) => text.replace("450", "420"), "js-duration"],
    ["delay and duration", "src/motion.ts", (text) => text.replace("delay: 0.1", "delay: 0.3"), "js-total"],
    ["spring visual duration", "src/motion.ts", (text) => text.replace("visualDuration: 0.3, bounce: 0.15", "visualDuration: 0.45, bounce: 0.4"), "spring-visual"],
    ["spring settling duration", "src/motion.ts", (text) => text.replace("visualDuration: 0.3, bounce: 0.15", "visualDuration: 0.3, bounce: 0.9"), "spring-duration"],
    ["missing reduce guard", "src/motion.ts", (text) => text.replace("if (motionReduced()) return;", ""), "js-reduce"],
    ["late reduce guard", "src/motion.ts", (text) => text.replace("if (motionReduced()) return;", "").replace("delay: 0.1 });", "delay: 0.1 }); if (motionReduced()) return;"), "js-reduce"],
    ["moving transition", "src/index.css", (text) => text.replace(".card { transition: none; }", ""), "css-transition-reduce"],
    ["literal transition", "src/index.css", (text) => `${text}\n.unsafe { transition: transform 300ms; }`, "css-duration"],
    ["CSS delay and duration", "src/index.css", (text) => text.replace("viewIn var(--dur-4)", "viewIn var(--dur-4) var(--dur-3)"), "css-total"],
    ["view keyframes transform", "src/index.css", (text) => text.replace("opacity: 0;", "opacity: 0; transform: translateY(4px);"), "screen-transform"],
    ["Tailwind missing reduce", "src/component.tsx", (text) => text.replace("motion-reduce:transition-none", ""), "tailwind-reduce"],
    ["inherited CSS delay", "src/index.css", (text) => text.replace("animation-delay: 150ms", "animation-delay: 200ms"), "css-total"],
    ["wave fallback delay ceiling", "src/motion.ts", (text) => text.replace("MAX_FLIP_DELAY_MS = 150", "MAX_FLIP_DELAY_MS = 200"), "js-unresolved"],
    ["wave spring delay ceiling", "src/motion.ts", (text) => text.replace("MAX_SPRING_DELAY_MS = 100", "MAX_SPRING_DELAY_MS = 150"), "js-unresolved"],
    ["wave clamp removed", "src/motion.ts", (text) => text.replace("Math.min(e ? MAX_SPRING_DELAY_MS : MAX_FLIP_DELAY_MS, Math.max(0, Number.isFinite(delay) ? delay : 0))", "delay"), "js-unresolved"],
    ["wave wrong spring", "src/motion.ts", (text) => text.replace("delayMs > 0 ? SPRING_ENTER : SPRING", "delayMs > 0 ? SPRING : SPRING"), "js-unresolved"],
    ["registry flash token", "src/motion.ts", text => text.replace("flash: 300", "flash: 420"), "registry-duration"],
    ["duplicate spring alias", "src/motion.ts", text => text.replace("SPRING = MOTION.spring", "SPRING = { visualDuration: 0.3, bounce: 0.15 }"), "registry-alias"],
    ["property duration", "src/motion.ts", text => text.replace("duration: COUNT_MS", "duration: MOTION.flash").replace("flash: 300", "flash: 420"), "js-duration"],
    ["Tailwind non-token", "src/component.tsx", (text) => text.replace("duration-150", "duration-500"), "tailwind-duration"],
  ];
  const save = (file, contents) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); };
  try {
    for (const [file, contents] of Object.entries(baseline)) save(file, contents);
    const valid = checkMotion(root);
    if (valid.errors.length) throw new Error(`valid self-test fixture failed:\n${valid.errors.map((error) => error.text).join("\n")}`);
    for (const [name, file, mutate, code] of cases) {
      save(file, mutate(baseline[file]));
      const result = checkMotion(root);
      save(file, baseline[file]);
      if (!result.errors.some((error) => error.code === code)) throw new Error(`${name}: mutation escaped diagnostic ${code}`);
    }
    console.log(`motion self-test: ${cases.length} independent mutations rejected; valid fixture passes`);
  } finally {
    // root is the exact directory returned by mkdtempSync inside os.tmpdir().
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const result = checkMotion(ROOT);
  if (result.errors.length) {
    console.log(result.errors.map((error) => error.text).join("\n"));
    console.error(`\n${result.errors.length} нарушени(й) правил движения (ADR-0015, ADR-0035)`);
    process.exitCode = 1;
  } else console.log(`motion: ${result.rules} правил CSS, ${result.keyframes} keyframes, ${result.jsFiles} файлов JS — токены, reduced-motion и границы движка проверены`);
}
