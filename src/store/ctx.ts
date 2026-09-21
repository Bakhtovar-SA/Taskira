/* Общий контекст доменных хуков стора (ТЗ 2.3): то, что нужно почти каждому домену. Собирается в StoreProvider
 * и передаётся в `useXxxActions(ctx)`. Состояние (`data`, `ui`, …) остаётся в провайдере — здесь только доступ к нему. */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PermId } from "../permissions";
import type { Data, Issue, Toast } from "../types";

export interface StoreCtx {
  setData: Dispatch<SetStateAction<Data>>;
  dataRef: MutableRefObject<Data>;
  /** id текущего проекта (читает dataRef, поэтому не привязан к рендеру). */
  pid: () => string;
  toast: (kind: Toast["kind"], text: string) => void;
  handleApiError: (err: unknown, fallback?: string) => void;
  requirePerm: (perm: PermId, issue?: Issue) => boolean;
  /** RU/EN по текущему языку (читает langRef). */
  local: (ru: string, en: string) => string;
  /** Эпоха сессии (SEC-01): растёт при logout и при 401. Действие, начатое в прошлой эпохе, после `await` ничего не пишет. */
  sessionEpochRef: MutableRefObject<number>;
}
