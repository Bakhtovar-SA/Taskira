import type {
  Conditions,
  ProcessTemplateBody,
  PlanItem,
  ForecastResult,
  ProcessStep,
} from "../workspaceContract.js";

/** Unqualified task fields are usable only when a single direct dependency owns
 * the name. Explicit step.<key>.<field> references disambiguate parallel results. */
export function stepConditionValues(
  step: ProcessStep,
  base: Record<string, unknown>,
  results: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const values = { ...base };
  const fields = new Map<string, unknown[]>();
  for (const key of step.dependsOn) {
    for (const [name, value] of Object.entries(results.get(key) ?? {})) {
      values[`step.${key}.${name}`] = value;
      fields.set(name, [...(fields.get(name) ?? []), value]);
    }
  }
  for (const [name, items] of fields) {
    if (items.length === 1) values[name] = items[0];
    else delete values[name];
  }
  return values;
}

export function matches(
  when: Conditions,
  values: Record<string, unknown>,
): boolean {
  const results = when.items.map((c) => {
    const v = Object.prototype.hasOwnProperty.call(values, c.field)
      ? values[c.field]
      : undefined;
    if (c.op === "isSet") return v !== null && v !== undefined && v !== "";
    if (c.op === "eq") return v === c.value;
    if (c.op === "neq") return v !== c.value;
    return Array.isArray(v)
      ? v.includes(c.value)
      : typeof v === "string" &&
          typeof c.value === "string" &&
          v.includes(c.value);
  });
  return (
    !results.length ||
    (when.mode === "all" ? results.every(Boolean) : results.some(Boolean))
  );
}
export function validateGraph(spec: ProcessTemplateBody): string[] {
  const errors: string[] = [];
  const steps = new Map(spec.steps.map((s) => [s.key, s]));
  if (steps.size !== spec.steps.length)
    errors.push("Ключи этапов должны быть уникальными");
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (key: string) => {
    if (done.has(key)) return;
    if (visiting.has(key)) {
      errors.push("В процессе есть цикл");
      return;
    }
    const step = steps.get(key);
    if (!step) {
      errors.push(`Неизвестный этап: ${key}`);
      return;
    }
    visiting.add(key);
    for (const k of step.dependsOn) visit(k);
    visiting.delete(key);
    done.add(key);
  };
  for (const key of steps.keys()) visit(key);
  return [...new Set(errors)];
}
export interface Completion {
  id: string;
  completedAt: string;
  complexity: string | null;
}
export function forecast(
  items: PlanItem[],
  history: Completion[],
  asOf = new Date(),
  seed = 7919,
): ForecastResult {
  const day = 86400000;
  const monday = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, i) => ({
    week: new Date(+monday - (12 - i) * 7 * day).toISOString().slice(0, 10),
    counts: {} as Record<string, number>,
  }));
  const seen = new Set<string>();
  let oldest = +monday;
  let total = 0;
  for (const h of history) {
    const t = Date.parse(h.completedAt);
    if (seen.has(h.id) || t < +monday - 84 * day || t >= +monday) continue;
    seen.add(h.id);
    const index = Math.floor((t - (+monday - 84 * day)) / (7 * day));
    const c = h.complexity ?? "unestimated";
    weeks[index].counts[c] = (weeks[index].counts[c] ?? 0) + 1;
    total++;
    oldest = Math.min(oldest, t);
  }
  const available = Math.min(12, Math.ceil((+monday - oldest) / (7 * day)));
  const sampleWeeks = weeks.slice(12 - available);
  const base: ForecastResult = {
    sufficientHistory: false,
    reason: null,
    reasonCode: null,
    projection: [],
    historyWeeks: available,
    completedIssues: total,
    medianWeek: null,
    p80Week: null,
    samples: 0,
    asOf: asOf.toISOString(),
    weekly: weeks,
  };
  if (!items.length)
    return {
      ...base,
      reasonCode: "emptyWork",
      reason: "В плане нет незавершённой работы",
    };
  if (new Set(items.map((i) => i.id)).size !== items.length)
    return {
      ...base,
      reasonCode: "duplicateWork",
      reason: "В плане есть повторяющиеся единицы работы",
    };
  if (available < 4 || total < 20)
    return {
      ...base,
      reasonCode: "insufficientHistory",
      reason: "Нужно не менее четырёх полных недель и 20 завершённых задач",
    };
  const kinds = new Set(items.map((i) => i.complexity ?? "unestimated"));
  for (const c of kinds)
    if (!sampleWeeks.some((w) => (w.counts[c] ?? 0) > 0))
      return {
        ...base,
        reasonCode: "missingHistory",
        reason: "Нет истории для одной из категорий сложности",
      };
  const ids = new Set(items.map((i) => i.id));
  if (items.some((i) => i.dependsOn.some((d) => !ids.has(d))))
    return {
      ...base,
      reasonCode: "missingDependency",
      reason: "В плане отсутствует обязательная зависимость",
    };
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const results: number[] = [];
  const indexById = new Map(items.map((item, index) => [item.id, index]));
  const dependents = items.map(() => [] as number[]);
  const indegrees = items.map((item) => item.dependsOn.length);
  items.forEach((item, i) =>
    item.dependsOn.forEach((id) => dependents[indexById.get(id)!].push(i)),
  );
  const categories = ["simple", "medium", "hard", "unestimated"];
  const categoryIndex = items.map((i) =>
    categories.indexOf(i.complexity ?? "unestimated"),
  );
  const histograms: Map<number, number>[] = [];
  const push = (heap: number[], value: number) => {
    heap.push(value);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p] <= value) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = value;
  };
  const pop = (heap: number[]) => {
    const result = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
        if (heap[child] >= last) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return result;
  };
  for (let n = 0; n < 10000; n++) {
    const pending = [...indegrees],
      ready = categories.map(() => [] as number[]);
    pending.forEach((count, i) => {
      if (!count) push(ready[categoryIndex[i]], i);
    });
    let count = 0,
      week = 0;
    while (count < items.length && week < 520) {
      const sampled =
        sampleWeeks[Math.floor(random() * sampleWeeks.length)].counts;
      const budget = categories.map((c) => sampled[c] ?? 0);
      while (true) {
        let selected = -1,
          best = Infinity;
        for (let c = 0; c < 4; c++)
          if (budget[c] > 0 && ready[c].length && ready[c][0] < best) {
            selected = c;
            best = ready[c][0];
          }
        if (selected < 0) break;
        const done = pop(ready[selected]);
        budget[selected]--;
        count++;
        for (const child of dependents[done])
          if (--pending[child] === 0) push(ready[categoryIndex[child]], child);
      }
      const histogram = histograms[week] ?? (histograms[week] = new Map());
      histogram.set(count, (histogram.get(count) ?? 0) + 1);
      week++;
      if (ready.every((heap) => !heap.length) && count < items.length) break;
    }
    if (count < items.length)
      return {
        ...base,
        reasonCode: "invalidDependencies",
        reason: "Зависимости содержат цикл или горизонт превышает десять лет",
      };
    results.push(week);
  }
  results.sort((a, b) => a - b);
  const end = (w: number) =>
    new Date(+monday + (w - 1) * 7 * day).toISOString().slice(0, 10);
  return {
    ...base,
    sufficientHistory: true,
    medianWeek: end(results[4999]),
    p80Week: end(results[7999]),
    samples: 10000,
    projection: histograms.map((histogram, i) => {
      const observed = [...histogram.values()].reduce((a, b) => a + b, 0);
      histogram.set(
        items.length,
        (histogram.get(items.length) ?? 0) + 10000 - observed,
      );
      const sorted = [...histogram].sort(([a], [b]) => a - b);
      const quantile = (q: number) => {
        let total = 0;
        for (const [count, n] of sorted) {
          total += n;
          if (total >= q * 10000) return count;
        }
        return items.length;
      };
      return {
        week: new Date(+monday + i * 7 * day).toISOString().slice(0, 10),
        lower: quantile(0.2),
        median: quantile(0.5),
        upper: quantile(0.8),
      };
    }),
  };
}
