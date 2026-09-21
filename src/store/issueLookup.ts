/* Точечная подгрузка задачи по id и выполнение действия с задачей (`resolveIssue`, `lookupIssue`, `withIssue`) — вынесено
 * из store.tsx без изменений поведения (ТЗ 2.3, шаг 6). */
import { useCallback } from "react";
import type { Issue } from "../types";
import { ApiError, issuesApi } from "../api";
import { mapIssue, upsertIssue } from "./mappers";
import type { StoreCtx } from "./ctx";

export function useIssueLookup({ setData, dataRef, pid, toast, handleApiError, local }: StoreCtx) {
  const resolveIssue = useCallback(
    async (id: string, opts: { silent?: boolean } = {}): Promise<Issue | null> => {
      const known = dataRef.current.issues.find((i) => i.id === id);
      if (known) return known;
      const requestProjectId = pid();
      if (!requestProjectId) return null; // SEC-01: нет проекта/сессии — грузить нечего
      try {
        const mapped = mapIssue(await issuesApi.get(requestProjectId, id));
        setData((prev) =>
          prev.currentProjectId !== requestProjectId || prev.issues.some((x) => x.id === id)
            ? prev
            : { ...prev, issues: upsertIssue(prev.issues, mapped) },
        );
        return mapped;
      } catch (err) {
        // silent — справочные запросы (бейдж эпика/родителя): недоступность не повод для тоста
        if (opts.silent) return null;
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          toast(
            "error",
            local(
              "Задача недоступна: её удалили или у вас больше нет к ней доступа",
              "The issue is unavailable: it was deleted or you no longer have access",
            ),
          );
        } else {
          handleApiError(err, local("Не удалось загрузить задачу", "Couldn't load the issue"));
        }
        return null;
      }
    },
    [toast, local, handleApiError],
  );

  /** Задача по id для отображения (бейджи, справочники): из кэша, иначе точечный GET; без тостов. */
  const lookupIssue = useCallback((id: string) => resolveIssue(id, { silent: true }), [resolveIssue]);

  /** Выполняет `fn` с задачей: сразу, если она известна, иначе после точечной загрузки. */
  const withIssue = useCallback(
    (id: string, fn: (issue: Issue) => void) => {
      const known = dataRef.current.issues.find((i) => i.id === id);
      if (known) fn(known);
      else void resolveIssue(id).then((issue) => issue && fn(issue));
    },
    [resolveIssue],
  );

  return { resolveIssue, lookupIssue, withIssue };
}
