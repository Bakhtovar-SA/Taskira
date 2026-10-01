import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { resolveTransparency, CONTRAST_MORE, REDUCED_TRANSPARENCY, type Transparency, type TransparencyDefault } from "./transparency";
import { applyTransparency, readTransparency, setTransparency, watchSystemTheme } from "./theme";

const init = readFileSync("public/theme-init.js", "utf8");
const source = init.split("// resolveTransparency:start")[1].split("// resolveTransparency:end")[0];
const earlyResolve = new Function(`${source}; return resolveTransparency;`)() as typeof resolveTransparency;
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
for (const personal of ["auto", "on", "off"] as Transparency[]) {
  for (const org of ["auto", "on"] as TransparencyDefault[]) {
    for (const reduced of [false, true]) for (const contrast of [false, true]) {
      test(`${personal}/${org}/reduced=${reduced}/contrast=${contrast}`, () => {
        const expected = personal === "on" ? "on" : personal === "off" || contrast ? "off" : org === "on" ? "on" : reduced ? "off" : "on";
        expect(resolveTransparency(personal, org, reduced, contrast)).toBe(expected);
        expect(earlyResolve(personal, org, reduced, contrast)).toBe(expected);
      });
    }
  }
}
test("storage, explicit choice, live media changes, listener cleanup", () => {
  const queries = new Map<string, { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }>();
  vi.stubGlobal("matchMedia", (q: string) => {
    if (!queries.has(q)) queries.set(q, { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    return queries.get(q)!;
  });
  localStorage.setItem("taskira.transparency", "off");
  applyTransparency();
  expect(document.documentElement.dataset.transparency).toBe("off");
  setTransparency("on");
  expect(readTransparency()).toBe("on");
  expect(document.documentElement.dataset.transparency).toBe("on");
  setTransparency("auto");
  const stop = watchSystemTheme();
  for (const q of [REDUCED_TRANSPARENCY, CONTRAST_MORE]) {
    const mq = queries.get(q)!;
    mq.matches = true;
    mq.addEventListener.mock.calls[0][1]({ matches: true });
    expect(document.documentElement.dataset.transparency).toBe("off");
    setTransparency("on");
    expect(document.documentElement.dataset.transparency).toBe("on");
    mq.addEventListener.mock.calls[0][1]({ matches: true });
    expect(document.documentElement.dataset.transparency).toBe("on");
    mq.matches = false;
    setTransparency("auto");
  }
  stop();
  expect(queries.get(REDUCED_TRANSPARENCY)!.removeEventListener).toHaveBeenCalled();
  expect(queries.get(CONTRAST_MORE)!.removeEventListener).toHaveBeenCalled();
});
test("early script always sets an attribute, including unavailable storage", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  localStorage.setItem("taskira.transparency", "off");
  new Function(init)();
  expect(document.documentElement.dataset.transparency).toBe("off");
  vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); } });
  new Function(init)();
  expect(document.documentElement.dataset.transparency).toBe("on");
});


test("early script reads organization cache and treats old/invalid cache as auto", () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === REDUCED_TRANSPARENCY }));
  for (const transparencyDefault of [undefined, "off", "on", "auto"]) {
    localStorage.setItem("taskira.brand", JSON.stringify({ name: null, hue: null, transparencyDefault }));
    new Function(init)();
    expect(document.documentElement.dataset.transparency).toBe(transparencyDefault === "on" ? "on" : "off");
  }
});
