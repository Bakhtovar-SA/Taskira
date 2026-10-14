#!/usr/bin/env node
// Track O A-07: deterministic source inventory; shares the motion guard parser.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import ts from "typescript";
import { walk, readMotionCss, splitCss, animateCall } from "./motion-lib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WRAPPERS = new Set(["enter", "exit", "flipFrom", "glideTo", "glideWidth", "flash", "countTo", "viewTransition"]);
const MOVING = /^(?:all|transform|translate|scale|rotate|width|height|left|right|top|bottom|clip-path|inset|background-position|stroke-dashoffset|grid-template-rows|margin.*)$/;
const properties = body => [...new Set([...body.matchAll(/([\w-]+)\s*:/g)].map(m => m[1]))].sort();
const declarations = body => Object.fromEntries(body.split(";").map(p => p.split(/:(.*)/s).slice(0, 2).map(s => s.trim())).filter(p => p.length === 2));
const quoted = value => String.fromCharCode(96) + value + String.fromCharCode(96);
const cell = value => String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();

export function motionMap(root) {
  const { rules, keyframes, keyframeLocations } = readMotionCss(root);
  const rows = [];
  const sources = [...walk(join(root, "src"), /\.tsx?$/)].filter(f => !relative(root, f).replaceAll("\\", "/").startsWith("src/dev/"))
    .map(file => ({ file: relative(root, file).replaceAll("\\", "/"), text: readFileSync(file, "utf8") }));
  const covers = (selector, rule) => rule.selectors.some(s => s === selector || s === "*" || s.startsWith('html[data-motion="reduce"]') && (!s.includes(":not(") || !/ds-spinner|ds-progress/.test(selector)));
  const reduce = (selectors, kind) => {
    const statuses = [];
    for (const [label, matches] of [
      ["@media", rule => rule.reduced],
      ["личный выключатель", rule => rule.selectors.some(s => /html\[data-motion=["']?reduce/.test(s))],
    ]) {
      if (selectors.every(selector => rules.some(rule => matches(rule) && covers(selector, rule) && (declarations(rule.body)[kind] === "none" || declarations(rule.body)[kind + "-duration"] === "0s !important" || declarations(rule.body)[kind + "-duration"] === "0s" || kind === "animation" && declarations(rule.body).animation && !properties(keyframes.get(splitCss(declarations(rule.body).animation, " ")[0]) ?? "").some(p => MOVING.test(p)))))) statuses.push(label);
    }
    return statuses.join(" + ") || "нет";
  };
  const usages = selectors => {
    const classes = [...new Set(selectors.flatMap(s => [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1])))];
    return sources.filter(source => classes.some(c => new RegExp("(^|[^\\w-])" + c + "([^\\w-]|$)").test(source.text))).map(source => source.file).join(", ") || "CSS / динамическая сборка классов";
  };
  const referenced = new Set();
  for (const rule of rules) {
    if (rule.reduced || rule.file.startsWith("src/dev/") || rule.selectors.some(s => /html\[data-motion=/.test(s))) continue;
    const decls = declarations(rule.body);
    for (const kind of ["animation", "transition"]) {
      const value = decls[kind];
      if (!value || value === "none") continue;
      const names = kind === "animation" ? splitCss(value).flatMap(p => splitCss(p, " ").filter(w => keyframes.has(w))) : [];
      names.forEach(name => referenced.add(name));
      rows.push({
        source: rule.file + ":" + rule.line,
        type: "css-" + kind,
        target: rule.selectors.join(", "),
        properties: kind === "animation" ? [...new Set(names.flatMap(name => properties(keyframes.get(name))))].join(", ") || "состояние" : splitCss(value).map(p => splitCss(p, " ")[0]).join(", "),
        duration: value + (decls[kind + "-delay"] ? "; delay " + decls[kind + "-delay"] : ""),
        reduce: reduce(rule.selectors, kind),
        usage: usages(rule.selectors),
        animationNames: names,
      });
    }
  }
  for (const [name, body] of keyframes) {
    const location = keyframeLocations.get(name);
    if (location?.file.startsWith("src/dev/")) continue;
    rows.push({ source: location.file + ":" + location.line, type: "css-keyframes", target: name, properties: properties(body).join(", "), duration: "из правила применения", reduce: referenced.has(name) ? "см. правила применения" : "нет (не используется)", usage: referenced.has(name) ? "см. CSS" : "не используется", animationNames: [name] });
  }
  for (const { file, text } of sources) {
    if (!/\b(?:enter|exit|flipFrom|glideTo|glideWidth|flash|countTo|viewTransition|animate|startViewTransition)\b/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports = new Map();
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && /(?:^|\/)motion$/.test(statement.moduleSpecifier.text ?? "")) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const imported of bindings.elements) imports.set(imported.name.text, imported.propertyName?.text ?? imported.name.text);
    }
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const wrapper = ts.isIdentifier(node.expression) ? imports.get(node.expression.text) : undefined;
        const raw = animateCall(node);
        const vt = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "startViewTransition";
        if (WRAPPERS.has(wrapper) || raw || vt) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const type = wrapper === "viewTransition" || vt ? "view-transition" : raw && file !== "src/motion.ts" ? "waapi-raw" : "waapi-wrapper";
          const functionName = wrapper ?? (vt ? "startViewTransition" : "animate");
          const options = raw ? node.arguments.at(-1)?.getText(source) ?? "" : "";
          rows.push({ source: file + ":" + line, type, target: functionName, properties: raw ? node.arguments.slice(0, -1).map(a => a.getText(source)).join(", ") : "пресет " + functionName,
            duration: options || "пресет src/motion.ts", reduce: raw || vt ? /\b(?:motionReduced|reducedMotion)\s*\(/.test(text) ? "JS guard в модуле; проверяется motion:check" : "нет" : "обёртка motionReduced", usage: file, animationNames: [] });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return rows.sort((a, b) => a.source.localeCompare(b.source, "en") || a.type.localeCompare(b.type, "en") || a.target.localeCompare(b.target, "en"));
}

function markdown(rows) {
  const lines = ["# Карта движения", "", "Сгенерировано npm run motion:map -- --md. Не править вручную; npm run motion:map -- --check проверяет актуальность.", "",
    "CSS-классы сопоставлены с текстовыми ссылками в TS/TSX (не доказательство выполнения). JS reduce-статус — статический: соблюдение границ проверяет motion:check, выполнение проверяют e2e. DEV и тестовые файлы исключены. Бесконечные индикаторы перечислены, даже если сознательно остаются при reduce.", "",
    "| Источник | Тип | Цель / свойства | Длительность | Reduce | Где применяется |", "|---|---|---|---|---|---|"];
  for (const row of rows) lines.push("| " + [row.source, row.type, row.target + ": " + row.properties, row.duration, row.reduce, row.usage].map(cell).join(" | ") + " |");
  return lines.join("\n") + "\n";
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "taskira-motion-map-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "index.css");
    const css = ".card { animation: grow var(--dur-3); }\n@keyframes grow { from { transform: translateY(2px); } }\n@media (prefers-reduced-motion: reduce) { .card { animation: none; } }\n";
    writeFileSync(file, css);
    const before = motionMap(root).find(row => row.type === "css-animation");
    if (before.reduce !== "@media" || before.source !== "src/index.css:1") throw new Error("valid CSS inventory failed");
    writeFileSync(file, css.replace("@media (prefers-reduced-motion: reduce) { .card { animation: none; } }", ""));
    if (motionMap(root).find(row => row.type === "css-animation").reduce !== "нет") throw new Error("missing reduce mutation escaped inventory");
    writeFileSync(join(root, "src", "card.tsx"), 'import { enter as appear } from "./motion"; appear(card);');
    if (!motionMap(root).some(row => row.target === "enter" && row.reduce === "обёртка motionReduced")) throw new Error("aliased wrapper call missing");
    console.log("motion map self-test: locations, missing reduce, aliased wrappers passed");
  } finally {
    const canonical = resolve(root);
    if (!canonical.startsWith(resolve(tmpdir()) + "/") && !canonical.startsWith(resolve(tmpdir()) + "\\")) throw new Error("Unsafe self-test cleanup");
    rmSync(canonical, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const rows = motionMap(ROOT);
  const output = join(ROOT, "docs", "design", "MOTION-MAP.md");
  const expected = markdown(rows);
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else if (process.argv.includes("--md")) { writeFileSync(output, expected); console.log("motion map: wrote " + rows.length + " entries"); }
  else if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8").replaceAll("\r\n", "\n") !== expected) { console.error("MOTION-MAP.md is stale; run npm run motion:map -- --md"); process.exitCode = 1; }
    else console.log("motion map: " + rows.length + " entries up to date");
  } else console.log(expected);
}