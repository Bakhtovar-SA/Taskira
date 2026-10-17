import type { IssueUndoDto } from "../../server/src/contract";
import type { Toast } from "../types";
import { ApiError, issuesApi, type ServerIssue } from "../api";
import { snapshotBoard, renewBoardFlip, restoreCardFocus } from "../boardFlip";
import { canTransition, mapIssue, patchParentSubtasksSummary } from "./mappers";
import type { StoreCtx } from "./ctx";
import type { IssueCrudDeps } from "./issueCrud";

/** Track O D-07: keep for one release, then remove the rollout switch after owner review. */
export const ENABLE_ISSUE_UNDO = true;
type Context = Pick<StoreCtx, "dataRef" | "pid" | "setData" | "toast" | "local" | "sessionEpochRef" | "requirePerm" | "handleApiError">;
type Deps = Pick<IssueCrudDeps, "bumpIssues" | "setUi" | "resolveIssue">;

export function createIssueUndo(ctx: Context, deps: Deps, changes: readonly (IssueUndoDto & {currentStatusId?:string})[] = []): Toast["action"] {
  const {dataRef,pid,setData,toast,local,sessionEpochRef,requirePerm,handleApiError} = ctx;
  let remaining = changes.filter(change => !change.statusId || canTransition(dataRef.current.workflow,
    change.currentStatusId ?? dataRef.current.issues.find(issue => issue.id === change.issueId)?.statusId ?? "", change.statusId));
  if (!ENABLE_ISSUE_UNDO || !remaining.length) return undefined;
  const project = pid(), epoch = sessionEpochRef.current;
  const active = () => pid() === project && sessionEpochRef.current === epoch;
  let running = false;
  return { label: local("Отменить", "Undo"), run: async () => {
    if (running) return false;
    if (!active()) { toast("info",local("Отмена недоступна после смены проекта или сессии", "Undo is unavailable after changing project or session")); return true; }
    running = true;
    const intentFocus = document.activeElement;
    const retry: IssueUndoDto[] = [], applied: ServerIssue[] = [];
    let skipped = 0;
    try {
      for (const change of remaining) {
        if (!active()) return true;
        try {
          const issue = dataRef.current.issues.find(issue => issue.id === change.issueId) ?? await deps.resolveIssue(change.issueId,{silent:true});
          if (!active()) return true;
          if (!issue || issue.updatedAt > Date.parse(change.updatedAt) || !requirePerm(change.statusId ? "transition" : "edit",issue)
            || change.statusId && !canTransition(dataRef.current.workflow,issue.statusId,change.statusId)) { skipped++; continue; }
          const dto = change.statusId
            ? await issuesApi.transition(project,change.issueId,change.statusId,null,change.updatedAt)
            : await issuesApi.patch(project,change.issueId,{ expectedUpdatedAt:change.updatedAt,
              ...(change.labels ? {labels:change.labels} : {}), ...(change.assigneeIds ? {assigneeIds:change.assigneeIds} : {}) });
          if (!active()) return true;
          applied.push(dto);
        } catch (error) {
          if (!active()) return true;
          if (error instanceof ApiError && error.status === 401) { handleApiError(error); return true; }
          if (error instanceof ApiError && [400,403,404,409].includes(error.status)) skipped++;
          else retry.push(change);
        }
      }
      if (applied.length) {
        const root = document.querySelector<HTMLElement>(".board-view");
        const statusIds = applied.filter(dto => changes.some(change => change.issueId === dto.id && change.statusId)).map(dto => dto.id);
        const before = intentFocus;
        const stale = root?.querySelector(`article[data-issue-id="${CSS.escape(statusIds[0] ?? "")}"] .board-card-open`) ?? null;
        const owner = statusIds.length ? snapshotBoard(root,statusIds.length === 1 ? statusIds[0] : null) : null;
        if (statusIds.length > 1) renewBoardFlip(owner);
        setData(prev => {
          let issues = prev.issues;
          for (const dto of applied) {
            const old = issues.find(issue => issue.id === dto.id);
            if (!old || old.updatedAt > Date.parse(dto.updatedAt)) continue;
            issues = patchParentSubtasksSummary(issues.map(issue => issue.id === dto.id ? mapIssue(dto,issue) : issue),old.parentId,
              (old.doneAt != null) === (dto.doneAt != null) ? {} : {done:dto.doneAt != null ? 1 : -1});
          }
          return {...prev,issues};
        });

        if (statusIds.length) {
          deps.setUi(ui => ({...ui,lastEvent:{issueId:statusIds[0],ts:Date.now()}}));
          if (root) restoreCardFocus(root,statusIds[0],before,stale);
        }
      }
      if (applied.length || skipped) deps.bumpIssues();
      if (skipped) toast("info",local(`Отменено: ${applied.length}. Изменённые или недоступные задачи пропущены: ${skipped}`,
        `Undone: ${applied.length}. Changed or unavailable issues skipped: ${skipped}`));
      else if (applied.length) toast("success",local("Изменение отменено", "Change undone"));
      if (retry.length) toast("error",local("Не удалось отменить изменение — повторите попытку", "Couldn't undo the change. Try again"));
      remaining = retry;
      return !remaining.length;
    } finally { running = false; }
  } };
}
