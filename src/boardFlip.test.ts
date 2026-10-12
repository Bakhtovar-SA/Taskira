// ADR-0035 (прототип): FLIP доски — снимок до переноса, проигрыш после коммита, повторный проигрыш идемпотентен.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { flipFrom, motionReduced } from "./motion";
import { cancelBoardFlip, flipPending, noteLanding, playBoardFlip, snapshotBoard } from "./boardFlip";

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
