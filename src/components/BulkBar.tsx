/** Панель массовых действий (ТЗ 3.3): статус, исполнитель, приоритет, удаление — для выделенных задач.
 *  Одна на «Список задач» и доску (ROUTE-03). Права проверяет сервер на каждую задачу (частичный успех);
 *  итог показывает тост стора. Доска грузит панель лениво — первый экран без неё. */
import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { PRIORITY_ORDER } from "../types";
import { assignableUsers } from "../store/mappers";
import { workflowStatusName } from "../workflowStatus";
import { IcChevD, IcChevR, IcTrash, IcX, IcFlag, IcUsers, PriorityIcon, StatusGlyph } from "../icons";
import { Button, Dialog, IconButton, Menu, Popover, type MenuEntry } from "../ds";
import { UserAvatar } from "./UserAvatar";
import { cancelBoardFlip, renewBoardFlip } from "../boardFlip";

/** `onBeforeStatus` — доска делает снимок положений карточек перед массовой сменой статуса (`snapshotBoard`): после ответа
 *  карточки перелетают в новые колонки (ADR-0035, `boardFlip.ts`), а не просто появляются. */
export default function BulkBar({ selectedIds, onDone, className = "", floating = false, onBeforeStatus }: { selectedIds: ReadonlySet<string>; onDone: () => void; className?: string; floating?: boolean; onBeforeStatus?: () => object | null }) {
  const { t } = useT();
  const { data, me, can, bulkApplyIssueAction } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = [...selectedIds];

  const run = async (body: Parameters<typeof bulkApplyIssueAction>[0]) => {
    setBusy(true);
    const flip = body.action === "status" && can("transition") ? (onBeforeStatus?.() ?? null) : null;
    try {
      const res = await bulkApplyIssueAction(body);
      // Ничего не изменилось (отказ или все пропущены) — снимок не нужен, иначе чужой коммит анимировался бы от него.
      if (flip && (!res || res.succeeded.length === 0)) cancelBoardFlip(flip);
      else renewBoardFlip(flip);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
      onDone();
    }
  };
  const menu = (label: string, items: MenuEntry[]) => (
    <Menu
      label={label}
      items={items}
      trigger={(p) => (
        <Button {...p} size="sm" variant={floating ? "ghost" : "secondary"} disabled={busy} iconLeft={floating ? (label === t("field.status") ? <StatusGlyph category="todo" size={16} /> : label === t("field.assignee") ? <IcUsers size={16} /> : <IcFlag size={16} />) : undefined} iconRight={floating ? <IcChevR size={14} /> : <IcChevD size={12} />}>
          {label}
        </Button>
      )}
    />
  );

  const controls = <>
        {(!floating || can("transition")) && menu(
          t("field.status"),
          data.workflow.statuses.map((s) => ({ id: s.id, label: workflowStatusName(s, t), icon: <StatusGlyph category={s.category} size={16} />, onSelect: () => void run({ action: "status", issueIds: ids, statusId: s.id }) })),
        )}
        {(!floating || can("edit")) && menu(t("field.assignee"), [
          { id: "none", label: t(me.accessRole === "employee" ? "assignee.unassignSelf" : "createIssue.unassigned"), icon: <span aria-hidden="true"><UserAvatar user={null} size={18} /></span>, onSelect: () => void run({ action: "assignee", issueIds: ids, assigneeId: "none" }) },
          ...assignableUsers(data).filter(u => me.accessRole !== "employee" || u.id === me.id).map((u) => ({ id: u.id, label: u.name, text: u.name, icon: <span aria-hidden="true"><UserAvatar user={u} size={18} /></span>, onSelect: () => void run({ action: "assignee", issueIds: ids, assigneeId: u.id }) })),
        ])}
        {(!floating || can("edit")) && menu(
          t("field.priority"),
          PRIORITY_ORDER.map((p) => ({ id: p, label: t(`priority.${p}`), icon: <span aria-hidden="true"><PriorityIcon p={p} size={16} /></span>, onSelect: () => void run({ action: "priority", issueIds: ids, priorityId: p }) })),
        )}
        {can("delete") && (
          <Button size="sm" variant="danger" className={floating ? "bulk-delete" : undefined} disabled={busy} iconLeft={<IcTrash size={14} />} onClick={() => setConfirmDelete(true)}>
            {t("common.delete")}
          </Button>
        )}
      </>;

  const toolbar = (
    <div role="toolbar" aria-label={t("backlog.selectedCount", { n: selectedIds.size })} className={floating ? "list-bulk-bar pointer-events-auto flex items-center whitespace-nowrap rounded-full bg-panel shadow-e3" : `flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accentsoft/40 px-2.5 py-2 ${className}`}>
      <span role="status" aria-live="polite" aria-atomic="true" className="text-[13.5px] font-semibold text-ink">{t("backlog.selectedCount", { n: selectedIds.size })}</span>
      {floating ? <Popover label={t("common.actions")} placement="top-start" className="bulk-action-menu"
        trigger={p => <Button {...p} size="sm" disabled={busy} iconRight={<IcChevD size={12} />}>{t("common.actions")}</Button>}>
        <div className="ds-menu-label">{t("common.actions")}</div><div className="bulk-actions">{controls}</div>
      </Popover> : controls}
      {floating ? <IconButton label={t("common.clear")} size="sm" disabled={busy} onClick={onDone}><IcX size={16} /></IconButton> : <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
        {t("common.clear")}
      </Button>}
    </div>
  );

  return (
    <>
      {floating ? <div className="list-selection-dock pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center">{toolbar}</div> : toolbar}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="md"
        title={t("backlog.confirmBulkDeleteTitle")}
        description={t("backlog.confirmBulkDeleteBody", { n: selectedIds.size })}
        footer={
          <>
            <Button variant="ghost" data-autofocus onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void run({ action: "delete", issueIds: ids })}>
              {t("common.delete")}
            </Button>
          </>
        }
      />
    </>
  );
}
