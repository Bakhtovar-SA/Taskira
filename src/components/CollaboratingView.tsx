import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { SoloIssueCard } from "./SoloView";
import { IcLink } from "../icons";

/** «Мои подключения» в обычном интерфейсе: приглашения к задачам в проектах,
 *  которые пользователю не открыты. Карточка — та же, что в SoloView. */

const HASH_ISSUE_RE = /^#\/issue\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})$/;
const hashIssueId = (): string | null => {
  try {
    const m = location.hash.match(HASH_ISSUE_RE);
    return m ? m[2] : null;
  } catch {
    return null;
  }
};

export default function CollaboratingView() {
  const { data, me, refreshCollaborations } = useStore();
  const items = data.collaborations;
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void refreshCollaborations();
  }, [refreshCollaborations]);

  useEffect(() => {
    setSelected((cur) => {
      if (cur && items.some((i) => i.issueId === cur)) return cur;
      const fromHash = hashIssueId();
      if (fromHash && items.some((i) => i.issueId === fromHash)) return fromHash;
      return items.length === 1 ? items[0].issueId : null;
    });
  }, [items]);

  const current = useMemo(() => items.find((i) => i.issueId === selected) ?? null, [items, selected]);

  return (
    <div className="flex h-full">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-linesoft px-4 py-3">
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-sub">
            <IcLink size={13} className="text-accent" /> Мои подключения
          </p>
          <p className="mt-0.5 text-[11px] text-faint">Задачи из проектов, куда вас пригласили точечно.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.map((it) => (
            <button
              key={it.issueId}
              onClick={() => setSelected(it.issueId)}
              className={`mb-1 flex w-full flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
                it.issueId === selected
                  ? "border-accent bg-accentsoft/50"
                  : "border-transparent hover:border-linesoft hover:bg-canvas/60"
              }`}
            >
              <span className="w-full truncate font-mono text-[10.5px] font-bold text-sub">
                {it.key} · {it.projectName}
              </span>
              <span className="w-full truncate text-[12.5px] font-medium text-ink">{it.title}</span>
              <span className="text-[10px] text-faint">{it.statusName}</span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="px-2.5 py-6 text-center text-[11.5px] text-faint">
              Активных приглашений нет. Здесь появятся задачи, к которым вас подключат из другого проекта.
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
            statusHint={current.statusName}
            currentUser={{ id: data.currentUserId, name: me.name }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-faint">
            {items.length ? "Выберите задачу слева." : "Пока вас никуда не приглашали."}
          </div>
        )}
      </div>
    </div>
  );
}
