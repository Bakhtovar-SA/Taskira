/* CRUD задач: создание, массовый импорт, правка, смена статуса, удаление — действия стора. Вынесено из store.tsx без
 * изменений поведения (ТЗ 2.3, шаг 5). Действия не оптимистичны: сначала запрос, затем применение ответа сервера;
 * откат с перечитыванием задач — только у moveStatus. Поведение зафиксировано store.issueCrud.test.tsx. */
import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Issue } from "../types";
import { LIMITS, sanitizeText, localizeValidationError, validateLabels, validateTitle } from "../validation";
import { ApiError, issuesApi } from "../api";
import {
  buildCreatePayload,
  canTransition,
  emptyData,
  mapIssue,
  patchParentSubtasksSummary,
  statusById,
} from "./mappers";
import type { CreateInput } from "./mappers";
import type { StoreCtx } from "./ctx";
import type { UIState } from "./mappers";

export interface IssueCrudDeps {
  withIssue: (id: string, fn: (issue: Issue) => void) => void;
  resolveIssue: (id: string, opts?: { silent?: boolean }) => Promise<Issue | null>;
  refreshIssues: () => Promise<void>;
  setUi: Dispatch<SetStateAction<UIState>>;
  bumpIssues: () => void;
  bumpEpics: () => void;
  langRef: MutableRefObject<"ru" | "en">;
}

export function useIssueCrudActions(
  { setData, dataRef, pid, toast, handleApiError, requirePerm, local }: StoreCtx,
  { withIssue, resolveIssue, refreshIssues, setUi, bumpIssues, bumpEpics, langRef }: IssueCrudDeps,
) {
  const createIssue = useCallback(
    (input: CreateInput) => {
      if (!requirePerm("create")) return;
      const payload = buildCreatePayload(input);
      if (!payload.ok) return toast("error", localizeValidationError(payload.error, langRef.current));
      const requestProjectId = pid();
      const requestWorkflow = dataRef.current.workflow;

      void (async () => {
        try {
          const dto = await issuesApi.create(requestProjectId, payload.body);
          const issue = mapIssue(dto);
          const isDone = statusById(requestWorkflow, issue.statusId)?.category === "done";
          setData((prev) => {
            if (prev.currentProjectId !== requestProjectId) return prev;
            return {
              ...prev,
              issues: patchParentSubtasksSummary([...prev.issues, issue], issue.parentId, {
              total: 1,
              done: isDone ? 1 : 0,
              }),
            };
          });
          bumpIssues();
          if (dto.epicId) bumpEpics();
          // Закрывать (или нет) модалку — решение вызывающего компонента, не
          // этого коллбэка: CreateIssueModal сам решает это синхронно, ДО
          // резолва этого промиса, по чекбоксу «создать ещё одну следом».
          // Раньше createOpen:false здесь стирал это решение уже ПОСЛЕ
          // ответа сервера, так что чекбокс не мог удержать модалку открытой
          // ни при каких обстоятельствах (ревью PR #46).
          if (dataRef.current.currentProjectId === requestProjectId) {
            setUi((u) => ({ ...u, lastEvent: { issueId: issue.id, ts: Date.now() } }));
          }
          toast("success", local(`${issue.key} создана`, `${issue.key} created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать задачу", "Couldn't create the issue"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /** Массовое создание (импорт из Trello и т.п.) — тем же POST /issues, что
   *  и обычное создание, по одному запросу на карточку: переиспользует все
   *  права/валидацию сервера как есть, без отдельного bulk-эндпоинта и его
   *  риска (untested parsing чужого формата на сервере). Один итоговый тост
   *  вместо одного на карточку — иначе импорт полусотни карточек тонет в
   *  собственных уведомлений об успехе. onProgress — необязательный колбэк
   *  для UI-прогресса импорта (например, «12 / 47»); isCancelled — необязательный
   *  колбэк, проверяемый перед каждой карточкой: закрытие/отмена модалки на
   *  клиенте не тянет за собой этот цикл автоматически (он живёт в сторе, не
   *  в компоненте), поэтому без явной проверки импорт продолжал бы тихо слать
   *  запросы в фоне после того, как пользователь решил, что отменил его
   *  (ревью PR #48). setData вызывается один раз после цикла, а не на каждую
   *  успешную карточку — иначе N карточек дают N ре-рендеров стора с O(N)
   *  копированием списка задач на каждом, то есть O(N²) суммарно (тоже
   *  ревью PR #48). */
  const importIssues = useCallback(
    async (
      inputs: CreateInput[],
      onProgress?: (done: number, total: number) => void,
      isCancelled?: () => boolean,
    ): Promise<{ ok: number; failed: number; cancelled: boolean }> => {
      if (!requirePerm("create")) return { ok: 0, failed: inputs.length, cancelled: false };
      const requestProjectId = pid();
      let ok = 0;
      let failed = 0;
      let stoppedByAuth = false;
      let stoppedByPermission = false;
      let cancelled = false;
      const created: Issue[] = [];
      // Дедуп по тексту причины — иначе один и тот же отказ на 40 карточках
      // дал бы 40 одинаковых тостов подряд; при этом каждая причина попадает
      // в консоль, а не молча тонет в агрегате "не удалось: N" — включая
      // локальные отказы валидации (buildCreatePayload), не только серверные
      // (ревью PR #48, третий раунд — раньше это правило держалось только для
      // карточек, дошедших до issuesApi.create()).
      const toastedErrors = new Set<string>();
      const reportLocalFailure = (reason: string) => {
        console.error("importIssues: карточка не прошла локальную проверку", reason);
        if (!toastedErrors.has(reason)) {
          toastedErrors.add(reason);
          toast("error", reason);
        }
      };

      for (const input of inputs) {
        if (dataRef.current.currentProjectId !== requestProjectId) {
          cancelled = true;
          break;
        }
        if (isCancelled?.()) {
          cancelled = true;
          break;
        }
        const payload = buildCreatePayload(input);
        if (payload.ok) {
          try {
            const dto = await issuesApi.create(requestProjectId, payload.body);
            created.push(mapIssue(dto));
            ok++;
          } catch (err) {
            failed++;
            console.error("importIssues: не удалось создать карточку", err);
            const isAuth = err instanceof ApiError && err.status === 401;
            // 403 — та же логика остановки, что 401: если права отозвали/сменили
            // посреди импорта (роль понижена, вывели из проекта), все оставшиеся
            // карточки упадут тем же кодом — это отказ сессии в целом, а не
            // "эта одна карточка плохая" (ревью PR #48).
            const isPerm = err instanceof ApiError && err.status === 403;
            if (isAuth) {
              handleApiError(err);
            } else if (err instanceof ApiError) {
              const errorKey = `${err.code}:${err.message}`;
              if (!toastedErrors.has(errorKey)) {
                toastedErrors.add(errorKey);
                handleApiError(err, local("Не удалось импортировать задачу", "Couldn't import the issue"));
              }
            }
            if (isAuth || isPerm) {
              stoppedByAuth = isAuth;
              stoppedByPermission = isPerm;
              failed += inputs.length - ok - failed;
              onProgress?.(inputs.length, inputs.length);
              break;
            }
          }
        } else {
          failed++;
          reportLocalFailure(localizeValidationError(payload.error, langRef.current));
        }
        onProgress?.(ok + failed, inputs.length);
      }

      // При 401 handleApiError() уже синхронно сбросил data в emptyData()
      // (сессия истекла, экран уходит на LoginForm) — сливать created поверх
      // этого сброса нельзя: итог был бы {...emptyData(), issues:[...created]},
      // форма, которую больше никто не производит и никто не читает после
      // разлогина. При 403 сессия остаётся рабочей, created применяем как
      // обычно (ревью PR #48, третий раунд).
      if (created.length > 0 && !stoppedByAuth) {
        setData((prev) =>
          prev.currentProjectId === requestProjectId ? { ...prev, issues: [...prev.issues, ...created] } : prev,
        );
        bumpIssues();
      }
      if (cancelled) {
        toast("info", local(`Импорт остановлен: ${ok} из ${inputs.length} успели создаться`, `Import stopped: ${ok} of ${inputs.length} were created`));
      } else if (stoppedByPermission) {
        // Причина отказа уже показана выше (дедуп по err.message) — здесь
        // только итог по количеству, симметрично ветке cancelled: без этого
        // пользователь не видел, сколько карточек успело создаться до потери
        // доступа (ревью PR #48, третий раунд).
        toast("info", local(`Импорт остановлен: ${ok} из ${inputs.length} успели создаться — доступ отозван`, `Import stopped: ${ok} of ${inputs.length} were created — access was revoked`));
      } else if (!stoppedByAuth) {
        toast(failed === 0 ? "success" : "info", local(`Импортировано ${ok} из ${inputs.length}${failed ? `, не удалось: ${failed}` : ""}`, `Imported ${ok} of ${inputs.length}${failed ? `, failed: ${failed}` : ""}`));
      }
      return { ok, failed, cancelled };
    },
    [requirePerm, toast, handleApiError],
  );

  const updateIssue = useCallback(
    (id: string, patch: Partial<Issue>) => {
      withIssue(id, (iss) => {
        if (!requirePerm("edit", iss)) return;

        const body: Record<string, unknown> = {};
        if (patch.title !== undefined) {
          const r = validateTitle(patch.title);
          if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
          body.title = r.value;
        }
        if (patch.description !== undefined) body.description = sanitizeText(patch.description, LIMITS.description.max);
        if (patch.labels !== undefined) {
          const r = validateLabels(patch.labels);
          if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
          body.labels = r.value;
        }
        if (patch.complexity !== undefined) body.complexity = patch.complexity;
        if (patch.priorityId !== undefined) body.priorityId = patch.priorityId;
        if (patch.assigneeIds !== undefined) body.assigneeIds = patch.assigneeIds;
        if (patch.epicId !== undefined) body.epicId = patch.epicId;
        if (patch.dueDate !== undefined) body.dueDate = patch.dueDate;
        if (patch.tStart !== undefined) body.tStart = patch.tStart;
        if (patch.tSpan !== undefined) body.tSpan = patch.tSpan;
        if (patch.color !== undefined) body.color = patch.color;

        if (Object.keys(body).length === 0) return;

        void (async () => {
          try {
            const dto = await issuesApi.patch(pid(), id, body);
            setData((prev) => ({
              ...prev,
              issues: prev.issues.map((i) => (i.id === id ? mapIssue(dto, i) : i)),
            }));
            bumpIssues();
            if (body.epicId !== undefined || body.title !== undefined || body.color !== undefined) bumpEpics();
          } catch (err) {
            handleApiError(err, local("Не удалось сохранить задачу", "Couldn't save the issue"));
          }
        })();
      });
    },
    [requirePerm, toast, handleApiError, withIssue, bumpIssues],
  );

  const moveStatus = useCallback(
    (issueId: string, toStatus: string, beforeId?: string | null) => {
      withIssue(issueId, (iss) => {
        if (!requirePerm("transition", iss)) return;
        const wf = dataRef.current.workflow;
        const requestProjectId = pid();
        if (iss.statusId !== toStatus && !canTransition(wf, iss.statusId, toStatus)) {
          const fromN = statusById(wf, iss.statusId)?.name ?? iss.statusId;
          const toN = statusById(wf, toStatus)?.name ?? toStatus;
          toast("error", local(`Переход «${fromN} → ${toN}» запрещён рабочим процессом`, `The “${fromN} → ${toN}” transition is not allowed by the workflow`));
          return;
        }
        void (async () => {
          try {
            const dto = await issuesApi.transition(requestProjectId, issueId, toStatus, beforeId);
            const wasDone = iss.doneAt != null;
            const nowDone = dto.doneAt != null;
            setData((prev) => {
              if (prev.currentProjectId !== requestProjectId) return prev;
              return {
                ...prev,
                issues: patchParentSubtasksSummary(
                  prev.issues.map((i) => (i.id === issueId ? mapIssue(dto, i) : i)),
                  iss.parentId,
                  wasDone === nowDone ? {} : { done: nowDone ? 1 : -1 },
                ),
              };
            });
            bumpIssues();
            if (dataRef.current.currentProjectId === requestProjectId) {
              setUi((u) => ({ ...u, lastEvent: { issueId, ts: Date.now() } }));
            }
          } catch (err) {
            handleApiError(err, local("Не удалось сменить статус", "Couldn't change the status"));
            void refreshIssues();
          }
        })();
      });
    },
    [requirePerm, toast, handleApiError, refreshIssues, withIssue, bumpIssues],
  );

  const deleteIssue = useCallback(
    (issueId: string) => {
      if (!requirePerm("delete")) return;
      void (async () => {
        try {
          // Стор может быть частичным: задачи в нём нет, если её не открывали и не показывали.
          // Подпись в тосте и поправка счётчика подзадач у родителя берутся из самой задачи,
          // поэтому сначала подтягиваем её точечно (не тихий пропуск, если её просто не загрузили).
          const iss = dataRef.current.issues.find((i) => i.id === issueId) ?? (await resolveIssue(issueId, { silent: true })) ?? undefined;
          await issuesApi.remove(pid(), issueId);
          setData((prev) => ({
            ...prev,
            // parent_id — тот же ON DELETE SET NULL, что epic_id (миграция 021);
            // без зеркального обнуления здесь бывшие подзадачи держат в памяти
            // parentId, указывающий на только что удалённую (отфильтрованную
            // строкой выше) задачу — до перезагрузки карточки badge рендерит
            // "подзадача ?" и «+ добавить подзадачу» остаётся скрытой, хотя
            // подзадача уже стала обычной задачей (ревью PR #46).
            issues: patchParentSubtasksSummary(
              prev.issues
                .filter((i) => i.id !== issueId)
                .map((i) => (i.epicId === issueId ? { ...i, epicId: null } : i))
                .map((i) => (i.parentId === issueId ? { ...i, parentId: null } : i)),
              iss?.parentId,
              { total: -1, done: iss?.doneAt ? -1 : 0 },
            ),
          }));
          bumpIssues();
          bumpEpics();
          setUi((u) => ({ ...u, selectedIssueId: u.selectedIssueId === issueId ? null : u.selectedIssueId }));
          if (iss) toast("info", local(`${iss.key} удалена`, `${iss.key} deleted`));
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, resolveIssue, toast, handleApiError],
  );

  return {
    createIssue,
    importIssues,
    updateIssue,
    moveStatus,
    deleteIssue,
  };
}
