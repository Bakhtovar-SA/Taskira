import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { relTime } from "../store/mappers";
import type { NotificationT, ProjectSummary, SearchResultItem, ViewId } from "../types";
import { IcBell, IcCheck, IcChevD, IcChevR, IcLock, IcPlus, IcSearch, IcStar, IcX, PriorityIcon, TypeIcon } from "../icons";
import { AppearanceSettings, Avatar, Dropdown, MenuItem, RoleBadge, Tip, UserCardBody } from "../ui";
import { useT, type TKey } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { useIssueSearch } from "../issueSearch";

const VIEW_LABEL: Record<ViewId, TKey> = {
  board: "sidebar.nav.board",
  backlog: "sidebar.nav.backlog",
  sprints: "sidebar.nav.sprints",
  timeline: "sidebar.nav.timeline",
  reports: "sidebar.nav.reports",
  workflow: "sidebar.nav.workflow",
  access: "sidebar.nav.access",
  admin: "sidebar.nav.admin",
  docs: "sidebar.nav.docs",
  collaborating: "sidebar.nav.collaborating",
};

/** Быстрый поиск: «в этом проекте» — серверный поиск (250 мс, топ-8), «во всех проектах» — кросс-проектный. */
export function SearchBox() {
  const { t } = useT();
  const { data, openIssue, switchProject, searchAllProjects } = useStore();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [allProjects, setAllProjects] = useState(false);
  const [remote, setRemote] = useState<{ items: SearchResultItem[]; truncated: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // Поиск в проекте — на сервере (PERF-06): раньше фильтровался весь список задач на клиенте.
  // Пауза 250 мс, топ-8, пустое поле ничего не ищет. Каждое состояние объяснено текстом.
  const local = useIssueSearch(allProjects ? null : data.currentProjectId || null, q, { limit: 8, emptyMode: "none" });
  const localResults = local.results;

  // Кросс-проектный поиск бьёт по серверу — дебаунс, иначе каждый символ
  // в поле даёт отдельный запрос. Только пока включён режим "во всех проектах".
  useEffect(() => {
    const s = q.trim();
    if (!allProjects || !s) {
      setRemote(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchAllProjects(s).then((res) => {
        if (!cancelled) {
          setRemote(res);
          setSearching(false);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allProjects, q, searchAllProjects]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const closeAfterPick = () => {
    setQ("");
    ref.current?.blur();
  };

  const openRemote = (item: SearchResultItem) => {
    if (item.projectId === data.currentProjectId) {
      openIssue(item.id);
    } else {
      switchProject(item.projectId, item.id);
    }
    closeAfterPick();
  };

  // Счётчик показываем только когда есть что считать: при нуле результатов ниже уже стоит
  // «Ничего не найдено по запросу…», и «Результаты · 0» над ним — дубль.
  const headerLabel = allProjects
    ? searching
      ? t("topbar.searchingAllProjects")
      : (remote?.items.length ?? 0) > 0
        ? t("topbar.allProjectsCount", { n: remote?.items.length ?? 0 })
        : ""
    : local.status === "loading"
      ? t("picker.searching")
      : local.status === "ready" && localResults.length > 0
        ? t("topbar.resultsCount", { n: localResults.length })
        : "";

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-md border bg-panel px-2.5 transition-all duration-200 ${focus ? "w-[190px] border-accent shadow-[0_0_0_3px_rgba(11,95,217,0.12)] sm:w-[340px]" : "w-[130px] border-line sm:w-[228px]"}`}>
        <IcSearch size={14} className="shrink-0 text-faint" />
        <input
          id="global-search"
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder={t("topbar.searchPlaceholder")}
          className="h-8 w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        {!focus && (
          <kbd className="shrink-0 rounded border border-line bg-canvas px-1.5 font-mono text-[10px] text-faint">/</kbd>
        )}
      </div>
      {focus && q.trim() && (
        <div className="anim-pop absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-line bg-panel shadow-[0_12px_40px_rgba(20,35,64,0.18)]">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setAllProjects((v) => !v);
            }}
            className="flex w-full items-center justify-between border-b border-linesoft px-3 py-1.5 text-left transition-colors hover:bg-canvas"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-faint">
              {headerLabel}
            </span>
            <span className="shrink-0 text-[10.5px] font-semibold text-accent">
              {allProjects ? t("topbar.thisProjectOnly") : t("topbar.allProjectsToggle")}
            </span>
          </button>
          {allProjects ? (
            <>
              {!searching && (remote?.items.length ?? 0) === 0 && (
                <p className="px-3 py-5 text-center text-[12.5px] text-faint">{t("topbar.noResultsFor", { q })}</p>
              )}
              {(remote?.items ?? []).map((i) => (
                <button
                  key={i.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openRemote(i);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accentsoft"
                >
                  <TypeIcon type={i.typeId} size={14} />
                  <span className="font-mono text-[11px] font-semibold text-faint">{i.key}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{i.title}</span>
                  <span className="shrink-0 truncate text-[10.5px] text-faint">{i.projectKey}</span>
                </button>
              ))}
              {remote?.truncated && (
                <p className="border-t border-linesoft px-3 py-1.5 text-center text-[11px] text-faint">
                  {t("topbar.truncatedResults")}
                </p>
              )}
            </>
          ) : (
            <>
              {local.status === "loading" && localResults.length === 0 && (
                <div className="space-y-1.5 px-3 py-3" aria-busy="true" aria-label={t("picker.searching")}>
                  {[0, 1, 2].map((n) => (
                    <div key={n} className="skeleton h-6 w-full" />
                  ))}
                </div>
              )}
              {local.status === "error" && (
                <div className="px-3 py-4 text-center text-[12.5px] text-danger">
                  <p>{t("picker.error")}</p>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      local.retry();
                    }}
                    className="mt-1 font-semibold text-accent hover:underline"
                  >
                    {t("common.retry")}
                  </button>
                </div>
              )}
              {local.status === "ready" && localResults.length === 0 && (
                <p className="px-3 py-5 text-center text-[12.5px] text-faint">{t("topbar.noResultsFor", { q: local.term })}</p>
              )}
              {localResults.map((i) => (
                <button
                  key={i.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openIssue(i.id);
                    closeAfterPick();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accentsoft"
                >
                  <TypeIcon type={i.typeId} size={14} />
                  <span className="font-mono text-[11px] font-semibold text-faint">{i.key}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{i.title}</span>
                  <PriorityIcon p={i.priorityId} size={13} />
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const NOTIF_VERB: Record<NotificationT["type"], TKey> = {
  "issue.assigned": "notifVerb.issueAssigned",
  "issue.comment": "notifVerb.issueComment",
  "issue.mention": "notifVerb.issueMention",
  "issue.status": "notifVerb.issueStatus",
  "issue.collaborator": "notifVerb.issueCollaborator",
  "project.member": "notifVerb.projectMember",
};

/** Содержимое дропдауна колокола. Отдельный компонент — чтобы `useEffect` на
 *  маунте (подтянуть свежую ленту) срабатывал при открытии. */
function BellPanel({ close }: { close: () => void }) {
  const { t } = useT();
  const { data, openIssue, refreshNotifications, markNotificationsRead, dismissNotifications } = useStore();
  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  const list = data.notifications;
  const anyUnread = data.unreadCount > 0 || list.some((n) => !n.read);

  const go = (n: NotificationT) => {
    if (!n.read) markNotificationsRead([n.id]);
    if (n.issueId && n.projectId === data.currentProjectId) openIssue(n.issueId);
    else if (n.issueId) window.location.hash = `#/issue/${n.projectId}/${n.issueId}`;
    close();
  };

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b border-linesoft px-3.5 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-faint">{t("topbar.notifications")}</p>
        <div className="flex items-center gap-3">
          {anyUnread && (
            <button onClick={() => markNotificationsRead()} className="text-[11px] font-semibold text-accent hover:underline">
              {t("topbar.markAllRead")}
            </button>
          )}
          {list.length > 0 && (
            <button
              onClick={() => dismissNotifications()}
              title={t("topbar.clearListTitle")}
              className="text-[11px] font-semibold text-faint hover:text-danger hover:underline"
            >
              {t("topbar.clear")}
            </button>
          )}
        </div>
      </div>
      <div className="overflow-y-auto">
        {list.length === 0 && (
          <p className="px-3.5 py-8 text-center text-[12.5px] text-faint">{t("topbar.noNotifications")}</p>
        )}
        {list.map((n) => (
          <div
            key={n.id}
            className={`group relative flex w-full items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-accentsoft ${
              n.read ? "" : "bg-accentsoft"
            }`}
          >
            <button onClick={() => go(n)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
              <span className="relative mt-0.5 shrink-0">
                <Avatar user={n.actor} size={26} />
                {!n.read && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-panel" />
                )}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">
                <b className="font-semibold">{n.actor?.name.split(" ")[0] ?? t("topbar.someone")}</b> {t(NOTIF_VERB[n.type])}{" "}
                {n.payload.key && (
                  <span className="font-mono text-[11px] font-semibold text-accent">{n.payload.key}</span>
                )}
                {n.type === "issue.status" && n.payload.from && (
                  <span className="text-faint">
                    {" "}
                    · {workflowStatusName({ name: n.payload.from }, t)} → {workflowStatusName({ name: n.payload.to ?? "" }, t)}
                  </span>
                )}
                {n.type === "project.member" && n.payload.projectName && (
                  <span className="text-faint"> «{n.payload.projectName}»</span>
                )}
                <span className="mt-0.5 block text-[11px] text-faint">{relTime(n.createdAt)}</span>
              </span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissNotifications([n.id]);
              }}
              title={t("topbar.dismissOneTitle")}
              className="mt-0.5 shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-linesoft hover:text-danger group-hover:opacity-100"
            >
              <IcX size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Bell() {
  const { t } = useT();
  const { data } = useStore();
  const unread = data.unreadCount;
  return (
    <Dropdown
      width={360}
      align="right"
      button={(open) => (
        <button
          className={`relative flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${open ? "border-accent bg-accentsoft text-accent" : "border-line bg-panel text-sub hover:text-ink"}`}
          aria-label={t("topbar.notifications")}
        >
          <IcBell size={15} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => <BellPanel close={close} />}
    </Dropdown>
  );
}

/** Настройки уведомлений — компактный блок в меню пользователя (D6). */
function NotifySettings() {
  const { t } = useT();
  const { data, setNotifyPrefs } = useStore();
  const mode = data.notifyPrefs.email ?? "instant";
  const selfWatch = data.notifyPrefs.selfWatch !== false;
  return (
    <div className="border-b border-linesoft px-3.5 py-3">
      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("topbar.emailNotifications")}</p>
      <div className="flex gap-1">
        {(
          [
            ["instant", t("topbar.emailMode.instant")],
            ["daily", t("topbar.emailMode.daily")],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setNotifyPrefs({ email: v })}
            className={`flex-1 rounded border px-1.5 py-1 text-[11px] font-semibold transition-colors ${
              mode === v ? "border-accent bg-accentsoft text-accent" : "border-line text-sub hover:border-line2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11.5px] text-sub">
        <input
          type="checkbox"
          checked={selfWatch}
          onChange={(e) => setNotifyPrefs({ selfWatch: e.target.checked })}
          className="h-3.5 w-3.5 accent-accent"
        />
        {t("topbar.selfWatch")}
      </label>
    </div>
  );
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { t } = useT();
  const { data, me } = useStore();
  return (
    <Dropdown
      width={280}
      align="right"
      button={(open) => (
        <button className={`flex items-center gap-2 rounded-md border py-1 pl-1.5 pr-2 transition-colors ${open ? "border-accent bg-accentsoft" : "border-line bg-panel hover:border-line2"}`} aria-label={t("topbar.userMenuAria")}>
          {/* interactive=false: клик по аватарке здесь должен открывать это же
              меню (логаут/настройки), а не всплывающую карточку профиля —
              её показывает сам заголовок открытого меню ниже. */}
          <Avatar user={me} size={26} interactive={false} />
          <span className="hidden max-w-[120px] truncate text-left md:block">
            <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">{me.name.split(" ")[0]}</span>
            <span className="block text-[10px] leading-tight text-faint">{me.role}</span>
          </span>
          <IcChevD size={11} className="text-faint" />
        </button>
      )}
    >
      {(close) => (
        <>
          {/* UserCardBody, не Avatar+Dropdown вложенно: любой другой открытый
              Dropdown закрывает это меню через DROPDOWN_OPEN_EVT — вложенный
              Dropdown внутри уже открытого захлопнул бы его под собой. */}
          <div className="border-b border-linesoft">
            <UserCardBody userId={me.id} />
            <div className="-mt-2 px-4 pb-3">
              <p className="text-[11px] text-faint">{data.project.name}</p>
              <div className="mt-2">
                <RoleBadge role={me.accessRole} size="sm" />
              </div>
            </div>
          </div>
          <AppearanceSettings />
          <NotifySettings />
          <p className="border-t border-linesoft px-4 py-2 font-mono text-[10px] text-faint">
            Taskira {import.meta.env.VITE_APP_VERSION || "dev"}
          </p>
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
  );
}

/** Строка проекта в переключателе — отдельно от MenuItem: нужен второй
 *  интерактивный элемент (звезда избранного) внутри одной строки, у MenuItem
 *  только один onClick на всю ширину. */
function ProjectRow({ p, active, onOpen }: { p: ProjectSummary; active: boolean; onOpen: () => void }) {
  const { t } = useT();
  const { data, toggleFavoriteProject } = useStore();
  const isFav = data.favoriteProjectIds.includes(p.id);
  return (
    <div className="group flex items-center">
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-accentsoft"
      >
        <span className="w-12 shrink-0 rounded bg-linesoft px-1 text-center font-mono text-[10px] font-bold text-sub">{p.key}</span>
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        {p.isShared && <span className="shrink-0 text-[9.5px] uppercase text-faint">{t("topbar.sharedBadge")}</span>}
        {active && <IcCheck size={12} className="shrink-0 text-accent" />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleFavoriteProject(p.id);
        }}
        aria-label={isFav ? t("topbar.removeFavorite") : t("topbar.addFavorite")}
        title={isFav ? t("topbar.removeFavorite") : t("topbar.addFavorite")}
        className={`mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
          isFav ? "text-warndot" : "text-faint opacity-0 hover:text-warndot group-hover:opacity-100"
        }`}
      >
        <IcStar size={13} filled={isFav} />
      </button>
    </div>
  );
}

function ProjectSwitcher() {
  const { t } = useT();
  const { data, switchProject } = useStore();
  const [filter, setFilter] = useState("");
  if (data.projects.length <= 1) return <span className="font-semibold text-sub">{data.project.name}</span>;

  const q = filter.trim().toLowerCase();
  const matches = (p: ProjectSummary) => !q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q);
  const byKey = (a: ProjectSummary, b: ProjectSummary) => a.key.localeCompare(b.key);
  const favorites = data.projects.filter((p) => data.favoriteProjectIds.includes(p.id) && matches(p)).sort(byKey);

  const byDept = new Map<string, ProjectSummary[]>();
  for (const p of data.projects) {
    if (!matches(p)) continue;
    const bucket = byDept.get(p.departmentId);
    if (bucket) bucket.push(p);
    else byDept.set(p.departmentId, [p]);
  }
  const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? "—";
  const deptGroups = [...byDept.entries()]
    .map(([id, projs]) => [deptName(id), projs.sort(byKey)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <Dropdown
      width={300}
      button={(open) => (
        <button
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold transition-colors ${
            open ? "bg-accentsoft text-accent" : "text-sub hover:bg-canvas"
          }`}
        >
          <span className="max-w-[180px] truncate">{data.project.name}</span>
          <IcChevD size={11} className="opacity-70" />
        </button>
      )}
    >
      {(close) => {
        const open = (id: string) => {
          switchProject(id);
          setFilter("");
          close();
        };
        return (
          <div className="flex max-h-[70vh] flex-col">
            <div className="shrink-0 border-b border-linesoft p-2">
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("topbar.findProjectPlaceholder")}
                className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
              />
            </div>
            <div className="overflow-y-auto py-1">
              {favorites.length > 0 && (
                <div className="mb-1 border-b border-linesoft pb-1">
                  <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">{t("topbar.favoritesSection")}</p>
                  {favorites.map((p) => (
                    <ProjectRow key={p.id} p={p} active={p.id === data.currentProjectId} onOpen={() => open(p.id)} />
                  ))}
                </div>
              )}
              {deptGroups.map(([name, projs]) => (
                <div key={name}>
                  <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">{name}</p>
                  {projs.map((p) => (
                    <ProjectRow key={p.id} p={p} active={p.id === data.currentProjectId} onOpen={() => open(p.id)} />
                  ))}
                </div>
              ))}
              {favorites.length === 0 && deptGroups.length === 0 && (
                <p className="px-3 py-6 text-center text-[12.5px] text-faint">{t("topbar.nothingFound")}</p>
              )}
            </div>
          </div>
        );
      }}
    </Dropdown>
  );
}

/** Переключатель разделов для узких экранов — нативный select, чтобы на
 *  телефоне открывался системный список, а не самодельная выпадашка. Набор
 *  пунктов повторяет сайдбар, включая те же правила видимости. */
function MobileViewSwitcher() {
  const { t } = useT();
  const { data, ui, setView, me } = useStore();
  const isAdmin = me.globalRole === "admin";
  const ids: ViewId[] = [
    "board",
    "backlog",
    ...(data.project.sprintsEnabled ? (["sprints"] as ViewId[]) : []),
    "timeline",
    "reports",
    "workflow",
    "access",
    ...(isAdmin ? (["admin"] as ViewId[]) : []),
    "docs",
    ...(data.collaborations.length > 0 ? (["collaborating"] as ViewId[]) : []),
  ];

  return (
    <select
      id="mobile-view"
      value={ui.view}
      onChange={(e) => setView(e.target.value as ViewId)}
      aria-label={t("topbar.sectionAria")}
      className="h-8 max-w-[160px] rounded-md border border-line bg-panel px-2 text-[13px] font-semibold text-ink focus:border-accent focus:outline-none md:hidden"
    >
      {ids.map((id) => (
        <option key={id} value={id}>
          {t(VIEW_LABEL[id])}
        </option>
      ))}
    </select>
  );
}

export default function Topbar({ onLogout }: { onLogout?: () => void }) {
  const { t } = useT();
  const { data, ui, setCreateOpen, can, logout, goHome } = useStore();
  const doLogout = onLogout ?? logout;
  // «Проекты» — назад на главный экран; кликабельно только когда он вообще есть
  // (≥ 2 доступных проектов), иначе это просто метка (UI_RESTRUCTURE.md D4).
  const homeAvailable = data.projects.length >= 2;
  const viewTitle = t(VIEW_LABEL[ui.view]);
  const canCreate = can("create");

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-line bg-panel px-3 sm:px-5">
      {/* Навигация по разделам на узком экране: сайдбар там скрыт, и без этого
          переключателя на телефоне не осталось бы вообще никакой навигации
          (аудит UX-03). На широком экране роль навигации играет сайдбар. */}
      <MobileViewSwitcher />

      <nav className="hidden min-w-0 items-center gap-1 text-[13px] text-faint md:flex">
        {homeAvailable ? (
          <button onClick={goHome} className="font-semibold text-sub transition-colors hover:text-accent" title={t("sidebar.homeAria")}>
            {t("topbar.projectsCrumb")}
          </button>
        ) : (
          <span className="font-semibold text-sub">{t("topbar.projectsCrumb")}</span>
        )}
        <IcChevR size={12} />
        <ProjectSwitcher />
        <IcChevR size={12} />
        <span className="font-bold text-ink">{viewTitle}</span>
      </nav>

      <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
        <SearchBox />
        <Bell />
        {canCreate ? (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.35)] transition-all hover:bg-accentdeep hover:shadow-[0_4px_14px_rgba(11,95,217,0.4)] active:scale-[0.97] sm:px-3.5"
            aria-label={t("topbar.createAria")}
          >
            <IcPlus size={14} /> <span className="hidden sm:inline">{t("topbar.create")}</span>
          </button>
        ) : (
          <Tip label={t("topbar.createDeniedTip")}>
            <button className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-line bg-canvas px-3.5 text-[13px] font-semibold text-faint">
              <IcLock size={13} /> {t("topbar.create")}
            </button>
          </Tip>
        )}
        <div className="ml-1 border-l border-line pl-3">
          <UserMenu onLogout={doLogout} />
        </div>
      </div>
    </header>
  );
}
