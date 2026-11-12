import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ruCore from "./ruCore";
import ruLazy from "./ruLazy";
import ru from "./ru";

/**
 * The Russian dictionary is split in two (see ru.ts): `ruCore` ships with the startup graph, `ruLazy` is a separate
 * chunk that every lazy screen waits for (`lazyView()` / `withRuLazy()` in index.tsx). This test keeps the split
 * honest without a browser:
 *  - startup code (everything `main.tsx` imports statically) must not use a key that lives only in `ruLazy`;
 *  - startup code must not import `ruLazy` (it would pull the chunk back into the bundle);
 *  - a `lazy()` from React must not be used for screens (use `lazyView`), except the overlay wrappers that render no text.
 */
const SRC = resolve(__dirname, "..");
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const e of EXTS) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function staticImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const r = resolveImport(file, m[1]);
    if (r) out.push(r);
  }
  return out;
}

function startupGraph(): Set<string> {
  const seen = new Set<string>();
  const stack = [join(SRC, "main.tsx")];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    // `export type {…} from` and `import type` are skipped by the regexp; css and assets do not resolve to .ts files
    if (/\.tsx?$/.test(f)) stack.push(...staticImports(f));
  }
  return seen;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sourceFiles(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []);
}

const startup = [...startupGraph()].filter((f) => /\.tsx?$/.test(f));
const dictFile = (f: string) => /[\\/]i18n[\\/](ru|ruCore|ruLazy|en)\.ts$/.test(f);

describe("Russian dictionary split", () => {
  it("core and lazy parts are disjoint and make up the whole dictionary", () => {
    const core = Object.keys(ruCore), lazy = Object.keys(ruLazy);
    expect(core.filter((k) => k in ruLazy)).toEqual([]);
    expect(Object.keys(ru).length).toBe(core.length + lazy.length);
  });

  it("the startup graph is found and does not reach ruLazy", () => {
    expect(startup.length).toBeGreaterThan(50);
    expect(startup.map((f) => relative(SRC, f))).toContain("components/Board.tsx");
    expect(startup.filter((f) => /[\\/]ruLazy\.ts$/.test(f) || /[\\/]i18n[\\/]ru\.ts$/.test(f)).map((f) => relative(SRC, f))).toEqual([]);
  });

  it("startup code only uses core keys", () => {
    const bad: string[] = [];
    for (const f of startup.filter((x) => !dictFile(x))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/["'`]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)["'`]/g)) {
        if (m[1] in ruLazy) bad.push(`${relative(SRC, f)}: ${m[1]}`);
      }
      // keys built from a prefix: t(`priority.${p}`) or "role." + x
      const prefixes = [...text.matchAll(/`([a-zA-Z][a-zA-Z0-9.]*\.)\$\{/g)].map((m) => m[1]);
      prefixes.push(...[...text.matchAll(/["']([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9.]*\.)["']\s*\+/g)].map((m) => m[1]));
      for (const p of prefixes) {
        for (const k of Object.keys(ruLazy)) if (k.startsWith(p)) bad.push(`${relative(SRC, f)}: ${p}* -> ${k}`);
      }
    }
    expect(bad, "a startup module uses a key from ruLazy.ts — move that key to ruCore.ts").toEqual([]);
  });

  it("screens are loaded with lazyView(), so their strings arrive first", () => {
    const allowed = new Set(["ds/LazyOverlay.tsx", "ds/LazyTooltip.tsx", "components/settings/parts.tsx", "components/Sidebar.tsx", "i18n/index.tsx"]);
    const bad = sourceFiles(SRC)
      .filter((f) => /=\s*lazy\(\s*\(\)\s*=>\s*import\(/.test(readFileSync(f, "utf8")) && !allowed.has(relative(SRC, f).replace(/\\/g, "/")))
      .map((f) => relative(SRC, f));
    expect(bad, "use lazyView() from i18n instead of React lazy() for screens and dialogs").toEqual([]);
  });
});
