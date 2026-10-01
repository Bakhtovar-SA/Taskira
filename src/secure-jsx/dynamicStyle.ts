import type { CSSProperties } from "react";

const classes = new Map<string, string>();
const inserted = new Set<string>();
const parsedStyles = new Map<string, { className: string; cssText: string }>();
const PARSED_STYLE_LIMIT = 256;
let sequence = 0;
const unitless = new Set([
  "animationIterationCount", "aspectRatio", "columnCount", "flex", "flexGrow", "flexShrink",
  "fontWeight", "gridColumn", "gridColumnEnd", "gridColumnStart", "gridRow", "gridRowEnd",
  "gridRowStart", "lineHeight", "opacity", "order", "scale", "tabSize", "zIndex", "zoom",
]);

function toCssName(name: string): string {
  if (name.startsWith("--")) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^ms-/, "-ms-");
}

function stylesheet(): CSSStyleSheet | null {
  if (typeof document === "undefined") return null;
  const node = document.getElementById("taskira-dynamic-styles") as HTMLLinkElement | HTMLStyleElement | null;
  return node?.sheet ?? null;
}

function ensureRule(className: string, cssText: string): void {
  if (inserted.has(className)) return;
  const sheet = stylesheet();
  if (sheet) {
    sheet.insertRule(`.${className}{${cssText}}`);
    inserted.add(className);
    return;
  }
  document.getElementById("taskira-dynamic-styles")?.addEventListener("load", () => ensureRule(className, cssText), { once: true });
}

/** Converts React's style object to a class backed by an allowed external
 * stylesheet. CSSStyleDeclaration performs the parsing; braces, semicolons
 * and at-rules are rejected before insertion to keep user colours inert. */
export function dynamicStyle(style: CSSProperties): string {
  if (typeof document === "undefined") return "";
  const entries = Object.entries(style);
  const key = JSON.stringify(entries.map(([name, value]) => [name, typeof value, value == null ? null : String(value)]));
  const parsed = parsedStyles.get(key);
  if (parsed) {
    ensureRule(parsed.className, parsed.cssText);
    return parsed.className;
  }
  const probe = document.createElement("div");
  for (const [name, raw] of entries) {
    if (raw === null || raw === undefined || raw === "") continue;
    const value = typeof raw === "number" && raw !== 0 && !unitless.has(name) ? `${raw}px` : String(raw);
    if (/[{};@]/.test(value) || /url\s*\(/i.test(value)) continue;
    if (name.startsWith("--")) probe.style.setProperty(name, value);
    else probe.style.setProperty(toCssName(name), value);
  }
  const cssText = probe.style.cssText;
  if (!cssText) return "";
  const className = classes.get(cssText) ?? `taskira-dyn-${++sequence}`;
  classes.set(cssText, className);
  // Bound the fast path; generated CSS rules keep their existing deduplication and validation.
  if (parsedStyles.size >= PARSED_STYLE_LIMIT) parsedStyles.delete(parsedStyles.keys().next().value!);
  parsedStyles.set(key, { className, cssText });
  ensureRule(className, cssText);
  return className;
}
