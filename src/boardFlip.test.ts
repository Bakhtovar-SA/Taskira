// ADR-0035 (прототип): FLIP доски — снимок до переноса, проигрыш после коммита, повторный проигрыш идемпотентен.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { flipFrom, motionReduced } from "./motion";
import { PENDING_DELAY_MS, cancelBoardFlip, createPendingMarks, flipPending, markPending, noteLanding, playBoardFlip, renewBoardFlip, restoreCardFocus, snapshotBoard } from "./boardFlip";

vi.mock("./motion", () => ({ cssZoom: () => 1, flipFrom: vi.fn(() => Promise.resolve()), preloadMotion: vi.fn(() => Promise.resolve(null)), motionReduced: vi.fn(() => false) }));

const tops = new Map<string, number>();
function board(ids: string[]) {
  const root = document.createElement("div");
  for (const id of ids) {
    const el = document.createElement("article");
    el.dataset.issueId = id;
    el.getBoundingClientRect = () => ({ left: 10, top: tops.get(id) ?? 0 }) as DOMRect;
    root.appendChild(el);
  }
  document.body.appendChild(root);
  return root;
}
const el = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-issue-id="${id}"]`)!;

beforeEach(() => {
  tops.clear();
  vi.mocked(flipFrom).mockClear();
  vi.mocked(motionReduced).mockReturnValue(false);
});
afterEach(() => {
  document.body.innerHTML = "";
});

test("сдвинутые карточки едут со старого места; перенесённая — с «подъёмом»; второй проигрыш ничего не делает", () => {
  tops.set("a", 0).set("b", 100).set("c", 200);
  const root = board(["a", "b", "c"]);
  snapshotBoard(root, "a");
  // «a» ушла вниз, «b» и «c» поднялись.
  tops.set("a", 200).set("b", 0).set("c", 100);
  playBoardFlip();
  // Перенесённая карточка летит копией над доской (scale «подъёма» обрезался бы телом колонки), соседи — сами.
  const clone = document.querySelector<HTMLElement>(".flip-flight > article")!;
  expect(vi.mocked(flipFrom).mock.calls).toEqual([
    [clone, 10, 0, { lift: true }],
    [el(root, "b"), 10, 100, { lift: false }],
    [el(root, "c"), 10, 200, { lift: false }],
  ]);
  playBoardFlip();
  expect(flipFrom).toHaveBeenCalledTimes(3);
});

test("перетаскивание: брошенная карточка прилетает из точки, где отпустили «призрак»", async () => {
  tops.set("a", 0);
  const root = board(["a"]);
  noteLanding("a", 500, 300);
  snapshotBoard(root, "a");
  // До ответа сервера карточка на старом месте: коммит в это время её никуда не «возвращает».
  playBoardFlip();
  expect(flipFrom).not.toHaveBeenCalled();
  tops.set("a", 50);
  playBoardFlip();
  // Другая колонка: летит копия в фиксированном слое (тело колонки обрезало бы карточку), сама карточка скрыта.
  const clone = document.querySelector<HTMLElement>(".flip-flight > article")!;
  expect(clone.hasAttribute("data-issue-id")).toBe(false);
  expect(vi.mocked(flipFrom).mock.calls).toEqual([[clone, 500, 300, { lift: true }]]);
  expect(el(root, "a").style.visibility).toBe("hidden");
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelector(".flip-flight")).toBeNull();
  expect(el(root, "a").style.visibility).toBe("");
});

test("прокрутка сбрасывает снимок; reduced-motion — снимка нет вовсе", () => {
  tops.set("a", 0);
  const root = board(["a"]);
  snapshotBoard(root, "a");
  document.dispatchEvent(new Event("scroll"));
  tops.set("a", 100);
  playBoardFlip();
  vi.mocked(motionReduced).mockReturnValue(true);
  snapshotBoard(root, "a");
  tops.set("a", 200);
  playBoardFlip();
  expect(flipFrom).not.toHaveBeenCalled();
});

test("отказ первого переноса не стирает снимок второго, а свой снимок отменяет", () => {
  tops.set("a", 0).set("b", 100);
  const root = board(["a", "b"]);
  const first = snapshotBoard(root, "a");
  const second = snapshotBoard(root, "b");
  cancelBoardFlip(first);
  expect(flipPending("b")).toBe(true);
  cancelBoardFlip(second);
  expect(flipPending("b")).toBe(false);
});

test("продление снимка после ответа сервера: перелёт играет, даже если перечитывание списка дольше TTL", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(0);
    tops.set("a", 0).set("b", 100);
    const root = board(["a", "b"]);
    const owner = snapshotBoard(root, null);
    // Ответ сервера принят: возраст снимка — от него, плюс запас на второй запрос.
    vi.setSystemTime(2000);
    renewBoardFlip(owner);
    // Перечитывание списка закончилось через 6 с после клика (> 3 с TTL от клика, но в пределах продления).
    vi.setSystemTime(6000);
    tops.set("a", 100).set("b", 0);
    expect(flipPending("a")).toBe(true);
    playBoardFlip();
    expect(flipFrom).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("продлённый снимок закрывается после первого коммита с переездом", () => {
  tops.set("a", 0).set("b", 100);
  const root = board(["a", "b"]);
  const owner = snapshotBoard(root, null);
  renewBoardFlip(owner);
  tops.set("a", 100).set("b", 0);
  playBoardFlip();
  expect(flipFrom).toHaveBeenCalled();
  vi.mocked(flipFrom).mockClear();
  // Чужое изменение позже: снимка уже нет, ничего не анимируется от устаревших положений.
  expect(flipPending("a")).toBe(false);
  tops.set("a", 0).set("b", 100);
  playBoardFlip();
  expect(flipFrom).not.toHaveBeenCalled();
});

test("массовая смена статуса: карточки сменили колонку — волна: лидер без задержки, остальные следом, все с «подъёмом»", () => {
  tops.set("a", 0).set("b", 100).set("c", 200);
  const root = board(["a", "b", "c"]);
  // Разные колонки: левая позиция карточек меняется при переезде.
  const lefts = new Map<string, number>([["a", 10], ["b", 10], ["c", 10]]);
  for (const id of ["a", "b", "c"]) el(root, id).getBoundingClientRect = () => ({ left: lefts.get(id)!, top: tops.get(id) ?? 0 }) as DOMRect;
  const owner = snapshotBoard(root, null);
  renewBoardFlip(owner);
  lefts.set("a", 400).set("b", 400).set("c", 400);
  tops.set("a", 0).set("b", 80).set("c", 160);
  playBoardFlip();
  const flights = [...document.querySelectorAll<HTMLElement>(".flip-flight")];
  expect(flights).toHaveLength(3);
  const calls = vi.mocked(flipFrom).mock.calls;
  expect(calls).toHaveLength(3);
  // Порядок: сверху вниз; первая — без задержки, дальше растёт; все с lift; общий разброс ≤ потолка волны.
  const delays = calls.map((c) => (c[3] as { delay?: number } | undefined)?.delay ?? 0);
  expect(delays[0]).toBe(0);
  expect(delays[1]).toBeGreaterThan(0);
  expect(delays[2]).toBeGreaterThan(delays[1]);
  expect(Math.max(...delays)).toBeLessThanOrEqual(220);
  expect(calls.every((c) => (c[3] as { lift?: boolean }).lift === true)).toBe(true);
  // Лидер поверх остальных.
  const zs = flights.map((f) => Number(f.style.zIndex));
  expect(zs[0]).toBeGreaterThan(zs[1]);
  expect(zs[1]).toBeGreaterThan(zs[2]);
});

test("FIX-12: после переезда карточки фокус возвращается на новую кнопку; чужой фокус не перехватывается", () => {
  vi.useFakeTimers();
  try {
    const root = document.createElement("div");
    const card = (id: string) => {
      const a = document.createElement("article");
      a.dataset.issueId = id;
      const b = document.createElement("button");
      b.className = "board-card-open";
      a.appendChild(b);
      root.appendChild(a);
      return { a, b };
    };
    document.body.appendChild(root);
    const old = card("x");
    old.b.focus();
    const before = document.activeElement;
    expect(before).toBe(old.b);
    restoreCardFocus(root, "x", before, old.b);
    // Перенос отрисован позже: старая карточка исчезла (фокус на body), новая — в другой колонке.
    old.a.remove();
    const fresh = card("x");
    vi.advanceTimersByTime(60);
    expect(document.activeElement).toBe(fresh.b);

    // Фокус осознанно ушёл на другое поле: не трогаем.
    const other = document.createElement("input");
    document.body.appendChild(other);
    fresh.b.blur();
    other.focus();
    restoreCardFocus(root, "x", fresh.b, fresh.b);
    vi.advanceTimersByTime(2000);
    expect(document.activeElement).toBe(other);
  } finally {
    vi.useRealTimers();
  }
});

test("FIX-12: новая карточка уже отрисована к моменту вызова (ответ сервера пришёл после коммита) — фокус всё равно возвращается", () => {
  vi.useFakeTimers();
  try {
    const root = document.createElement("div");
    const card = (id: string) => {
      const a = document.createElement("article");
      a.dataset.issueId = id;
      const b = document.createElement("button");
      b.className = "board-card-open";
      a.appendChild(b);
      root.appendChild(a);
      return { a, b };
    };
    document.body.appendChild(root);
    const old = card("y");
    old.b.focus();
    const before = document.activeElement;
    // Старую кнопку запомнил вызывающий до переноса; к моменту вызова она уже заменена новой, фокус потерян.
    old.a.remove();
    const fresh = card("y");
    expect(document.activeElement).toBe(document.body);
    restoreCardFocus(root, "y", before, old.b);
    vi.advanceTimersByTime(60);
    expect(document.activeElement).toBe(fresh.b);
  } finally {
    vi.useRealTimers();
  }
});

test("FIX-12: onDone вызывается по завершении цепочки (успех) и после исчерпания попыток", () => {
  vi.useFakeTimers();
  try {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const a = document.createElement("article");
    a.dataset.issueId = "z";
    const b = document.createElement("button");
    b.className = "board-card-open";
    a.appendChild(b);
    root.appendChild(a);
    // Успех: новая кнопка видна, фокус потерян.
    const done = vi.fn();
    restoreCardFocus(root, "z", null, document.createElement("button"), done);
    vi.advanceTimersByTime(10);
    expect(document.activeElement).toBe(b);
    expect(done).toHaveBeenCalledTimes(1);
    // Исчерпание: кнопки нет совсем.
    const none = vi.fn();
    restoreCardFocus(root, "nope", null, null, none);
    vi.advanceTimersByTime(3000);
    expect(none).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("markPending: отметка появляется только после паузы, снимается идемпотентно; быстрый ответ карточку не трогает", () => {
  vi.useFakeTimers();
  try {
    const root = document.createElement("div");
    root.innerHTML = `<article data-issue-id="a"></article>`;
    document.body.append(root);
    const card = root.firstElementChild as HTMLElement;

    const fast = markPending(root, "a");
    vi.advanceTimersByTime(PENDING_DELAY_MS - 1);
    fast();
    vi.advanceTimersByTime(PENDING_DELAY_MS * 2);
    expect(card.hasAttribute("data-pending")).toBe(false);

    const slow = markPending(root, "a");
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    expect(card.hasAttribute("data-pending")).toBe(true);
    expect(card.getAttribute("aria-busy")).toBe("true");
    slow();
    slow();
    expect(card.hasAttribute("data-pending")).toBe(false);
    expect(card.hasAttribute("aria-busy")).toBe(false);
    root.remove();
  } finally {
    vi.useRealTimers();
  }
});

test("createPendingMarks: ответ на устаревший перенос не снимает отметку текущего", () => {
  vi.useFakeTimers();
  try {
    const root = document.createElement("div");
    root.innerHTML = `<article data-issue-id="a"></article>`;
    document.body.append(root);
    const card = root.firstElementChild as HTMLElement;
    const marks = createPendingMarks(() => root);

    const end1 = marks.start("a");
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    expect(card.hasAttribute("data-pending")).toBe(true);
    const end2 = marks.start("a"); // второй перенос, пока первый в пути
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    end1(); // ответ на первый
    expect(card.hasAttribute("data-pending")).toBe(true);
    end2();
    expect(card.hasAttribute("data-pending")).toBe(false);

    marks.start("a");
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    marks.clearAll(); // уход с доски
    expect(card.hasAttribute("data-pending")).toBe(false);
    root.remove();
  } finally {
    vi.useRealTimers();
  }
});
