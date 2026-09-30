import { afterEach, expect, test, vi } from "vitest";
import { closeWithDeadline } from "../src/services/shutdown.js";

afterEach(() => vi.useRealTimers());

test("зависшее закрытие HTTP/WS ограничено временем остановки", async () => {
  vi.useFakeTimers();
  const closed = closeWithDeadline(() => new Promise<void>(() => undefined));
  const rejected = expect(closed).rejects.toThrow("shutdown exceeded");
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

test("штатное закрытие не оставляет таймер принудительной остановки", async () => {
  vi.useFakeTimers();
  await closeWithDeadline(async () => undefined);
  expect(vi.getTimerCount()).toBe(0);
});
