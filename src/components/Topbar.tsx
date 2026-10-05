import { ScreenPopover } from "./settings/parts";
import { Input } from "../ds/Field";
import { Button, IconButton } from "../ds/Button";
import { Tabs } from "../ds/Tabs";
import { pathForView } from "../router";
import { Kbd, Skeleton } from "../ds/Display";
import { PersonAvatar } from "./settings/parts";
import { useEffect, useRef, useState } from "react";
import { lookOf } from "../projectLook";
import { useNotifications, useStore, useUnreadCount } from "../store";
import { relTime } from "../store/mappers";
import type { NotificationT, ProjectSummary, SearchResultItem, ViewId } from "../types";
import { IcBell, IcCheck, IcChevD, IcChevR, IcLock, IcPanel, IcPlus, IcSearch, IcStar, IcX, PriorityIcon, TypeIcon } from "../icons";
import { ProjectMark } from "../ui";
import { useT, type TKey } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { useIssueSearch } from "../issueSearch";
import { PROJECT_VIEWS, openSidebarDrawer } from "./Sidebar";
import { UserAvatarGroup } from "./UserAvatar";

export const VIEW_LABEL: Record<ViewId, TKey> = {
  board: "sidebar.nav.board",
  backlog: "sidebar.nav.backlog",
  sprints: "sidebar.nav.sprints",
  timeline: "sidebar.nav.timeline",
  calendar: "calendar.title",
  reports: "sidebar.nav.reports",
  roadmap: "sidebar.nav.roadmap",
  dashboards: "sidebar.nav.dashboards",
  overview: "sidebar.nav.overview",
  settings: "settings.title",
  projectSettings: "settings.title",
  orgSettings: "settings.title",
  docs: "sidebar.nav.docs",
  collaborating: "sidebar.nav.collaborating",
  inbox: "sidebar.nav.inbox",
  my: "sidebar.nav.my",
};

/** Быстрый поиск: «в этом проекте» — серверный поиск (250 мс, топ-8), «во всех проектах» — кросс-проектный. */
export function SearchBox() {
  const { t } = useT();
  const { data, openIssue, switchProject, searchAllProjects } = useStore();
  // ТЗ 3.4 (план v2 Трек 3, дополнение к ТЗ 3.1): результаты кросс-проектного
  // поиска — адресуемые. Инициализация из URL при монтировании (перезагрузка
  // страницы/вставленная ссылка восстанавливают запрос и режим "во всех
  // проектах"); запись обратно — ниже, тем же debounce, что и сам запрос к
  // серверу, через обычный history.replaceState (не useRouterSync — тот
  // синхронизирует ТОЛЬКО путь вида/задачи, не query параметры этой
  // выпадашки; конфликт возможен только если реальная навигация случится
  // ровно в момент открытого поиска — узкий, редкий край, не гонка).
  const initial = new URLSearchParams(location.search);
  const [q, setQ] = useState(() => initial.get("q") ?? "");
  // Восстановленный из URL непустой запрос сразу показывает результаты —
  // иначе вставленная/перезагруженная ссылка молча предзаполняла бы поле, не
  // показывая то, ради чего её вообще послали (сама суть "адресуемости").
  const [focus, setFocus] = useState(() => !!initial.get("q"));
  const [allProjects, setAllProjects] = useState(() => initial.get("scope") === "all");
  const [remote, setRemote] = useState<{ items: SearchResultItem[]; truncated: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const s = q.trim();
    if (allProjects && s) {
      p.set("q", s);
      p.set("scope", "all");
    } else {
      p.delete("q");
      p.delete("scope");
    }
    const next = p.toString();
    if (next !== location.search.replace(/^\?/, "")) {
      history.replaceState(null, "", `${location.pathname}${next ? `?${next}` : ""}`);
    }
  }, [q, allProjects]);

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
    // Из поиска — полной страницей (ADR-0013 §3).
    if (item.projectId === data.currentProjectId) {
      openIssue(item.id, "page");
    } else {
      switchProject(item.projectId, item.id, "page");
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
    <div className={`topbar-search relative shrink-0 ${focus ? "is-expanded" : ""}`}>
      {/* До 1024 px в покое — только лупа (место в шапке нужно вкладкам); клик по ней ставит фокус. */}
      <div
        onMouseDown={(e) => {
          if (e.target !== ref.current) {
            e.preventDefault();
            ref.current?.focus();
          }
        }}
        className={`cursor-text ${focus ? "w-[min(320px,calc(100vw-32px))]" : "w-10 lg:w-[220px]"}`}
      >
        <Input iconLeft={<IcSearch size={16} className="shrink-0 text-faint" />}
          right={!focus ? <span className="hidden lg:block"><Kbd>/</Kbd></span> : undefined}
          id="global-search"
          aria-label={t("topbar.searchPlaceholder")}
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder={t("topbar.searchPlaceholder")}

        />
      </div>
      {focus && q.trim() && (
        <div className="glass anim-pop absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-line shadow-e3">
          <Button variant="ghost" size="sm"
            onMouseDown={(e) => {
              e.preventDefault();
              setAllProjects((v) => !v);
            }}
            className="w-full text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
          >
            <span className="text-[11.5px] font-medium text-faint">
              {headerLabel}
            </span>
            <span className="shrink-0 text-[11.5px] font-medium text-accenttext">
              {allProjects ? t("topbar.thisProjectOnly") : t("topbar.allProjectsToggle")}
            </span>
          </Button>
          {allProjects ? (
            <>
              {!searching && (remote?.items.length ?? 0) === 0 && (
                <p className="px-3 py-5 text-center text-[12.5px] text-faint">{t("topbar.noResultsFor", { q })}</p>
              )}
              {(remote?.items ?? []).map((i) => (
                <Button variant="ghost" size="sm"
                  key={i.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openRemote(i);
                  }}
                  className="w-full text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                >
                  <TypeIcon type={i.typeId} size={14} />
                  <span className="font-mono text-[11px] text-faint">{i.key}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{i.title}</span>
                  <span className="shrink-0 truncate text-[10.5px] text-faint">{i.projectKey}</span>
                </Button>
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
                    <Skeleton.Block key={n} h={24} />
                  ))}
                </div>
              )}
              {local.status === "error" && (
                <div className="px-3 py-4 text-center text-[12.5px] text-danger">
                  <p>{t("picker.error")}</p>
                  <Button variant="ghost" size="sm"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      local.retry();
                    }}
                    className="mt-1 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                  >
                    {t("common.retry")}
                  </Button>
                </div>
              )}
              {local.status === "ready" && localResults.length === 0 && (
                <p className="px-3 py-5 text-center text-[12.5px] text-faint">{t("topbar.noResultsFor", { q: local.term })}</p>
              )}
              {localResults.map((i) => (
                <Button variant="ghost" size="sm"
                  key={i.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openIssue(i.id, "page");
                    closeAfterPick();
                  }}
                  className="w-full text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                >
                  <TypeIcon type={i.typeId} size={14} />
                  <span className="font-mono text-[11px] text-faint">{i.key}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{i.title}</span>
                  <PriorityIcon p={i.priorityId} size={13} />
                </Button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const NOTIF_VERB: Record<NotificationT["type"], TKey> = {
  "issue.dueSoon": "notifVerb.issueDueSoon",
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
  const { data, openIssue, switchProject, refreshNotifications, markNotificationsRead, dismissNotifications } = useStore();
  const { notifications: list, unreadCount } = useNotifications();
  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  const anyUnread = unreadCount > 0 || list.some((n) => !n.read);

  const go = (n: NotificationT) => {
    if (!n.read) markNotificationsRead([n.id]);
    // Тот же проект — открыть прямо сейчас; другой — switchProject(projectId, issueId)
    // (pendingOpenIssueRef, store/session.ts) откроет её сам после переключения.
    // Адресную строку после этого приводит в соответствие useRouterSync (App.tsx).
    if (n.issueId && n.projectId === data.currentProjectId) openIssue(n.issueId);
    else if (n.issueId && n.projectId) switchProject(n.projectId, n.issueId);
    close();
  };

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b border-linesoft px-3.5 py-2.5">
        <p className="text-[13px] font-semibold text-ink">{t("topbar.notifications")}</p>
        <div className="flex items-center gap-3">
          {anyUnread && (
            <Button variant="ghost" size="sm" onClick={() => markNotificationsRead()} className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
              {t("topbar.markAllRead")}
            </Button>
          )}
          {list.length > 0 && (
            <Button variant="ghost" size="sm"
              onClick={() => dismissNotifications()}
              title={t("topbar.clearListTitle")}
              className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
            >
              {t("topbar.clear")}
            </Button>
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
            className={`group relative mx-1.5 flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-hover/70 ${
              n.read ? "" : "bg-accentsoft/60"
            }`}
          >
            <Button variant="ghost" size="sm" onClick={() => go(n)} className="min-w-0 flex-1 text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
              <span className="relative mt-0.5 shrink-0">
                <PersonAvatar user={n.actor} size={26} />
                {!n.read && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-panel" />
                )}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">
                {n.type !== "issue.dueSoon" && <b className="font-semibold">{n.actor?.name.split(" ")[0] ?? t("topbar.someone")}</b>} {t(NOTIF_VERB[n.type])}{" "}
                {n.type === "issue.dueSoon" && <span className="text-sub">{n.payload.dueDate} · </span>}
                {n.payload.key && (
                  <span className="font-mono text-[11px] font-medium text-accenttext">{n.payload.key}</span>
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
            </Button>
            <IconButton variant="ghost" size="sm" label={t("topbar.dismissOneTitle")}
              onClick={(e) => {
                e.stopPropagation();
                dismissNotifications([n.id]);
              }}

              className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <IcX size={11} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Bell() {
  const { t } = useT();
  // Только счётчик (ADR-0011, шаг 2): Bell не подписан на общий контекст стора.
  const unread = useUnreadCount();
  return (
    <ScreenPopover
      className="w-[360px]" label={t("topbar.notifications")}
      placement="bottom-end"
      trigger={(props, open) => (
        <IconButton {...props} variant="ghost" size="sm" label={t("topbar.notifications")}
          className={(`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150 ${open ? "bg-active text-ink" : "text-sub hover:bg-hover hover:text-ink"}`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
          aria-label={t("topbar.notifications")}
        >
          <IcBell size={16} />
          {unread > 0 && (
            <span aria-hidden="true" className="absolute right-1 top-1 h-[7px] w-[7px] rounded-full bg-accent ring-2 ring-canvas" />
          )}
        </IconButton>
      )}
    >
      {(close) => <BellPanel close={close} />}
    </ScreenPopover>
  );
}

export { UserMenu } from "./UserMenu";

/** Строка проекта в переключателе — отдельно от MenuItem: нужен второй
 *  интерактивный элемент (звезда избранного) внутри одной строки, у MenuItem
 *  только один onClick на всю ширину. */
function ProjectRow({ p, active, onOpen }: { p: ProjectSummary; active: boolean; onOpen: () => void }) {
  const { t } = useT();
  const { data, toggleFavoriteProject } = useStore();
  const isFav = data.favoriteProjectIds.includes(p.id);
  return (
    <div className="group flex items-center">
      <Button variant="ghost" size="sm"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
      >
        <span className="w-12 shrink-0 rounded bg-sunken px-1 text-center font-mono text-[10.5px] font-medium text-sub ring-1 ring-inset ring-linesoft">{p.key}</span>
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        {p.isShared && <span className="shrink-0 text-[11px] text-faint">{t("topbar.sharedBadge")}</span>}
        {active && <IcCheck size={13} className="shrink-0 text-accenttext" />}
      </Button>
      <IconButton variant="ghost" size="sm" label={isFav ? t("topbar.removeFavorite") : t("topbar.addFavorite")}
        onClick={(e) => {
          e.stopPropagation();
          toggleFavoriteProject(p.id);
        }}


        className={`mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
          isFav ? "text-warndot" : "text-faint opacity-0 hover:text-warndot group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <IcStar size={13} filled={isFav} />
      </IconButton>
    </div>
  );
}

function ProjectSwitcher() {
  const { t } = useT();
  const { data, switchProject } = useStore();
  const [filter, setFilter] = useState("");
  const projectLabel = <>
    <ProjectMark projectKey={data.project.key} {...lookOf(data.projects, data.currentProjectId)} size={22} />
    <span className="project-switcher-name truncate">{data.project.name}</span>
  </>;
  if (data.projects.length <= 1) return <span className="project-switcher-label">{projectLabel}</span>;

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
    <ScreenPopover
      className="w-[300px]" label={t("topbar.findProjectPlaceholder")}
      trigger={(props, open) => (
        <Button {...props} variant="ghost" size="sm"
          className={(`project-switcher flex items-center gap-1 rounded-md px-0 py-1 font-medium transition-colors duration-150 ${
            open ? "bg-active text-ink" : "text-sub hover:bg-hover hover:text-ink"
          }`) + " [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2"}
        >
          {projectLabel}
          <IcChevD size={12} className="shrink-0 text-faint" />
        </Button>
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
              <div className="w-full"><Input aria-label={t("topbar.findProjectPlaceholder")}
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("topbar.findProjectPlaceholder")}

              /></div>
            </div>
            <div className="overflow-y-auto px-1 py-1">
              {favorites.length > 0 && (
                <div className="mb-1 border-b border-linesoft pb-1">
                  <p className="px-3 pb-1 pt-1.5 text-[11.5px] font-medium text-faint">{t("topbar.favoritesSection")}</p>
                  {favorites.map((p) => (
                    <ProjectRow key={p.id} p={p} active={p.id === data.currentProjectId} onOpen={() => open(p.id)} />
                  ))}
                </div>
              )}
              {deptGroups.map(([name, projs]) => (
                <div key={name}>
                  <p className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-faint">{name}</p>
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
    </ScreenPopover>
  );
}

export default function Topbar() {
  const { t } = useT();
  const { data, ui, idx, setCreateOpen, can, setView, toggleFavoriteProject } = useStore();
  const views = PROJECT_VIEWS.filter((v) => !v.sprintsOnly || data.project.sprintsEnabled);
  const isProjectView = views.some((v) => v.id === ui.view);
  const isFavorite = data.favoriteProjectIds.includes(data.currentProjectId);
  const members = Object.keys(data.members).flatMap(id => { const user = idx.users.get(id); return user ? [user] : []; });

  return (
    <header className="project-topbar shrink-0 border-b border-linesoft">
      <div className="project-topbar-row">
        <IconButton variant="ghost" size="sm" label={t("sidebar.menu")} onClick={openSidebarDrawer} className="project-menu-button shrink-0 lg:hidden">
          <IcPanel size={16} />
        </IconButton>
        {isProjectView ? <>
          <div className="project-identity">
            <ProjectSwitcher />
            <IconButton variant="ghost" size="sm" label={t(isFavorite ? "topbar.removeFavorite" : "topbar.addFavorite")}
              aria-pressed={isFavorite} onClick={() => toggleFavoriteProject(data.currentProjectId)}
              className={`project-favorite ${isFavorite ? "text-[var(--amber-solid)]" : "text-faint"}`}>
              <IcStar size={14} filled={isFavorite} />
            </IconButton>
          </div>
          <span className="project-topbar-divider" aria-hidden="true" />
          <nav aria-label={t("topbar.viewsAria")} className="project-view-tabs">
            <Tabs<ViewId> mode="navigation" label={t("topbar.viewsAria")} value={ui.view} onChange={setView}
              items={views.map((v) => ({ id: v.id, href: `${pathForView(data.project.key, v.id)}${location.search}`, icon: v.icon({ size: 15 }), label: t(v.labelKey) }))} />
          </nav>
        </> : <h1 className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{t(VIEW_LABEL[ui.view])}</h1>}
        <div className="project-topbar-actions">
          {isProjectView && members.length > 0 && <span className="project-members" role="group" aria-label={t("topbar.membersAria")}>
            <UserAvatarGroup users={members} size={26} max={4} interactive />
          </span>}
          <Bell />
          <Button variant={can("create") ? "primary" : "ghost"} size="sm"
            disabled={can("create") ? false : t("topbar.createDeniedTip")}
            onClick={() => setCreateOpen(true)} className="project-create"
            aria-label={t("topbar.createAria")} iconLeft={can("create") ? <IcPlus size={14} /> : <IcLock size={14} />} kbd="C">
            <span className="hidden sm:inline">{t("topbar.task")}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
