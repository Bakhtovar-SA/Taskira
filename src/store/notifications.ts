/* Уведомления (миграция 011), настройки уведомлений и аватар текущего пользователя — действия стора. Вынесено из
 * store.tsx без изменений поведения (ТЗ 2.3, шаг 4). */
import { useCallback } from "react";
import type { NotifyPrefsT, User } from "../types";
import { avatarApi, invalidateAvatarBlobUrl, notificationsApi, type NotifyPrefs } from "../api";
import { applyNotificationAction, mapNotification } from "./mappers";
import type { StoreCtx } from "./ctx";

export function useNotificationActions({ setData, dataRef, toast, handleApiError, local }: StoreCtx) {
  /* -------- уведомления (миграция 011) -------- */

  const refreshNotifications = useCallback(async () => {
    try {
      const [res, unread] = await Promise.all([notificationsApi.list(), notificationsApi.unreadCount()]);
      setData((prev) => ({ ...prev, notifications: res.items.map(mapNotification), unreadCount: unread.count }));
    } catch {
      /* тихо — колокол не критичен */
    }
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const { count } = await notificationsApi.unreadCount();
      setData((prev) => (prev.unreadCount === count ? prev : { ...prev, unreadCount: count }));
    } catch {
      /* тихо */
    }
  }, []);

  const markNotificationsRead = useCallback((ids?: string[]) => {
    void (async () => {
      try {
        await notificationsApi.markRead(ids);
        setData((prev) => applyNotificationAction(prev, ids, "read"));
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [handleApiError]);

  /** Скрыть уведомления из СВОЕЙ ленты (мягко, dismissed_at на сервере) — не
   *  затрагивает чужие уведомления и аудит-след. Без ids — скрыть все свои. */
  const dismissNotifications = useCallback((ids?: string[]) => {
    void (async () => {
      try {
        await notificationsApi.dismiss(ids);
        setData((prev) => applyNotificationAction(prev, ids, "dismiss"));
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [handleApiError]);

  const setNotifyPrefs = useCallback(
    (patch: NotifyPrefs) => {
      void (async () => {
        try {
          const { notifyPrefs } = await notificationsApi.setPrefs(patch);
          setData((prev) => ({ ...prev, notifyPrefs: notifyPrefs as NotifyPrefsT }));
          toast("success", local("Настройки уведомлений сохранены", "Notification settings saved"));
        } catch (err) {
          handleApiError(err, local("Не удалось сохранить настройки", "Couldn't save settings"));
        }
      })();
    },
    [toast, handleApiError],
  );

  /** Патчит avatarUpdatedAt текущего пользователя в data.users — тот же приём,
   *  что setNotifyPrefs выше, только точечно по одному полю одного User. */
  const patchMyAvatar = useCallback((avatarUpdatedAt: number | null) => {
    invalidateAvatarBlobUrl(dataRef.current.currentUserId);
    setData((prev) => ({
      ...prev,
      users: prev.users.map((u) => (u.id === prev.currentUserId ? { ...u, avatarUpdatedAt } : u)),
    }));
  }, []);

  const uploadAvatar = useCallback(
    async (file: File) => {
      try {
        const { avatarUpdatedAt } = await avatarApi.upload(file);
        patchMyAvatar(avatarUpdatedAt);
        toast("success", local("Аватарка обновлена", "Profile photo updated"));
      } catch (err) {
        handleApiError(err, local("Не удалось загрузить аватарку", "Couldn't upload the profile photo"));
      }
    },
    [toast, handleApiError, patchMyAvatar],
  );

  const removeAvatar = useCallback(async () => {
    try {
      await avatarApi.remove();
      patchMyAvatar(null);
      toast("success", local("Аватарка удалена", "Profile photo removed"));
    } catch (err) {
      handleApiError(err, local("Не удалось удалить аватарку", "Couldn't remove the profile photo"));
    }
  }, [toast, handleApiError, patchMyAvatar]);

  return {
    refreshNotifications,
    refreshUnreadCount,
    markNotificationsRead,
    dismissNotifications,
    setNotifyPrefs,
    uploadAvatar,
    removeAvatar,
  };
}
