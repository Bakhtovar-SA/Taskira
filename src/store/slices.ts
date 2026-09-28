/**
 * Домены стора, вынесенные из общего контекста во внешние хранилища (ADR-0011, шаги 1–2): тосты и уведомления.
 * Это самые частые фоновые события (тост после любого действия, WS `notify`, опрос счётчика раз в 30 с), и раньше
 * каждое из них давало новый `value` единого контекста — перерисовку всего дерева, включая все карточки доски.
 * Теперь их изменение не трогает `StoreProvider`: перерисовываются только подписчики (`Toasts`, `Bell`, лента).
 *
 * Хранилища создаются на каждый `StoreProvider` (а не модульными синглтонами) — тесты и возможные несколько
 * провайдеров не делят состояние. Доступ — через `SlicesCtx`, чьё значение стабильно всё время жизни провайдера.
 */
import { createContext, useContext } from "react";
import type { NotificationT, Toast } from "../types";
import { createExternalStore, useExternalStore, type ExternalStore } from "./external";

/** Лента уведомлений текущего пользователя (первая страница) + счётчик непрочитанных на сервере. */
export interface NotificationsState {
  notifications: NotificationT[];
  unreadCount: number;
}

export const EMPTY_NOTIFICATIONS: NotificationsState = { notifications: [], unreadCount: 0 };

export interface StoreSlices {
  toasts: ExternalStore<Toast[]>;
  notifications: ExternalStore<NotificationsState>;
}

export function createSlices(): StoreSlices {
  return {
    toasts: createExternalStore<Toast[]>([]),
    notifications: createExternalStore<NotificationsState>(EMPTY_NOTIFICATIONS),
  };
}

export const SlicesCtx = createContext<StoreSlices | null>(null);

function useSlices(): StoreSlices {
  const s = useContext(SlicesCtx);
  if (!s) throw new Error("useToasts/useNotifications вне StoreProvider");
  return s;
}

/** Показанные сейчас тосты (не больше четырёх). Показать тост — `useStore().toast` (стабильная функция). */
export function useToasts(): Toast[] {
  return useExternalStore(useSlices().toasts);
}

/** Лента уведомлений и счётчик непрочитанных. Действия (`markNotificationsRead`, …) — в `useStore()`. */
export function useNotifications(): NotificationsState {
  return useExternalStore(useSlices().notifications);
}

const selectUnread = (s: NotificationsState) => s.unreadCount;

/** Только счётчик непрочитанных: подписчик не перерисовывается, когда меняется лента при том же числе. */
export function useUnreadCount(): number {
  return useExternalStore(useSlices().notifications, selectUnread);
}
