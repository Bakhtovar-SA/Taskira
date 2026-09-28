import { lazy, type ComponentType } from "react";

/**
 * Ленивые модалки задачи с предзагрузкой (PERF-BUDGET п. 3: «открытие задачи < 150 мс»; первое открытие было
 * ~380 мс против ~85 мс у повторного).
 *
 * Чанк по-прежнему грузится через `lazy()` и в начальный бандл не входит; `preload()` лишь запускает тот же импорт
 * раньше — в простое после входа и при наведении/фокусе на карточке. Если к первому рендеру модуль уже загружен,
 * `lazy()` разрешается в той же задаче и Suspense не показывает фолбэк; без предзагрузки первый клик ждал сеть и
 * разбор чанка, а раскрытие содержимого после фолбэка React ещё и притормаживает (throttling раскрытия Suspense,
 * ~300 мс) — отсюда разница первого и повторного открытия. Замер: docs/design/PERF-BUDGET.md.
 */
export function lazyWithPreload<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>) {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const load = () =>
    (pending ??= factory().catch((err: unknown) => {
      pending = null; // сеть моргнула — следующая попытка (наведение, клик) загрузит заново
      throw err;
    }));
  /** Загрузить чанк заранее; ошибка глушится — при настоящем открытии `lazy()` попробует снова и покажет её. */
  const preload = (): void => {
    void load().catch(() => undefined);
  };
  return Object.assign(lazy(load), { preload });
}

export const IssueModal = lazyWithPreload(() => import("./components/IssueModal"));
export const CreateIssueModal = lazyWithPreload(() => import("./components/CreateIssueModal"));

/** Для `onPointerEnter`/`onFocus` карточек: к клику чанк карточки задачи уже загружен. */
export const preloadIssueModal = IssueModal.preload;

/**
 * Предзагрузить обе модалки, когда браузер простаивает (после отрисовки первого экрана), чтобы первое открытие
 * задачи или формы создания не ждало сеть и разбор чанка. Возвращает отмену.
 */
export function preloadModalsWhenIdle(): () => void {
  const run = () => {
    IssueModal.preload();
    CreateIssueModal.preload();
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}
