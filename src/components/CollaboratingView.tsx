import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { SoloIssueCard } from "./SoloView";
import { IcLink } from "../icons";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";

/** «Мои подключения» в обычном интерфейсе: приглашения к задачам в проектах,
 *  которые пользователю не открыты. Карточка — та же, что в SoloView. Прямая ссылка
 *  на такую задачу (ТЗ 3.1) приходит не через свой URL-формат, а через
 *  `ui.collabOpenIssueId` — его выставляет bootstrap()/useRouterSync, разобрав
 *  /p/:projectKey/issue/:issueKey и обнаружив, что это приглашение, а не открытый
 *  проект (заменяет прежний точечный разбор location.hash прямо здесь). */

export default function CollaboratingView() {
  const { t } = useT();
  const { data, ui, me, refreshCollaborations, clearCollabOpenIssueId } = useStore();
  const items = data.collaborations;
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void refreshCollaborations();
  }, [refreshCollaborations]);

  useEffect(() => {
    setSelected((cur) => {
      if (cur && items.some((i) => i.issueId === cur)) return cur;
      const fromLink = ui.collabOpenIssueId;
      if (fromLink && items.some((i) => i.issueId === fromLink)) return fromLink;
      return items.length === 1 ? items[0].issueId : null;
    });
    if (ui.collabOpenIssueId) clearCollabOpenIssueId();
  }, [items, ui.collabOpenIssueId, clearCollabOpenIssueId]);

  const current = useMemo(() => items.find((i) => i.issueId === selected) ?? null, [items, selected]);

  return (
    <div className="flex h-full">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-linesoft px-4 py-3">
          <p className="flex items-center gap-2 text-[13px] font-medium text-sub">
            <IcLink size={13} className="text-accent" /> {t("collaborating.title")}
          </p>
          <p className="mt-0.5 text-[11px] text-faint">{t("collaborating.subtitle")}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.map((it) => (
            <button
              key={it.issueId}
              onClick={() => setSelected(it.issueId)}
              className={`mb-1 flex w-full flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
                it.issueId === selected
                  ? "border-accent bg-accentsoft/50"
                  : "border-transparent hover:border-linesoft hover:bg-hover"
              }`}
            >
              <span className="w-full truncate font-mono text-[10.5px] font-semibold text-sub">
                {it.key} · {it.projectName}
              </span>
              <span className="w-full truncate text-[12.5px] font-medium text-ink">{it.title}</span>
              <span className="text-[10px] text-faint">{workflowStatusName({ name: it.statusName }, t)}</span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="px-2.5 py-6 text-center text-[11.5px] text-faint">
              {t("collaborating.empty")}
            </p>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        {current ? (
          <SoloIssueCard
            key={current.issueId}
            projectId={current.projectId}
            issueId={current.issueId}
            statusHint={workflowStatusName({ name: current.statusName }, t)}
            currentUser={{ id: data.currentUserId, name: me.name }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-faint">
            {t(items.length ? "collaborating.select" : "collaborating.none")}
          </div>
        )}
      </div>
    </div>
  );
}
