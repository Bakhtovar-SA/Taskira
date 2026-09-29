/** Панель массовых действий (ТЗ 3.3): статус, исполнитель, приоритет, удаление — для выделенных задач.
 *  Одна на «Список задач» и доску (ROUTE-03). Права проверяет сервер на каждую задачу (частичный успех);
 *  итог показывает тост стора. Доска грузит панель лениво — первый экран без неё. */
import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { PRIORITY_ORDER } from "../types";
import { workflowStatusName } from "../workflowStatus";
import { IcChevD, IcTrash } from "../icons";
import { Dropdown, MenuItem, Modal } from "../ui";

export default function BulkBar({ selectedIds, onDone, className = "" }: { selectedIds: ReadonlySet<string>; onDone: () => void; className?: string }) {
  const { t } = useT();
  const { data, can, bulkApplyIssueAction } = useStore();
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
  const trigger = (label: string) => () => (
    <button disabled={busy} className="flex h-7 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[12px] font-medium text-sub disabled:opacity-50">
      {label} <IcChevD size={10} className="text-faint" />
    </button>
  );

  return (
    <>
      <div role="toolbar" aria-label={t("backlog.selectedCount", { n: selectedIds.size })} className={`flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accentsoft/40 px-2.5 py-2 ${className}`}>
        <span className="text-[12.5px] font-semibold text-ink">{t("backlog.selectedCount", { n: selectedIds.size })}</span>
        <Dropdown align="left" width={180} button={trigger(t("field.status"))}>
          {(close) => (
            <>
              {data.workflow.statuses.map((s) => (
                <MenuItem key={s.id} onClick={() => { close(); void run({ action: "status", issueIds: ids, statusId: s.id }); }}>
                  {workflowStatusName(s, t)}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
        <Dropdown align="left" width={200} button={trigger(t("field.assignee"))}>
          {(close) => (
            <>
              <MenuItem onClick={() => { close(); void run({ action: "assignee", issueIds: ids, assigneeId: "none" }); }}>
                {t("createIssue.unassigned")}
              </MenuItem>
              {data.users.map((u) => (
                <MenuItem key={u.id} onClick={() => { close(); void run({ action: "assignee", issueIds: ids, assigneeId: u.id }); }}>
                  {u.name}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
        <Dropdown align="left" width={160} button={trigger(t("field.priority"))}>
          {(close) => (
            <>
              {PRIORITY_ORDER.map((p) => (
                <MenuItem key={p} onClick={() => { close(); void run({ action: "priority", issueIds: ids, priorityId: p }); }}>
                  {t(`priority.${p}`)}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
        {can("delete") && (
          <button
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            className="flex h-7 items-center gap-1 rounded-md border border-danger/40 px-2 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            <IcTrash size={12} /> {t("common.delete")}
          </button>
        )}
        <button onClick={onDone} className="ml-auto text-[11.5px] font-medium text-faint hover:text-ink">
          {t("common.clear")}
        </button>
      </div>

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} w={420} title={t("backlog.confirmBulkDeleteTitle")}>
          <div className="p-5">
            <p className="text-[13px] text-sub">{t("backlog.confirmBulkDeleteBody", { n: selectedIds.size })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="h-8 rounded-md border border-line px-3 text-[12.5px] font-medium text-sub hover:text-ink">
                {t("common.cancel")}
              </button>
              <button
                disabled={busy}
                onClick={() => void run({ action: "delete", issueIds: ids })}
                className="h-8 rounded-md bg-danger px-3 text-[12.5px] font-semibold text-onaccent hover:opacity-90 disabled:opacity-50"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
