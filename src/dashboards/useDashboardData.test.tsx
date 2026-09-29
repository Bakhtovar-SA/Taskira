import { afterEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ApiError, dashboardsApi, type DashboardWidget } from "../api";
import { useDashboardData } from "./useDashboardData";

const w = (id: string, metric: "open" | "overdue" = "open"): DashboardWidget => ({ id, type: "count", metric, periodDays: 30, x: 0, y: 0, w: 3, h: 2 });
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

afterEach(() => vi.restoreAllMocks());

describe("данные дашборда", () => {
  test("не больше одного запроса в полёте: правка во время расчёта ждёт ответа и уходит следом", async () => {
    let resolveFirst!: (v: { results: Record<string, never> }) => void;
    const spy = vi
      .spyOn(dashboardsApi, "data")
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValue({ results: {} });
    const { rerender } = renderHook(({ ws }) => useDashboardData(ws, "p1"), { initialProps: { ws: [w("a")] } });
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    rerender({ ws: [w("a", "overdue")] });
    await tick(250);
    expect(spy).toHaveBeenCalledTimes(1); // первый ещё считается
    resolveFirst({ results: {} });
    await tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0][0]).toMatchObject({ metric: "overdue" });
  });

  test("429 от сервера — один тихий повтор, без ошибки на экране", async () => {
    const spy = vi.spyOn(dashboardsApi, "data").mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "занято")).mockResolvedValue({ results: {} });
    const { result } = renderHook(() => useDashboardData([w("a")], null));
    await tick(1100);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.failed).toBe(false);
  });
});
