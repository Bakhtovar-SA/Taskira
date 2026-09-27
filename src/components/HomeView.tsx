import { useMemo, useState } from "react";
import { GettingStarted } from "./GettingStarted";
import { lookOf } from "../projectLook";
import { FOCUS_TEST, FocusChips, TaskRow, groupByUrgency, useFocusCounts, type Focus } from "./MyIssues";
import { readRecent } from "../palette/recent";
import { Button, EmptyState } from "../ds";
import { useNotifications, useStore } from "../store";
import { relTime } from "../store/mappers";
import type { AssignedIssue, NotificationT, ProjectSummary } from "../types";
import { IcBell, IcChevR, IcComment, IcMyIssues, IcPlus, IcSearch, StatusGlyph, Logo } from "../icons";
import { Avatar, Dropdown, MenuItem, Toasts, UserCardBody, ProjectMark } from "../ui";
import { Bell, NOTIF_VERB } from "./Topbar";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";

const PROJECT_KEY = "taskira.project";
const readLastProject = (): string => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Приветствие по времени суток — мелочь, но экран перестаёт быть шаблоном. */
const greetingKey = (h = new Date().getHours()) =>
  h < 5 ? "home.greetingNight" : h < 12 ? "home.greetingMorning" : h < 18 ? "home.greetingDay" : h < 23 ? "home.greetingEvening" : "home.greetingNight";

export default function HomeView({ onLogout }: { onLogout: () => void }) {
  const { t, tn, lang } = useT();
  const { data, enterProject, switchProject, setCreateOpen, setView } = useStore();
  const { notifications } = useNotifications();
  const me = data.users.find((u) => u.id === data.currentUserId) ?? data.users[0];
  const last = readLastProject();
  const [q, setQ] = useState("");

  // «+ Создать задачу» с главного экрана: заходим в проект (последний открытый
  // или первый) и оставляем модалку создания открытой — она смонтируется в Shell.
  const createTarget = data.projects.find((p) => p.id === last)?.id ?? data.projects[0]?.id;
  // Личные настройки живут в оболочке (ТЗ 5.9): заходим в последний проект сразу на /settings/profile.
  const openPersonalSettings = () => {
    if (!createTarget) return;
    setView("settings", "profile");
    enterProject(createTarget);
  };
  const startCreate = () => {
    if (!createTarget) return;
    setCreateOpen(true);
    enterProject(createTarget);
  };

  // Полоса фокуса вместо плашек-счётчиков: каждая цифра — фильтр списка ниже
  // (анти-список трека: «большое число + подпись» только если оно что-то открывает).
  const [focus, setFocus] = useState<Focus>("all");
  const focusCounts = useFocusCounts(data.assignedToMe);

  const tasks = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inFocus = data.assignedToMe.filter(FOCUS_TEST[focus]);
    if (!s) return inFocus;
    return inFocus.filter(
      (item) => item.key.toLowerCase().includes(s) || item.title.toLowerCase().includes(s) || item.projectName.toLowerCase().includes(s),
    );
  }, [data.assignedToMe, q, focus]);

  const countInProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of data.assignedToMe) m.set(item.projectId, (m.get(item.projectId) ?? 0) + 1);
    return m;
  }, [data.assignedToMe]);

  const groups = useMemo(() => {
    const byDept = new Map<string, ProjectSummary[]>();
    for (const p of data.projects) {
      const arr = byDept.get(p.departmentId) ?? [];
      arr.push(p);
      byDept.set(p.departmentId, arr);
    }
    const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? t("home.noDepartment");
    return [...byDept.entries()]
      .map(([deptId, projects]) => ({
        deptId,
        deptName: deptName(deptId),
        projects: [...projects].sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : a.name.localeCompare(b.name))),
      }))
      .sort((a, b) => a.deptName.localeCompare(b.deptName));
  }, [data.projects, data.departments, last, t]);

  // Принимаем только то, что реально нужно навигации — и TaskRow (полный
  // AssignedIssue), и «Недавняя активность» (у уведомления лишь project/issue id)
  // остаются честными перед типизацией, без приведения через весь AssignedIssue.
  // switchProject(projectId, issueId) — тот же примитив, что уже использовал
  // кросс-проектный поиск (pendingOpenIssueRef, store/session.ts): открывает
  // задачу сразу после переключения, без промежуточного хэша/пути — адресную
  // строку после этого приводит в соответствие useRouterSync (App.tsx).
  const dateLine = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const openTask = (item: Pick<AssignedIssue, "projectId" | "issueId">) => {
    switchProject(item.projectId, item.issueId, "page");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* шапка */}
      <header className="glass flex h-[56px] shrink-0 items-center gap-4 border-b border-linesoft px-5 max-sm:gap-2.5 max-sm:px-4">
        <div className="flex items-center gap-2">
          <Logo size={24} />
          <span className="font-disp text-[16px] font-semibold tracking-[-0.02em] text-ink max-sm:hidden">Taskira</span>
        </div>

        <label className="flex h-8 w-full min-w-0 max-w-[340px] items-center gap-2 rounded-lg border border-linesoft bg-sunken px-2.5 transition-colors focus-within:border-accent focus-within:bg-panel focus-within:shadow-focus hover:border-line">
          <IcSearch size={13} className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("home.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </label>

        <div className="ml-auto flex items-center gap-2.5">
          <Bell />
          <div className="ml-0.5 border-l border-linesoft pl-2">
            <Dropdown
              align="right"
              width={280}
              button={(open) => (
                <button
                  className={`flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors ${
                    open ? "bg-active" : "hover:bg-hover"
                  }`}
                >
                  <Avatar user={me ?? null} size={24} interactive={false} />
                  <span className="hidden text-left sm:block">
                    <span className="block text-[12px] font-semibold leading-tight text-ink">{me?.name?.split(" ")[0] ?? "—"}</span>
                    <span className="block text-[10px] leading-tight text-faint">{me?.role}</span>
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  {me && (
                    <div className="border-b border-linesoft">
                      <UserCardBody userId={me.id} />
                    </div>
                  )}
                  <MenuItem
                    onClick={() => {
                      close();
                      openPersonalSettings();
                    }}
                  >
                    {t("settings.menu")}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      onLogout();
                      close();
                    }}
                  >
                    {t("topbar.logout")}
                  </MenuItem>
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </header>

      {/* тело */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1160px] px-5 py-10 sm:px-8 min-[1536px]:max-w-[1320px]">
          <p className="text-[13px] font-medium text-faint first-letter:uppercase">{dateLine}</p>
          <h1 className="mt-1 font-disp text-[28px] font-semibold tracking-[-0.03em] text-ink">
            {t(greetingKey(), { name: me?.name?.split(" ")[0] ?? "" })}
          </h1>
          <p className="mt-1 text-[14px] text-sub">{t("home.subtitle")}</p>

          {/* полоса фокуса: каждая цифра фильтрует «Мои задачи» */}
          <FocusChips focus={focus} onFocus={setFocus} counts={focusCounts} className="mt-7" />

          {/* две колонки */}
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.7fr_1fr]">
            {/* Мои задачи */}
            <section>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[14px] font-semibold text-ink">{focus === "all" ? t("home.myTasks") : t(`home.focus.${focus}`)}</h2>
                <span className="tabular text-[13px] text-faint">{tasks.length}</span>
              </div>
              {tasks.length > 0 ? (
                <div className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
                  {/* «Все мои» без поиска — по срочности, с заголовками групп; остальные фильтры — плоским списком. */}
                  {(focus === "all" && !q.trim() ? groupByUrgency(tasks) : [{ id: null, items: tasks }]).map((g) => (
                    <div key={g.id ?? "flat"}>
                      {g.id && (
                        <p className="urgency-head flex items-center gap-2 border-b border-linesoft px-3.5 pb-1.5 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-faint" data-urgency={g.id}>
                          {t(`home.urgency.${g.id}`)}
                          <span className="tabular font-medium">{g.items.length}</span>
                        </p>
                      )}
                      {g.items.map((item) => (
                        <TaskRow key={item.issueId} issue={item} onOpen={() => openTask(item)} look={lookOf(data.projects, item.projectKey)} />
                      ))}
                    </div>
                  ))}
                  {/* Сервер ограничивает выдачу — говорим об этом прямо, а не
                      показываем часть списка как будто это всё. */}
                  {data.assignedTruncated && (
                    <p className="border-t border-line bg-warnsoft/40 px-3 py-2 text-[11.5px] font-medium text-warn">
                      {t("home.assignedTruncated", {
                        n: data.assignedToMe.length,
                        noun: tn(data.assignedToMe.length, "noun.issue.one", "noun.issue.few", "noun.issue.many"),
                      })}
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={<IcMyIssues size={22} tone="violet" />}
                  title={q ? t("home.searchEmptyTitle") : t("home.noAssignedTitle")}
                  sub={q ? t("home.searchEmptySub") : t("home.noAssignedSub")}
                  action={
                    q ? (
                      <Button size="sm" variant="secondary" onClick={() => setQ("")}>
                        {t("common.reset")}
                      </Button>
                    ) : focus !== "all" ? (
                      <Button size="sm" variant="secondary" onClick={() => setFocus("all")}>
                        {t("common.reset")}
                      </Button>
                    ) : createTarget ? (
                      <Button size="sm" variant="primary" iconLeft={<IcPlus size={13} />} onClick={startCreate}>
                        {t("home.createIssue")}
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </section>

            {/* правая колонка: упоминания, проекты, недавно открытые, активность */}
            <div className="space-y-6">
            {/* «Начало работы» (ТЗ 5.11) — пока не пройдено и не скрыто; сбоку, чтобы не отодвигать задачи. */}
            <GettingStarted
              navigate={(v, sec) => {
                if (!createTarget) return;
                setView(v, sec);
                enterProject(createTarget);
              }}
            />
            <Mentions notifications={notifications} onOpen={openTask} />
            <section>
              <h2 className="mb-2 text-[14px] font-semibold text-ink">{t("home.projects")}</h2>
              <div className="space-y-4">
                {groups.map((g) => (
                  <div key={g.deptId}>
                    <p className="mb-1.5 text-[11.5px] font-medium text-faint">{g.deptName}</p>
                    <div className="space-y-2">
                      {g.projects.map((p) => {
                        const n = countInProject.get(p.id) ?? 0;
                        return (
                          <button
                            key={p.id}
                            onClick={() => enterProject(p.id)}
                            className="surface-raised group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset ring-line/70 transition-[box-shadow] duration-150 hover:shadow-[var(--highlight-top),var(--elev-2)] hover:ring-line2"
                          >
                            <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] font-medium text-ink">{p.name}</span>
                              <span className="block text-[12px] text-faint">
                                {p.id === last ? t("home.continueProject") : p.isShared ? t("home.sharedProject") : t("home.teamProject")}
                                {n > 0 && ` · ${n} ${tn(n, "noun.issue.one", "noun.issue.few", "noun.issue.many")}`}
                              </span>
                            </span>
                            <IcChevR size={14} className="shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <RecentlyOpened onOpen={openTask} />
            <RecentActivity notifications={notifications} onOpen={openTask} />
            </div>
          </div>
        </div>
      </div>
      <Toasts />
    </div>
  );
}

function RecentActivity({
  notifications,
  onOpen,
}: {
  notifications: NotificationT[];
  onOpen: (t: Pick<AssignedIssue, "projectId" | "issueId">) => void;
}) {
  const { t } = useT();
  const items = notifications.slice(0, 5);
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold text-ink">
        <IcBell size={13} className="text-faint" /> {t("home.recentActivity")}
      </h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-faint">
          {t("home.noActivity")}
        </p>
      ) : (
        <div className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
          {items.map((n) => {
            const clickable = !!n.issueId && !!n.projectId;
            return (
              <button
                key={n.id}
                disabled={!clickable}
                onClick={() => clickable && onOpen({ projectId: n.projectId!, issueId: n.issueId! })}
                className="flex w-full items-start gap-2.5 border-b border-linesoft px-3.5 py-2.5 text-left transition-colors last:border-0 enabled:hover:bg-hover/60 disabled:cursor-default"
              >
                <span className="mt-0.5 shrink-0">
                  <Avatar user={n.actor} size={22} interactive />
                </span>
                <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink">
                  <b className="font-semibold">{n.actor?.name.split(" ")[0] ?? t("topbar.someone")}</b>{" "}
                  {t(NOTIF_VERB[n.type])}{" "}
                  {n.payload.key && (
                    <span className="font-mono text-[11px] text-accenttext">{n.payload.key}</span>
                  )}
                  {n.type === "issue.status" && n.payload.from && (
                    <span className="text-faint"> · {workflowStatusName({ name: n.payload.from }, t)} → {workflowStatusName({ name: n.payload.to ?? "" }, t)}</span>
                  )}
                  <span className="mt-0.5 block text-[10.5px] text-faint">{relTime(n.createdAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Упоминания (ТЗ 5.12 b): непрочитанные «@вас упомянули» — отдельно от общей ленты, их легко пропустить. */
function Mentions({ notifications, onOpen }: { notifications: NotificationT[]; onOpen: (t: Pick<AssignedIssue, "projectId" | "issueId">) => void }) {
  const { t } = useT();
  const items = notifications.filter((n) => n.type === "issue.mention" && !n.read && n.issueId && n.projectId).slice(0, 5);
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold text-ink">
        <IcComment size={13} tone="violet" /> {t("home.mentions")}
        <span className="tabular text-[13px] font-medium text-faint">{items.length}</span>
      </h2>
      <div className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
        {items.map((n) => (
          <button
            key={n.id}
            onClick={() => onOpen({ projectId: n.projectId!, issueId: n.issueId! })}
            className="flex w-full items-start gap-2.5 border-b border-linesoft px-3.5 py-2.5 text-left transition-colors last:border-0 hover:bg-hover/60"
          >
            <span className="mt-0.5 shrink-0">
              <Avatar user={n.actor} size={22} />
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">
              <b className="font-semibold">{n.actor?.name.split(" ")[0] ?? t("topbar.someone")}</b> {t("home.mentionedYou")}{" "}
              {n.payload.key && <span className="font-mono text-[11.5px] text-accenttext">{n.payload.key}</span>}
              {n.payload.title && <span className="mt-0.5 block truncate text-faint">{n.payload.title}</span>}
            </span>
            <span className="shrink-0 pt-0.5 text-[11px] tabular text-faint">{relTime(n.createdAt)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Недавно открытые (ТЗ 5.12 b «недавнее»): последние карточки, которые человек открывал в этом браузере. */
function RecentlyOpened({ onOpen }: { onOpen: (t: Pick<AssignedIssue, "projectId" | "issueId">) => void }) {
  const { t } = useT();
  const [items] = useState(() => readRecent().slice(0, 5));
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-[14px] font-semibold text-ink">{t("home.recentlyOpened")}</h2>
      <div className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
        {items.map((r) => (
          <button
            key={r.id}
            onClick={() => onOpen({ projectId: r.projectId, issueId: r.id })}
            className="flex h-10 w-full items-center gap-2.5 border-b border-linesoft px-3.5 text-left transition-colors last:border-0 hover:bg-hover/60"
          >
            <StatusGlyph category={r.category} size={13} />
            <span className="w-[64px] shrink-0 font-mono text-[11.5px] text-faint">{r.key}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
