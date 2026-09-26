import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { relTime } from "../store/mappers";
import { attachmentsApi, commentsApi, issuesApi, type ServerComment, type ServerIssue, type ServerParticipant } from "../api";
import { MentionText } from "./IssueModal";
import { LIMITS, localizeValidationError, validateComment } from "../validation";
import type { IssueTypeId, PriorityId } from "../types";
import { PRIORITY_ORDER } from "../types";
import { IcSend, Logo, PriorityIcon, TypeIcon } from "../icons";
import { Toasts } from "../ui";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";

/** Одиночный режим (COLLAB_MIGRATION.md Фаза 6): пользователь без единого видимого
 *  проекта, но приглашённый (issue collaborator) к отдельным задачам. Урезанная
 *  оболочка — «Мои подключения» + карточка задачи с комментариями, без проекта. */

function Ava({ p, size = 24 }: { p: { name: string; initials: string; color: string } | undefined; size?: number }) {
  if (!p)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-linesoft text-faint"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        –
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-onaccent"
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
  const { t, lang } = useT();
  const { toast } = useStore();
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [issue, setIssue] = useState<ServerIssue | null>(null);
  const [comments, setComments] = useState<ServerComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const attRef = useRef<HTMLInputElement>(null);

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

  if (state === "loading") return <div className="flex h-full items-center justify-center text-[13px] text-faint">{t("solo.loadingIssue")}</div>;
  if (state === "error" || !issue)
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-faint">
        {t("solo.openFailed")}
      </div>
    );

  const meFallback = { name: currentUser.name, initials: currentUser.name.slice(0, 2).toUpperCase(), color: "var(--accent-solid)" };
  const authorOf = (id: string) => pById.get(id) ?? (id === currentUser.id ? meFallback : undefined);
  const assignees = issue.assigneeIds.map((id) => pById.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
  const reporter = pById.get(issue.reporterId);

  const fmtBytes = (n: number): string =>
    n < 1024 ? `${n} ${lang === "ru" ? "Б" : "B"}` : n < 1024 * 1024 ? `${Math.round(n / 1024)} ${lang === "ru" ? "КБ" : "KB"}` : `${(n / 1024 / 1024).toFixed(1)} ${lang === "ru" ? "МБ" : "MB"}`;

  const uploadFile = (f: File) => {
    attachmentsApi
      .upload(projectId, issueId, f)
      .then((a) => setIssue((prev) => (prev ? { ...prev, attachments: [...(prev.attachments ?? []), a] } : prev)))
      .catch((e: { reason?: string }) => toast("error", lang === "ru" && e?.reason ? e.reason : t("solo.uploadFailed")));
  };

  const send = () => {
    const r = validateComment(draft);
    if (!r.ok) return toast("error", localizeValidationError(r.error, lang));
    setSending(true);
    commentsApi
      .create(projectId, issueId, r.value)
      .then((c) => {
        setComments((prev) => [...prev, c]);
        setDraft("");
      })
      .catch(() => toast("error", t("solo.commentFailed")))
      .finally(() => setSending(false));
  };

  return (
    <div className="mx-auto max-w-[760px] min-[1536px]:max-w-[920px] min-[1920px]:max-w-[1080px] px-6 py-6">
      <div className="flex items-center gap-2 font-mono text-[12px] font-semibold text-sub">
        <TypeIcon type={issue.typeId as IssueTypeId} size={15} /> {issue.key}
        {statusHint && <span className="rounded bg-linesoft px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-sub">{statusHint}</span>}
      </div>
      <h1 className="mt-1.5 text-[19px] font-semibold leading-snug text-ink">{issue.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-sub">
        <span className="flex items-center gap-1.5">
          <PriorityIcon p={issue.priorityId as PriorityId} size={13} />
          {PRIORITY_ORDER.includes(issue.priorityId as PriorityId) ? t(`priority.${issue.priorityId as PriorityId}`) : issue.priorityId}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {t("issue.assignees")}:{" "}
          {assignees.length > 0 ? (
            assignees.map((a, i) => (
              <span key={i} className="flex items-center gap-1">
                <Ava p={a} size={18} /> {a.name}
              </span>
            ))
          ) : (
            <span className="text-faint">{t("createIssue.unassigned")}</span>
          )}
        </span>
        <span>{t("issue.reporter")}: {reporter?.name ?? "—"}</span>
      </div>

      {issue.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {issue.labels.map((l) => (
            <span key={l} className="rounded-full bg-linesoft px-2 py-0.5 text-[11px] text-sub">
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
        <p className="mt-3 text-[11.5px] text-faint">{t("solo.invited")}: {issue.collaborators!.map((c) => c.name).join(", ")}</p>
      )}

      <div className="mt-5">
        <p className="mb-2 text-[12px] font-medium text-faint">
          {t("solo.attachmentsCount", { count: issue.attachments?.length ?? 0 })}
        </p>
        <div className="space-y-1">
          {(issue.attachments ?? []).map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px]">
              <button
                onClick={() =>
                  attachmentsApi
                    .download(projectId, issueId, a.id, a.filename)
                    .catch(() => toast("error", t("solo.downloadFailed")))
                }
                className="min-w-0 flex-1 truncate text-left text-ink transition-colors hover:text-accent"
                title={t("issue.downloadFile", { filename: a.filename })}
              >
                {a.filename}
              </button>
              <span className="shrink-0 text-faint">{fmtBytes(a.byteSize)}</span>
            </div>
          ))}
          {(issue.attachments?.length ?? 0) === 0 && <span className="text-[12px] text-faint">{t("issue.noFiles")}</span>}
        </div>
        <input
          ref={attRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => attRef.current?.click()}
          className="mt-1.5 rounded-md border border-dashed border-line2 px-2.5 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent"
        >
          {t("issue.attachFile")}
        </button>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-[12px] font-medium text-faint">{t("issue.commentsCount", { count: comments.length })}</p>
        <div className="space-y-3">
          {comments.map((c) => {
            const a = authorOf(c.authorId);
            return (
              <div key={c.id} className="flex gap-2.5">
                <Ava p={a} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-faint">
                    <span className="font-semibold text-sub">{a?.name ?? "—"}</span> · {relTime(Date.parse(c.createdAt) || Date.now(), lang)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink"><MentionText text={c.body} /></p>
                </div>
              </div>
            );
          })}
          {comments.length === 0 && <p className="text-[12px] text-faint">{t("solo.noComments")}</p>}
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
            placeholder={t("solo.commentPlaceholder")}
            className="min-w-0 flex-1 resize-y rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="btn-primary shrink-0 self-end rounded-lg px-3 py-2 disabled:opacity-40"
          >
            <IcSend size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SoloView({ onLogout }: { onLogout: () => void }) {
  const { t } = useT();
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
      <aside className="flex w-[280px] shrink-0 flex-col text-sub">
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
          <Logo size={26} />
          <p className="font-disp text-[16px] font-semibold tracking-[-0.02em] text-ink">Taskira</p>
        </div>
        <p className="px-4 pb-1.5 text-[11.5px] font-medium text-faint">
          {t("solo.connectionsCount", { count: solo.items.length })}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {solo.items.map((it) => (
            <button
              key={it.issueId}
              onClick={() => setSelected(it.issueId)}
              aria-current={it.issueId === selected ? "true" : undefined}
              className={`mb-0.5 flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                it.issueId === selected ? "bg-[var(--sidebar-item-active)] text-ink shadow-e1" : "text-sub hover:bg-hover/70 hover:text-ink"
              }`}
            >
              <span className="w-full truncate text-[11px] text-faint">
                <span className="font-mono">{it.key}</span> · {it.projectName}
              </span>
              <span className="w-full truncate text-[13px] font-medium">{it.title}</span>
              <span className="text-[11px] text-faint">{workflowStatusName({ name: it.statusName }, t)}</span>
            </button>
          ))}
          {solo.items.length === 0 && <p className="px-2.5 text-[12px] text-faint">{t("solo.none")}</p>}
        </div>
        <div className="mx-2 mb-3 border-t border-linesoft/70 px-2.5 pt-3 text-[12px]">
          <p className="truncate font-medium text-ink">{solo.userName}</p>
          <button onClick={onLogout} className="mt-1 text-faint transition-colors hover:text-ink">
            {t("topbar.logout")}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col py-2 pr-2">
        <main className="surface-sheet min-h-0 flex-1 overflow-y-auto rounded-xl border border-linesoft">
          {current ? (
            <SoloIssueCard
              key={current.issueId}
              projectId={current.projectId}
              issueId={current.issueId}
              statusHint={workflowStatusName({ name: current.statusName }, t)}
              currentUser={{ id: solo.userId, name: solo.userName }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-faint">{t("collaborating.select")}</div>
          )}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
