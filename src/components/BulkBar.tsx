/** Панель массовых действий (ТЗ 3.3): статус, исполнитель, приоритет, удаление — для выделенных задач.
 *  Одна на «Список задач» и доску (ROUTE-03). Права проверяет сервер на каждую задачу (частичный успех);
 *  итог показывает тост стора. Доска грузит панель лениво — первый экран без неё. */
import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { PRIORITY_ORDER } from "../types";
import { workflowStatusName } from "../workflowStatus";
import { IcChevD, IcTrash } from "../icons";
import { Button, Dialog, Menu, type MenuEntry } from "../ds";

export default function BulkBar({ selectedIds, onDone, className = "" }: { selectedIds: ReadonlySet<string>; onDone: () => void; className?: string }) {
  const { t } = useT();
  const { data, me, can, bulkApplyIssueAction } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = [...selectedIds];

  const run = async (body: Parameters<typeof bulkApplyIssueAction>[0]) => {
    setBusy(true);
    try {
      await bulkApplyIssueAction(body);
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
        <Button {...p} size="sm" disabled={busy} iconRight={<IcChevD size={12} />}>
          {label}
        </Button>
      )}
    />
  );

  return (
    <>
      <div role="toolbar" aria-label={t("backlog.selectedCount", { n: selectedIds.size })} className={`flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accentsoft/40 px-2.5 py-2 ${className}`}>
        <span className="text-[13.5px] font-semibold text-ink">{t("backlog.selectedCount", { n: selectedIds.size })}</span>
        {menu(
          t("field.status"),
          data.workflow.statuses.map((s) => ({ id: s.id, label: workflowStatusName(s, t), onSelect: () => void run({ action: "status", issueIds: ids, statusId: s.id }) })),
        )}
        {menu(t("field.assignee"), [
          { id: "none", label: t("createIssue.unassigned"), onSelect: () => void run({ action: "assignee", issueIds: ids, assigneeId: "none" }) },
          ...data.users.filter(u => me.accessRole !== "employee" || u.id === me.id).map((u) => ({ id: u.id, label: u.name, text: u.name, onSelect: () => void run({ action: "assignee", issueIds: ids, assigneeId: u.id }) })),
        ])}
        {menu(
          t("field.priority"),
          PRIORITY_ORDER.map((p) => ({ id: p, label: t(`priority.${p}`), onSelect: () => void run({ action: "priority", issueIds: ids, priorityId: p }) })),
        )}
        {can("delete") && (
          <Button size="sm" variant="danger" disabled={busy} iconLeft={<IcTrash size={14} />} onClick={() => setConfirmDelete(true)}>
            {t("common.delete")}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
          {t("common.clear")}
        </Button>
      </div>

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
