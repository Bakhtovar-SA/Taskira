/* Спринты (миграция 023, опциональный модуль — SPRINTS_MIGRATION.md): действия стора. Вынесено из store.tsx без
 * изменений поведения (ТЗ 2.3, шаг 2). */
import { useCallback } from "react";
import { issuesApi, sprintsApi } from "../api";
import { mapIssue, mapSprint } from "./mappers";
import type { StoreCtx } from "./ctx";

export function useSprintActions({ setData, pid, toast, handleApiError, requirePerm, local }: StoreCtx) {
  /* -------- спринты (миграция 023, опциональный модуль — SPRINTS_MIGRATION.md) --------
     Права manageSprints — тем же проверяет и сервер; requirePerm здесь только
     ради мгновенной UX-реакции (скрытые кнопки и т.п.), источник истины — 403. */
  const addSprint = useCallback(
    (input: { name: string; goal: string; startDate?: string | null; endDate?: string | null }) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const s = await sprintsApi.create(pid(), input);
          setData((prev) => ({ ...prev, sprints: [...prev.sprints, mapSprint(s)] }));
          toast("success", local(`Спринт «${s.name}» создан`, `Sprint “${s.name}” created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать спринт", "Couldn't create the sprint"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const startSprint = useCallback(
    (sprintId: string) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const s = await sprintsApi.start(pid(), sprintId);
          setData((prev) => ({ ...prev, sprints: prev.sprints.map((x) => (x.id === sprintId ? mapSprint(s) : x)) }));
          toast("success", local(`Спринт «${s.name}» начат`, `Sprint “${s.name}” started`));
        } catch (err) {
          handleApiError(err, local("Не удалось начать спринт", "Couldn't start the sprint"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const completeSprint = useCallback(
    (sprintId: string) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const { sprint, movedToBacklog } = await sprintsApi.complete(pid(), sprintId);
          setData((prev) => ({
            ...prev,
            sprints: prev.sprints.map((x) => (x.id === sprintId ? mapSprint(sprint) : x)),
            // Зеркалим перенос незакрытых задач в бэклог локально (сервер уже
            // сделал это одной транзакцией в completeSprint()) — без этого
            // карточки повисли бы в UI на завершённом спринте до следующего
            // bootstrap()/openIssue(). Закрытые (doneAt≠null) сервер не трогает.
            issues: prev.issues.map((i) => (i.sprintId === sprintId && i.doneAt == null ? { ...i, sprintId: null } : i)),
          }));
          toast(
            movedToBacklog > 0 ? "info" : "success",
            local(
              `Спринт «${sprint.name}» завершён${movedToBacklog > 0 ? `, в бэклог перенесено: ${movedToBacklog}` : ""}`,
              `Sprint “${sprint.name}” completed${movedToBacklog > 0 ? `; moved to backlog: ${movedToBacklog}` : ""}`,
            ),
          );
        } catch (err) {
          handleApiError(err, local("Не удалось завершить спринт", "Couldn't complete the sprint"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const setIssueSprint = useCallback(
    (issueId: string, sprintId: string | null) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const dto = await issuesApi.setSprint(pid(), issueId, sprintId);
          setData((prev) => ({ ...prev, issues: prev.issues.map((i) => (i.id === issueId ? mapIssue(dto, i) : i)) }));
        } catch (err) {
          handleApiError(err, local("Не удалось изменить спринт задачи", "Couldn't change the issue sprint"));
        }
      })();
    },
    [requirePerm, handleApiError],
  );

  return { addSprint, startSprint, completeSprint, setIssueSprint };
}
