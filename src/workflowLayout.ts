/** Раскладка графа процесса для проекта со своими статусами (ТЗ 5.10, ADR-0017). Чистые функции — их
 *  проверяет workflowLayout.test.ts; стандартные четыре статуса рисуются заготовленной схемой в WorkflowView.
 *
 *  Слои слева направо (упрощённый Sugiyama):
 *    - обход в глубину от первого статуса (в порядке позиций) отделяет обратные переходы от прямых;
 *    - слой — длина самого длинного прямого пути до статуса; «возвратный» статус (дальше ведут только
 *      обратные переходы и закрытие, например «На доработке») встаёт сразу за самым ранним предком;
 *    - закрывающие статусы (категория done) — последний слой, а если слоёв больше пяти — отдельный ряд
 *      снизу, каждый под своими предками;
 *    - внутри слоя — стопкой, порядок по среднему положению предков; больше пяти рабочих слоёв — змейкой.
 *  Стрелки: в соседний слой — горизонтальная кривая между боковыми кромками; назад или через слой — дуга
 *  под рядом или над ним (длиннее переход — глубже дуга, вложенные дуги не пересекаются); внутри стопки и
 *  между рядами — по вертикали. Концы стрелок на одной кромке разнесены, чтобы не сходиться в точку. */

export type WfBox = { x: number; y: number; w: number; h: number; lines: string[] };
export type WfLayout = { boxes: Map<string, WfBox>; viewBox: string; edge: (from: string, to: string) => string };

type St = { id: string; name: string; category: "todo" | "inprogress" | "done" };
type Tr = { from: string; to: string };
type Side = "t" | "b" | "l" | "r";

const H = 72;
const STACK_GAP = 34;
const LEFT = 40;
const CHAR_W = 8.1; // средняя ширина буквы названия (14px Manrope 600) — для переноса строк

/** Название в одну-две строки по словам; не влезло — многоточие. */
export function wrapName(name: string, maxChars: number): string[] {
  const words = name.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const cut = (l: string) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l);
  const out = lines.slice(0, 2).map(cut);
  if (lines.length > 2 && !out[1].endsWith("…")) out[1] = `${out[1].slice(0, maxChars - 1)}…`;
  return out;
}

/** Слой каждого рабочего статуса (закрывающие сюда не входят) и множество обратных переходов. */
export function layersOf(statuses: St[], transitions: Tr[]): { layer: Map<string, number>; back: Set<string> } {
  const layer = new Map<string, number>();
  const back = new Set<string>();
  const open = statuses.filter((s) => s.category !== "done");
  if (!open.length) return { layer, back };
  const isOpen = new Set(open.map((s) => s.id));
  const pos = new Map(statuses.map((s, i) => [s.id, i]));
  const out = new Map<string, string[]>();
  for (const t of transitions) if (isOpen.has(t.from) && isOpen.has(t.to) && t.from !== t.to) out.set(t.from, [...(out.get(t.from) ?? []), t.to]);
  for (const list of out.values()) list.sort((a, b) => pos.get(a)! - pos.get(b)!);

  // Обход в глубину: переход в статус, который сейчас на стеке, — обратный.
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === 1) back.add(`${id}>${to}`);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const s of open) if (!state.has(s.id)) visit(s.id);

  const fwd = (id: string) => (out.get(id) ?? []).filter((to) => !back.has(`${id}>${to}`));
  const preds = new Map<string, string[]>();
  for (const [from, list] of out) for (const to of list) if (!back.has(`${from}>${to}`)) preds.set(to, [...(preds.get(to) ?? []), from]);

  // Возвратный статус: есть обратный выход и нет прямых выходов в рабочие статусы.
  const loop = new Set(open.filter((s) => s !== open[0] && (out.get(s.id) ?? []).some((to) => back.has(`${s.id}>${to}`)) && fwd(s.id).length === 0).map((s) => s.id));

  const memo = new Map<string, number>();
  const longest = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, 0);
    const ps = (preds.get(id) ?? []).filter((p) => !loop.has(p));
    const v = loop.has(id) ? Math.min(...(preds.get(id) ?? [id]).map((p) => (p === id ? -1 : longest(p)))) + 1 : ps.length ? Math.max(...ps.map(longest)) + 1 : 0;
    memo.set(id, Math.max(0, v));
    return memo.get(id)!;
  };
  for (const s of open) layer.set(s.id, longest(s.id));
  // Пустые слои схлопываем.
  const used = [...new Set(layer.values())].sort((a, b) => a - b);
  const rank = new Map(used.map((l, i) => [l, i]));
  for (const [id, l] of layer) layer.set(id, rank.get(l)!);
  return { layer, back };
}

export function layoutWorkflow(statuses: St[], transitions: Tr[]): WfLayout {
  const trs = transitions.filter((t) => t.from !== t.to);
  const { layer } = layersOf(statuses, trs);
  const done = statuses.filter((s) => s.category === "done");
  const mainL = layer.size ? Math.max(...layer.values()) + 1 : 0;
  const finalsRow = done.length > 0 && mainL + 1 > 5;
  const L = mainL + (done.length && !finalsRow ? 1 : 0);
  for (const s of done) if (!finalsRow) layer.set(s.id, mainL);

  const mainRows = L <= 5 ? 1 : Math.ceil(L / 4);
  const cols = Math.max(1, Math.ceil(L / mainRows));
  const w = cols >= 5 ? 160 : cols === 4 ? 190 : 200;
  const gapX = cols >= 5 ? 40 : cols > 1 ? (900 - cols * w) / (cols - 1) : 0;
  const width = cols >= 5 ? 2 * LEFT + cols * w + (cols - 1) * gapX : 980;
  const maxChars = Math.floor((w - 54) / CHAR_W);
  const rows = mainRows + (finalsRow ? 1 : 0);

  // Стопки по слоям; порядок — по среднему индексу предков из прежних слоёв, при равенстве — по позиции.
  const layers: St[][] = Array.from({ length: L }, () => []);
  for (const s of statuses) if (layer.has(s.id)) layers[layer.get(s.id)!].push(s);
  const idxIn = new Map<string, number>();
  const pos = new Map(statuses.map((s, i) => [s.id, i]));
  layers.forEach((lay, li) => {
    const bary = (s: St) => {
      const ps = trs.filter((t) => t.to === s.id && (layer.get(t.from) ?? li) < li).map((t) => idxIn.get(t.from) ?? 0);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
    };
    lay.sort((a, b) => bary(a) - bary(b) || pos.get(a.id)! - pos.get(b.id)!);
    lay.forEach((s, i) => idxIn.set(s.id, i));
  });

  const cellOf = (l: number) => {
    const r = Math.floor(l / cols);
    return { r, c: r % 2 === 0 ? l % cols : cols - 1 - (l % cols) };
  };
  const stackH = (n: number) => n * H + (n - 1) * STACK_GAP;
  const rowH: number[] = Array.from({ length: rows }, () => H);
  layers.forEach((lay, l) => {
    const { r } = cellOf(l);
    rowH[r] = Math.max(rowH[r], stackH(lay.length));
  });

  // Ряды и позиции по x; y — после расчёта глубины дуг (от неё зависит зазор между рядами).
  const rowOf = new Map<string, number>();
  const colOf = new Map<string, number>();
  const xOf = new Map<string, number>();
  layers.forEach((lay, l) => {
    const { r, c } = cellOf(l);
    lay.forEach((s) => {
      rowOf.set(s.id, r);
      colOf.set(s.id, c);
      xOf.set(s.id, LEFT + c * (w + gapX));
    });
  });
  if (finalsRow) {
    const r = rows - 1;
    const want = done.map((s) => {
      const ps = trs.filter((t) => t.to === s.id && xOf.has(t.from)).map((t) => xOf.get(t.from)!);
      return { s, x: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : LEFT };
    });
    want.sort((a, b) => a.x - b.x || pos.get(a.s.id)! - pos.get(b.s.id)!);
    // Раздвигаем, чтобы не наезжали, и прижимаем к правому краю, если вылезли.
    const minStep = w + 40;
    for (let i = 1; i < want.length; i++) want[i].x = Math.max(want[i].x, want[i - 1].x + minStep);
    const over = want.length ? want[want.length - 1].x - (width - LEFT - w) : 0;
    if (over > 0) for (const it of want) it.x -= over;
    for (let i = want.length - 2; i >= 0; i--) want[i].x = Math.min(want[i].x, want[i + 1].x - minStep);
    want.forEach((it, i) => {
      rowOf.set(it.s.id, r);
      colOf.set(it.s.id, -1 - i);
      xOf.set(it.s.id, Math.max(LEFT, it.x));
      idxIn.set(it.s.id, 0);
    });
  }
  const stackSize = new Map<string, number>();
  layers.forEach((lay) => lay.forEach((s) => stackSize.set(s.id, lay.length)));
  for (const s of done) if (finalsRow) stackSize.set(s.id, 1);

  // Вид каждой стрелки и кромки, из которых она выходит и в которые входит.
  type Kind = "side" | "stack" | "arc-t" | "arc-b" | "cross";
  const isTop = (id: string) => idxIn.get(id) === 0;
  const isBottom = (id: string) => idxIn.get(id) === (stackSize.get(id) ?? 1) - 1;
  const flowDir = (id: string) => (rowOf.get(id)! % 2 === 0 ? 1 : -1);
  const kindOf = (t: Tr): Kind => {
    const ra = rowOf.get(t.from)!;
    const rb = rowOf.get(t.to)!;
    if (ra !== rb) return "cross";
    const ca = colOf.get(t.from)!;
    const cb = colOf.get(t.to)!;
    if (ca === cb) return "stack";
    const inFinals = finalsRow && ra === rows - 1;
    if (!inFinals && cb - ca === flowDir(t.from)) return "side";
    const forward = (layer.get(t.to) ?? 0) > (layer.get(t.from) ?? 0);
    const aboveOk = isTop(t.from) && isTop(t.to);
    const belowOk = isBottom(t.from) && isBottom(t.to);
    if (aboveOk && belowOk) return forward ? "arc-t" : "arc-b";
    if (aboveOk) return "arc-t";
    if (belowOk) return "arc-b";
    return forward ? "arc-t" : "arc-b";
  };
  const sides = (t: Tr, k: Kind): [Side, Side] => {
    if (k === "side") return xOf.get(t.to)! > xOf.get(t.from)! ? ["r", "l"] : ["l", "r"];
    if (k === "arc-t") return ["t", "t"];
    if (k === "arc-b") return ["b", "b"];
    const down = k === "stack" ? idxIn.get(t.to)! > idxIn.get(t.from)! : rowOf.get(t.to)! > rowOf.get(t.from)!;
    return down ? ["b", "t"] : ["t", "b"];
  };
  const edges = trs.filter((t) => rowOf.has(t.from) && rowOf.has(t.to)).map((t) => {
    const k = kindOf(t);
    const span = Math.round(Math.abs(xOf.get(t.to)! - xOf.get(t.from)!) / (w + gapX));
    return { t, k, s: sides(t, k), span };
  });

  // Глубина дуг: чем длиннее переход, тем дальше от ряда.
  const depthOf = (span: number) => 26 + 16 * (Math.min(Math.max(span, 1), 5) - 1);
  const below = Array.from({ length: rows }, () => 0);
  const above = Array.from({ length: rows }, () => 0);
  for (const e of edges) {
    const r = rowOf.get(e.t.from)!;
    if (e.k === "arc-b") below[r] = Math.max(below[r], depthOf(e.span));
    if (e.k === "arc-t") above[r] = Math.max(above[r], depthOf(e.span));
  }
  const rowY: number[] = [];
  let y = 20 + above[0];
  for (let r = 0; r < rows; r++) {
    rowY.push(y);
    y += rowH[r] + Math.max(110, below[r] + (r + 1 < rows ? above[r + 1] : 0) + 60);
  }
  const bottomY = rowY[rows - 1] + rowH[rows - 1] + below[rows - 1] + 24;

  const boxes = new Map<string, WfBox>();
  for (const s of statuses) {
    if (!rowOf.has(s.id)) continue;
    const r = rowOf.get(s.id)!;
    const n = stackSize.get(s.id) ?? 1;
    const top = rowY[r] + (rowH[r] - stackH(n)) / 2;
    boxes.set(s.id, { x: xOf.get(s.id)!, y: top + (idxIn.get(s.id) ?? 0) * (H + STACK_GAP), w, h: H, lines: wrapName(s.name, maxChars) });
  }

  // Порты: концы стрелок на одной кромке разносим. Порядок подобран так, чтобы вложенные дуги не
  // пересекались: дуги влево — слева, вертикальные — посередине, дуги вправо — справа; внутри группы
  // дальний конец — снаружи.
  type End = { e: number; end: 0 | 1; key: number[] };
  const bySide = new Map<string, End[]>();
  edges.forEach((ed, i) => {
    ([0, 1] as const).forEach((end) => {
      const me = end === 0 ? ed.t.from : ed.t.to;
      const other = end === 0 ? ed.t.to : ed.t.from;
      const side = ed.s[end];
      const b = boxes.get(me)!;
      const o = boxes.get(other)!;
      const mx = b.x + b.w / 2;
      const ox = o.x + o.w / 2;
      let key: number[];
      if (side === "l" || side === "r") key = [o.y + o.h / 2];
      else if (ed.k === "arc-t" || ed.k === "arc-b") key = ox < mx ? [0, -ox] : [2, -ox];
      else {
        // Вертикальные: при встречной паре внизу сначала исходящая, вверху — входящая.
        const tie = (side === "b") === (end === 0) ? 0 : 1;
        key = [1, ox, tie];
      }
      const k = `${me}:${side}`;
      bySide.set(k, [...(bySide.get(k) ?? []), { e: i, end, key }]);
    });
  });
  const offset = new Map<string, number>();
  for (const [k, list] of bySide) {
    list.sort((a, b) => {
      for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
        const d = (a.key[i] ?? 0) - (b.key[i] ?? 0);
        if (d) return d;
      }
      return 0;
    });
    const vertical = k.endsWith(":l") || k.endsWith(":r");
    const step = vertical ? Math.min(12, (H - 24) / Math.max(1, list.length - 1)) : Math.min(26, (w - 48) / Math.max(1, list.length - 1));
    list.forEach((it, i) => offset.set(`${it.e}:${it.end}`, (i - (list.length - 1) / 2) * step));
  }

  const f = (n: number) => n.toFixed(1);
  const pt = (id: string, side: Side, off: number, gap: number) => {
    const b = boxes.get(id)!;
    if (side === "l") return { x: b.x - gap, y: b.y + b.h / 2 + off };
    if (side === "r") return { x: b.x + b.w + gap, y: b.y + b.h / 2 + off };
    if (side === "t") return { x: b.x + b.w / 2 + off, y: b.y - gap };
    return { x: b.x + b.w / 2 + off, y: b.y + b.h + gap };
  };
  const paths = new Map<string, string>();
  edges.forEach((ed, i) => {
    const p1 = pt(ed.t.from, ed.s[0], offset.get(`${i}:0`) ?? 0, 0);
    const p2 = pt(ed.t.to, ed.s[1], offset.get(`${i}:1`) ?? 0, 6);
    let d: string;
    if (ed.k === "side") {
      const mx = (p1.x + p2.x) / 2;
      d = `M${f(p1.x)},${f(p1.y)} C${f(mx)},${f(p1.y)} ${f(mx)},${f(p2.y)} ${f(p2.x)},${f(p2.y)}`;
    } else if (ed.k === "arc-t" || ed.k === "arc-b") {
      const r = rowOf.get(ed.t.from)!;
      const depth = depthOf(ed.span);
      const yy = ed.k === "arc-t" ? rowY[r] - depth : rowY[r] + rowH[r] + depth;
      // Чуть выше/ниже кромки ряда — чтобы дуга выходила из блока вертикально, а не наискось.
      d = `M${f(p1.x)},${f(p1.y)} C${f(p1.x)},${f(yy)} ${f(p2.x)},${f(yy)} ${f(p2.x)},${f(p2.y)}`;
    } else if (ed.k === "stack" && Math.abs(p1.x - p2.x) < 1) {
      d = `M${f(p1.x)},${f(p1.y)} L${f(p2.x)},${f(p2.y)}`;
    } else {
      const k = (p2.y - p1.y) / 2;
      d = `M${f(p1.x)},${f(p1.y)} C${f(p1.x)},${f(p1.y + k)} ${f(p2.x)},${f(p2.y - k)} ${f(p2.x)},${f(p2.y)}`;
    }
    paths.set(`${ed.t.from}>${ed.t.to}`, d);
  });

  const top = Math.min(0, rowY[0] - above[0] - 16);
  return { boxes, viewBox: `0 ${f(top)} ${f(width)} ${f(bottomY - top)}`, edge: (from, to) => paths.get(`${from}>${to}`) ?? "" };
}
