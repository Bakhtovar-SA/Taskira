/* Избранные проекты и кросс-проектный поиск (миграция 024): действия стора. Вынесено из store.tsx без изменений
 * поведения (ТЗ 2.3, шаг 2). */
import { useCallback } from "react";
import { issuesApi, projectsApi } from "../api";
import type { SearchResultItem } from "../types";
import type { StoreCtx } from "./ctx";

export function useFavoritesAndSearch({ setData, dataRef, handleApiError, local }: StoreCtx) {
  /* -------- избранные проекты (миграция 024) -------- */
  const toggleFavoriteProject = useCallback(
    (projectId: string) => {
      const isFav = dataRef.current.favoriteProjectIds.includes(projectId);
      // Оптимистично: проект уже виден в переключателе (иначе звёздочки бы не
      // было) — round-trip на toggle не должен ощущаться заметной задержкой,
      // в отличие от мутаций, где сервер реально может отказать по бизнес-правилу.
      // 403 здесь реалистичен только при потере доступа между рендером списка
      // и кликом — откатываем как обычную ошибку.
      setData((prev) => ({
        ...prev,
        favoriteProjectIds: isFav
          ? prev.favoriteProjectIds.filter((id) => id !== projectId)
          : [...prev.favoriteProjectIds, projectId],
      }));
      void (async () => {
        try {
          if (isFav) await projectsApi.unfavorite(projectId);
          else await projectsApi.favorite(projectId);
        } catch (err) {
          setData((prev) => ({
            ...prev,
            favoriteProjectIds: isFav
              ? [...prev.favoriteProjectIds, projectId]
              : prev.favoriteProjectIds.filter((id) => id !== projectId),
          }));
          handleApiError(err, local("Не удалось изменить избранное", "Couldn't update favorites"));
        }
      })();
    },
    [handleApiError],
  );

  /* -------- кросс-проектный поиск (миграция 024) -------- */
  const searchAllProjects = useCallback(
    async (q: string): Promise<{ items: SearchResultItem[]; truncated: boolean }> => {
      try {
        const res = await issuesApi.search(q);
        return { items: res.items as SearchResultItem[], truncated: res.truncated };
      } catch (err) {
        handleApiError(err, local("Не удалось выполнить поиск", "Search failed"));
        return { items: [], truncated: false };
      }
    },
    [handleApiError],
  );

  return { toggleFavoriteProject, searchAllProjects };
}
