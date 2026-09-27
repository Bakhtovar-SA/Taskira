import { describe, expect, test } from "vitest";
import builtin from "../server/src/templates/builtin.json";
import { layersOf, layoutWorkflow, wrapName } from "./workflowLayout";

type Cat = "todo" | "inprogress" | "done";
const specs = (builtin as unknown as { templates: { id: string; spec: { statuses: { sid: string; name: string; category: Cat }[]; transitions: [string, string][] } }[] }).templates;
const graph = (id: string) => {
  const s = specs.find((t) => t.id === id)!.spec;
  return {
    statuses: s.statuses.map((x) => ({ id: x.sid, name: x.name, category: x.category })),
    transitions: s.transitions.map(([from, to]) => ({ from, to })),
  };
};

describe("раскладка схемы процесса (свои статусы)", () => {
  test("согласование: «На доработке» встаёт рядом с «Комплаенсом», а не в конец цепочки", () => {
    const g = graph("approval");
    const { layer } = layersOf(g.statuses, g.transitions);
    expect(layer.get("draft")).toBe(0);
    expect(layer.get("legal")).toBe(1);
    expect(layer.get("rework")).toBe(layer.get("compliance"));
    expect(layer.get("signoff")).toBe(3);
  });

  test.each(specs.map((s) => s.id))("%s: у каждого перехода есть путь без NaN, блоки не наезжают друг на друга", (id) => {
    const g = graph(id);
    const l = layoutWorkflow(g.statuses, g.transitions);
    expect(l.boxes.size).toBe(g.statuses.length);
    for (const t of g.transitions) {
      const d = l.edge(t.from, t.to);
      expect(d).toMatch(/^M/);
      expect(d).not.toMatch(/NaN|Infinity/);
    }
    const bs = [...l.boxes.values()];
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    const [, , vw] = l.viewBox.split(" ").map(Number);
    for (const b of bs) expect(b.x + b.w).toBeLessThanOrEqual(vw);
  });

  test("найм: шесть слоёв — закрывающие статусы уходят отдельным рядом вниз", () => {
    const g = graph("hr");
    const l = layoutWorkflow(g.statuses, g.transitions);
    const y = (id: string) => l.boxes.get(id)!.y;
    expect(y("hired")).toBeGreaterThan(y("onboarding"));
    expect(y("closed")).toBe(y("hired"));
    expect(y("vacancy")).toBe(y("onboarding"));
  });

  test("wrapName: по словам в две строки, длинное — с многоточием", () => {
    expect(wrapName("Подпись руководителя", 13)).toEqual(["Подпись", "руководителя"]);
    expect(wrapName("Бриф", 13)).toEqual(["Бриф"]);
    expect(wrapName("Очень длинное название статуса процесса", 10).at(-1)).toMatch(/…$/);
  });
});
