/** Данные набора виджетов (ADR-0022): один запрос на весь дашборд. Перезапрос — только когда меняется то, что
 *  влияет на данные (тип, настройки, область), а не место или заголовок: перетаскивание не дёргает сервер. Пока идёт
 *  перезапрос, показывается прошлый результат (без мигания скелетом); при возвращении во вкладку — обновление, если
 *  данные старше минуты. */
import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardsApi, type WidgetDataDto } from "../api";
import type { Widget } from "./catalog";

const STALE_MS = 60_000;

export function dataKey(widgets: Widget[], projectId: string | null): string {
  const spec = widgets.map(({ x, y, w, h, title, ...rest }) => rest);
  return JSON.stringify([projectId, spec]);
}

export interface DashboardDataState {
  results: Record<string, WidgetDataDto>;
  loading: boolean;
  failed: boolean;
  refresh: () => void;
}

export function useDashboardData(widgets: Widget[], projectId: string | null, enabled = true): DashboardDataState {
  const key = dataKey(widgets, projectId);
  const [state, setState] = useState<{ results: Record<string, WidgetDataDto>; loading: boolean; failed: boolean }>({ results: {}, loading: true, failed: false });
  const [tick, setTick] = useState(0);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  const at = useRef(0);
  const gen = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    const my = ++gen.current;
    setState((s) => ({ ...s, loading: true }));
    // Небольшая задержка: правка настроек подряд (заголовок, период) — один запрос, а не серия.
    const delay = first.current ? 0 : 200;
    first.current = false;
    const timer = window.setTimeout(() => {
      dashboardsApi.data(widgetsRef.current, projectId ?? undefined).then(
        (r) => {
          if (gen.current !== my) return;
          at.current = Date.now();
          setState({ results: r.results, loading: false, failed: false });
        },
        () => {
          if (gen.current !== my) return;
          setState((s) => ({ ...s, loading: false, failed: true }));
        },
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [key, tick, enabled, projectId]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible" && at.current && Date.now() - at.current > STALE_MS) setTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, refresh };
}
