// ADR-0035 (прототип): FLIP доски — снимок до переноса, проигрыш после коммита, повторный проигрыш идемпотентен.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { flash, flipFrom, motionReduced, stopMotion } from "./motion";
import { PENDING_DELAY_MS, cancelBoardFlip, clearBoardFlip, createPendingMarks, flipPending, markPending, noteLanding, playBoardFlip, renewBoardFlip, restoreCardFocus, snapshotBoard } from "./boardFlip";

vi.mock("./motion", () => ({ cssZoom: () => 1, flash: vi.fn(), stopMotion: vi.fn(), flipFrom: vi.fn(() => Promise.resolve()), preloadMotion: vi.fn(() => Promise.resolve(null)), motionReduced: vi.fn(() => false) }));

const tops = new Map<string, number>();
function board(ids: string[]) {
  const root = document.createElement("div");
  root.dataset.flipTestRoot = "";
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
  vi.mocked(flipFrom).mockReset().mockResolvedValue(undefined);
  vi.mocked(flash).mockClear();
  vi.mocked(stopMotion).mockClear();
  vi.mocked(motionReduced).mockReturnValue(false);
});
afterEach(() => {
  document.querySelectorAll<HTMLElement>("[data-flip-test-root]").forEach(clearBoardFlip);
  document.body.innerHTML = "";
  playBoardFlip();
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


function holdFlights() {
  const finishes: (() => void)[] = [];
  vi.mocked(flipFrom).mockImplementation(() => new Promise<void>(resolve => { finishes.push(resolve); }));
  return finishes;
}

test("C-01: reverse responses preserve both lifted cards and their own landing points", () => {
  holdFlights();
  tops.set("a", 0).set("b", 100);
  const root = board(["a", "b"]);
  noteLanding("a", 500, 300);
  snapshotBoard(root, "a");
  noteLanding("b", 600, 400);
  snapshotBoard(root, "b");
  tops.set("b", 200); // second response first
  playBoardFlip();
  tops.set("a", 250); // first response last
  playBoardFlip();
  expect(flipFrom).toHaveBeenCalledTimes(2);
  expect(vi.mocked(flipFrom).mock.calls.map(call => call.slice(1))).toEqual([
    [600, 400, { lift: true }], [500, 300, { lift: true }],
  ]);
  expect(document.querySelectorAll(".flip-flight")).toHaveLength(2);
});

test("C-01: earliest known position wins and all snapshots advance after a commit", () => {
  tops.set("a", 0).set("b", 100);
  const root = board(["a", "b"]);
  const first = snapshotBoard(root, "a");
  tops.set("b", 150);
  snapshotBoard(root, "b");
  tops.set("b", 250);
  playBoardFlip();
  expect(vi.mocked(flipFrom).mock.calls[0].slice(1)).toEqual([10, 100, { lift: true }]);
  cancelBoardFlip(first);
  vi.mocked(flipFrom).mockClear();
  playBoardFlip();
  expect(flipFrom).not.toHaveBeenCalled(); // the second snapshot also knows B reached 250
});

test("C-01: fifth live snapshot evicts only the oldest", () => {
  const owners = Array.from({ length: 5 }, (_, index) => {
    const id = "cap" + index;
    const root = board([id]);
    return snapshotBoard(root, id);
  });
  expect(flipPending("cap0")).toBe(false);
  for (let index = 1; index < 5; index++) expect(flipPending("cap" + index)).toBe(true);
  cancelBoardFlip(owners[1]);
  expect(flipPending("cap1")).toBe(false);
  expect(flipPending("cap4")).toBe(true);
});

test("C-01: cancelling one owner leaves another owner's active flight and snapshot", () => {
  holdFlights();
  tops.set("a", 0).set("b", 100);
  const root = board(["a", "b"]);
  const first = snapshotBoard(root, "a");
  snapshotBoard(root, "b");
  tops.set("a", 50).set("b", 150);
  playBoardFlip();
  expect(document.querySelectorAll(".flip-flight")).toHaveLength(2);
  cancelBoardFlip(first);
  expect(document.querySelectorAll(".flip-flight")).toHaveLength(1);
  expect(el(root, "a").style.visibility).toBe("");
  expect(el(root, "b").style.visibility).toBe("hidden");
  expect(flipPending("b")).toBe(true);
  expect(flash).not.toHaveBeenCalled();
});

test("B-05: clear root stops its flights/timers and releases scroll listener without affecting another root", () => {
  vi.useFakeTimers();
  try {
    holdFlights();
    const remove = vi.spyOn(document, "removeEventListener");
    const first = board(["cleanup-a"]), second = board(["cleanup-b"]);
    snapshotBoard(first, "cleanup-a");
    snapshotBoard(second, "cleanup-b");
    tops.set("cleanup-a", 50).set("cleanup-b", 50);
    playBoardFlip();
    expect(vi.getTimerCount()).toBe(2);
    clearBoardFlip(first);
    expect(vi.getTimerCount()).toBe(1);
    expect(flipPending("cleanup-b")).toBe(true);
    expect(remove.mock.calls.some(call => call[0] === "scroll")).toBe(false);
    clearBoardFlip(second);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector(".flip-flight")).toBeNull();
    expect(remove.mock.calls.some(call => call[0] === "scroll" && call[2] === true)).toBe(true);
    expect(stopMotion).toHaveBeenCalledTimes(2);
    expect(flash).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test("B-05: detached and expired snapshots release their roots and scroll listener", () => {
  vi.useFakeTimers();
  try {
    const remove = vi.spyOn(document, "removeEventListener");
    const root = board(["expired"]);
    snapshotBoard(root, "expired");
    vi.advanceTimersByTime(3001);
    expect(flipPending("expired")).toBe(false);
    expect(remove.mock.calls.some(call => call[0] === "scroll")).toBe(true);
    snapshotBoard(root, "expired");
    root.remove();
    expect(flipPending("expired")).toBe(false);
  } finally { vi.useRealTimers(); }
});

test("C-09: only natural landing flashes the real restored visible card", async () => {
  const finishes = holdFlights();
  const root = board(["natural"]);
  snapshotBoard(root, "natural");
  tops.set("natural", 50);
  playBoardFlip();
  const card = el(root, "natural");
  expect(card.style.visibility).toBe("hidden");
  expect(flash).not.toHaveBeenCalled();
  finishes[0]();
  await Promise.resolve();
  expect(card.style.visibility).toBe("");
  expect(flash).toHaveBeenCalledTimes(1);
  expect(flash).toHaveBeenCalledWith(card);
  expect(document.querySelector(".flip-flight")).toBeNull();
});

test("C-09: guard restores visibility and cancels clone without flashing", async () => {
  vi.useFakeTimers();
  try {
    const finishes = holdFlights();
    const root = board(["guarded"]);
    snapshotBoard(root, "guarded");
    tops.set("guarded", 50);
    playBoardFlip();
    vi.advanceTimersByTime(1001);
    expect(el(root, "guarded").style.visibility).toBe("");
    expect(document.querySelector(".flip-flight")).toBeNull();
    expect(stopMotion).toHaveBeenCalledOnce();
    finishes[0](); // a late successful promise cannot turn forced cleanup into a landing flash
    await Promise.resolve();
    expect(flash).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test("C-09: detached card does not flash when its animation completes", async () => {
  const finishes = holdFlights();
  const root = board(["detached"]);
  snapshotBoard(root, "detached");
  tops.set("detached", 50);
  playBoardFlip();
  el(root, "detached").remove();
  finishes[0]();
  await Promise.resolve();
  expect(flash).not.toHaveBeenCalled();
  expect(document.querySelector(".flip-flight")).toBeNull();
});


test("C-01: play scans a root once even with several live snapshots", () => {
  const root = board(["a", "b"]);
  snapshotBoard(root, "a");
  snapshotBoard(root, "b");
  const query = vi.spyOn(root, "querySelectorAll");
  tops.set("b", 100);
  playBoardFlip();
  expect(query).toHaveBeenCalledTimes(1);
});

test("B-05: scrolling one root only invalidates its snapshots", () => {
  const first = board(["scroll-a"]), second = board(["scroll-b"]);
  snapshotBoard(first, "scroll-a");
  snapshotBoard(second, "scroll-b");
  first.dispatchEvent(new Event("scroll"));
  expect(flipPending("scroll-a")).toBe(false);
  expect(flipPending("scroll-b")).toBe(true);
});

test("C-09: a card hidden before flight is restored to hidden without a flash", async () => {
  const finishes = holdFlights();
  const root = board(["hidden"]);
  el(root, "hidden").style.visibility = "hidden";
  snapshotBoard(root, "hidden");
  tops.set("hidden", 50);
  playBoardFlip();
  finishes[0]();
  await Promise.resolve();
  expect(el(root, "hidden").style.visibility).toBe("hidden");
  expect(flash).not.toHaveBeenCalled();
});
