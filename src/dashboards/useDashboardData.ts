/** Данные набора виджетов (ADR-0022): один запрос на весь дашборд. Перезапрос — только когда меняется то, что
 *  влияет на данные (тип, настройки, область), а не место или заголовок: перетаскивание не дёргает сервер. Пока идёт
 *  перезапрос, показывается прошлый результат (без мигания скелетом); при возвращении во вкладку — обновление, если
 *  данные старше минуты. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, dashboardsApi, type WidgetDataDto } from "../api";
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
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const at = useRef(0);
  const gen = useRef(0);
  const first = useRef(true);

  // Не больше одного запроса в полёте: сервер держит не больше двух расчётов на человека (429 сверх), а правки
  // настроек подряд иначе наслаивались бы. Новый ключ, пока идёт запрос, — запомнить и повторить после ответа.
  const busy = useRef(false);
  const pending = useRef(false);
  const run = useCallback(
    (attempt = 0) => {
      if (busy.current) {
        pending.current = true;
        return;
      }
      busy.current = true;
      const my = ++gen.current;
      setState((s) => ({ ...s, loading: true }));
      const finish = () => {
        busy.current = false;
        if (pending.current) {
          pending.current = false;
          run();
        }
      };
      dashboardsApi.data(widgetsRef.current, projectRef.current ?? undefined).then(
        (r) => {
          if (gen.current === my) {
            at.current = Date.now();
            setState({ results: r.results, loading: false, failed: false });
          }
          finish();
        },
        (e: unknown) => {
          busy.current = false;
          // Сервер занят нашим же предыдущим расчётом — один повтор чуть позже, без ошибки на экране.
          if (e instanceof ApiError && e.status === 429 && attempt === 0) {
            window.setTimeout(() => run(1), 1000);
            return;
          }
          if (gen.current === my) setState((s) => ({ ...s, loading: false, failed: true }));
          finish();
        },
      );
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    // Небольшая задержка: правка настроек подряд (заголовок, период) — один запрос, а не серия.
    const delay = first.current ? 0 : 200;
    first.current = false;
    const timer = window.setTimeout(() => run(), delay);
    return () => window.clearTimeout(timer);
  }, [key, tick, enabled, projectId, run]);

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
