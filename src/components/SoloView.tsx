import { useEffect, useMemo, useState } from "react";
import { relTime, useStore } from "../store";
import { commentsApi, issuesApi, type ServerComment, type ServerIssue, type ServerParticipant } from "../api";
import { LIMITS, validateComment } from "../validation";
import { PRIORITIES } from "../types";
import type { IssueTypeId, PriorityId } from "../types";
import { IcSend, Logo, PriorityIcon, TypeIcon } from "../icons";
import { Toasts } from "../ui";

/** Одиночный режим (COLLAB_MIGRATION.md Фаза 6): пользователь без единого видимого
 *  проекта, но приглашённый (issue collaborator) к отдельным задачам. Урезанная
 *  оболочка — «Мои подключения» + карточка задачи с комментариями, без проекта. */

function Ava({ p, size = 24 }: { p: { name: string; initials: string; color: string } | undefined; size?: number }) {
  if (!p)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#eef1f6] text-[#8b95a7]"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        –
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: p.color }}
      title={p.name}
    >
      {p.initials}
    </span>
  );
}

/** Карточка приглашённой задачи: сама грузит задачу + комментарии, поля read-only,
 *  форма комментария. Переиспользуется в SoloView и в разделе «Мои подключения»
 *  обычного интерфейса — отсюда `currentUser` пропом, а не из solo-состояния. */
export function SoloIssueCard({
  projectId,
  issueId,
  statusHint,
  currentUser,
}: {
  projectId: string;
  issueId: string;
  statusHint?: string;
  currentUser: { id: string; name: string };
}) {
  const { toast } = useStore();
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [issue, setIssue] = useState<ServerIssue | null>(null);
  const [comments, setComments] = useState<ServerComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let off = false;
    setState("loading");
    setDraft("");
    Promise.all([issuesApi.get(projectId, issueId), commentsApi.list(projectId, issueId).catch(() => [])])
      .then(([iss, cs]) => {
        if (off) return;
        setIssue(iss);
        setComments(cs as ServerComment[]);
        setState("ready");
      })
      .catch(() => !off && setState("error"));
    return () => {
      off = true;
    };
  }, [projectId, issueId]);

  const pById = useMemo(() => {
    const m = new Map<string, ServerParticipant>();
    for (const p of issue?.participants ?? []) m.set(p.id, p);
    return m;
  }, [issue]);

  if (state === "loading") return <div className="flex h-full items-center justify-center text-[13px] text-faint">Загрузка задачи…</div>;
  if (state === "error" || !issue)
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-faint">
        Не удалось открыть задачу — возможно, вас отключили от неё.
      </div>
    );

  const meFallback = { name: currentUser.name, initials: currentUser.name.slice(0, 2).toUpperCase(), color: "#0B5FD9" };
  const authorOf = (id: string) => pById.get(id) ?? (id === currentUser.id ? meFallback : undefined);
  const assignee = issue.assigneeId ? pById.get(issue.assigneeId) : undefined;
  const reporter = pById.get(issue.reporterId);

  const send = () => {
    const r = validateComment(draft);
    if (!r.ok) return toast("error", r.error);
    setSending(true);
    commentsApi
      .create(projectId, issueId, r.value)
      .then((c) => {
        setComments((prev) => [...prev, c]);
        setDraft("");
      })
      .catch(() => toast("error", "Не удалось отправить комментарий"))
      .finally(() => setSending(false));
  };

  return (
    <div className="mx-auto max-w-[760px] px-6 py-6">
      <div className="flex items-center gap-2 font-mono text-[12px] font-bold text-sub">
        <TypeIcon type={issue.typeId as IssueTypeId} size={15} /> {issue.key}
        {statusHint && <span className="rounded bg-[#e8edf4] px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-sub">{statusHint}</span>}
      </div>
      <h1 className="mt-1.5 text-[19px] font-bold leading-snug text-ink">{issue.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-sub">
        <span className="flex items-center gap-1.5">
          <PriorityIcon p={issue.priorityId as PriorityId} size={13} />
          {PRIORITIES[issue.priorityId as PriorityId]?.name ?? issue.priorityId}
        </span>
        <span className="flex items-center gap-1.5">
          Исполнитель:{" "}
          {assignee ? (
            <>
              <Ava p={assignee} size={18} /> {assignee.name}
            </>
          ) : (
            <span className="text-faint">не назначен</span>
          )}
        </span>
        <span>Автор: {reporter?.name ?? "—"}</span>
      </div>

      {issue.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {issue.labels.map((l) => (
            <span key={l} className="rounded-full bg-[#eef1f6] px-2 py-0.5 text-[11px] text-sub">
              {l}
            </span>
          ))}
        </div>
      )}

      {issue.description && (
        <div className="mt-4 whitespace-pre-wrap rounded-lg border border-line bg-panel p-3.5 text-[13px] leading-relaxed text-ink">
          {issue.description}
        </div>
      )}

      {(issue.collaborators?.length ?? 0) > 0 && (
        <p className="mt-3 text-[11.5px] text-faint">Приглашены к задаче: {issue.collaborators!.map((c) => c.name).join(", ")}</p>
      )}

      <div className="mt-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">Комментарии · {comments.length}</p>
        <div className="space-y-3">
          {comments.map((c) => {
            const a = authorOf(c.authorId);
            return (
              <div key={c.id} className="flex gap-2.5">
                <Ava p={a} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-faint">
                    <span className="font-semibold text-sub">{a?.name ?? "—"}</span> · {relTime(Date.parse(c.createdAt) || Date.now())}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink">{c.body}</p>
                </div>
              </div>
            );
          })}
          {comments.length === 0 && <p className="text-[12px] text-faint">Пока нет комментариев.</p>}
        </div>

        <div className="mt-3 flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            maxLength={LIMITS.comment.max}
            rows={2}
            placeholder="Комментарий…  (Ctrl+Enter)"
            className="min-w-0 flex-1 resize-y rounded-md border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-accent"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="shrink-0 self-end rounded-md bg-accent px-3 py-2 text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <IcSend size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SoloView({ onLogout }: { onLogout: () => void }) {
  const { solo } = useStore();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (solo?.openTarget) setSelected(solo.openTarget.issueId);
    else if (solo && solo.items.length === 1) setSelected(solo.items[0].issueId);
  }, [solo]);

  if (!solo) return null;
  const current = solo.items.find((i) => i.issueId === selected) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-[280px] shrink-0 flex-col bg-sidebar text-[#c6d2e4]">
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
          <Logo size={26} />
          <p className="font-disp text-[14px] font-bold text-white">Taskira</p>
        </div>
        <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#5f7396]">
          Мои подключения · {solo.items.length}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
          {solo.items.map((it) => (
            <button
              key={it.issueId}
              onClick={() => setSelected(it.issueId)}
              className={`mb-1 flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                it.issueId === selected ? "bg-white/[0.09] text-white" : "text-[#9db0cd] hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <span className="w-full truncate font-mono text-[10.5px] text-[#7b8fb2]">
                {it.key} · {it.projectName}
              </span>
              <span className="w-full truncate text-[12.5px] font-medium">{it.title}</span>
              <span className="text-[10px] text-[#7b8fb2]">{it.statusName}</span>
            </button>
          ))}
          {solo.items.length === 0 && <p className="px-2.5 text-[11.5px] text-[#7b8fb2]">Вас пока никуда не приглашали.</p>}
        </div>
        <div className="border-t border-[#24385a] p-3 text-[11px]">
          <p className="truncate text-[#9db0cd]">{solo.userName}</p>
          <button onClick={onLogout} className="mt-1 text-[#7b8fb2] transition-colors hover:text-white">
            Выйти
          </button>
        </div>
      </aside>
      <main className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        {current ? (
          <SoloIssueCard
            key={current.issueId}
            projectId={current.projectId}
            issueId={current.issueId}
            statusHint={current.statusName}
            currentUser={{ id: solo.userId, name: solo.userName }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-faint">Выберите задачу слева.</div>
        )}
      </main>
      <Toasts />
    </div>
  );
}
