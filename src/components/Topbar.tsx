import { useEffect, useMemo, useRef, useState } from "react";
import { relTime, useStore } from "../store";
import type { NotificationT } from "../types";
import { IcBell, IcCheck, IcChevD, IcChevR, IcLock, IcPlus, IcSearch, PriorityIcon, TypeIcon } from "../icons";
import { AppearanceSettings, Avatar, Dropdown, MenuItem, RoleBadge, Tip } from "../ui";

function SearchBox() {
  const { data, openIssue } = useStore();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return data.issues
      .filter((i) => i.key.toLowerCase().includes(s) || i.title.toLowerCase().includes(s))
      .slice(0, 8);
  }, [q, data.issues]);

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

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-md border bg-panel px-2.5 transition-all duration-200 ${focus ? "w-[340px] border-accent shadow-[0_0_0_3px_rgba(11,95,217,0.12)]" : "w-[228px] border-line"}`}>
        <IcSearch size={14} className="shrink-0 text-faint" />
        <input
          id="global-search"
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder="Поиск задач…"
          className="h-8 w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        {!focus && (
          <kbd className="shrink-0 rounded border border-line bg-canvas px-1.5 font-mono text-[10px] text-faint">/</kbd>
        )}
      </div>
      {focus && q.trim() && (
        <div className="anim-pop absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-line bg-panel shadow-[0_12px_40px_rgba(20,35,64,0.18)]">
          <p className="border-b border-linesoft px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">
            Результаты · {results.length}
          </p>
          {results.length === 0 && <p className="px-3 py-5 text-center text-[12.5px] text-faint">Ничего не найдено по запросу «{q}»</p>}
          {results.map((i) => (
            <button
              key={i.id}
              onMouseDown={(e) => {
                e.preventDefault();
                openIssue(i.id);
                setQ("");
                ref.current?.blur();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accentsoft"
            >
              <TypeIcon type={i.typeId} size={14} />
              <span className="font-mono text-[11px] font-semibold text-faint">{i.key}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{i.title}</span>
              <PriorityIcon p={i.priorityId} size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const NOTIF_VERB: Record<NotificationT["type"], string> = {
  "issue.assigned": "назначил(а) вас исполнителем",
  "issue.comment": "прокомментировал(а)",
  "issue.mention": "упомянул(а) вас в",
  "issue.status": "сменил(а) статус",
  "issue.collaborator": "подключил(а) вас к задаче",
  "project.member": "добавил(а) вас в проект",
};

/** Содержимое дропдауна колокола. Отдельный компонент — чтобы `useEffect` на
 *  маунте (подтянуть свежую ленту) срабатывал при открытии. */
function BellPanel({ close }: { close: () => void }) {
  const { data, openIssue, refreshNotifications, markNotificationsRead } = useStore();
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
        <p className="text-[11px] font-bold uppercase tracking-wider text-faint">Уведомления</p>
        {anyUnread && (
          <button onClick={() => markNotificationsRead()} className="text-[11px] font-semibold text-accent hover:underline">
            Прочитать всё
          </button>
        )}
      </div>
      <div className="overflow-y-auto">
        {list.length === 0 && (
          <p className="px-3.5 py-8 text-center text-[12.5px] text-faint">Пока нет уведомлений</p>
        )}
        {list.map((n) => (
          <button
            key={n.id}
            onClick={() => go(n)}
            className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accentsoft ${
              n.read ? "" : "bg-accentsoft"
            }`}
          >
            <span className="relative mt-0.5 shrink-0">
              <Avatar user={n.actor} size={26} />
              {!n.read && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-panel" />
              )}
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">
              <b className="font-semibold">{n.actor?.name.split(" ")[0] ?? "Кто-то"}</b> {NOTIF_VERB[n.type]}{" "}
              {n.payload.key && (
                <span className="font-mono text-[11px] font-semibold text-accent">{n.payload.key}</span>
              )}
              {n.type === "issue.status" && n.payload.from && (
                <span className="text-faint">
                  {" "}
                  · {n.payload.from} → {n.payload.to}
                </span>
              )}
              {n.type === "project.member" && n.payload.projectName && (
                <span className="text-faint"> «{n.payload.projectName}»</span>
              )}
              <span className="mt-0.5 block text-[11px] text-faint">{relTime(n.createdAt)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Bell() {
  const { data } = useStore();
  const unread = data.unreadCount;
  return (
    <Dropdown
      width={360}
      align="right"
      button={(open) => (
        <button
          className={`relative flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${open ? "border-accent bg-accentsoft text-accent" : "border-line bg-panel text-sub hover:text-ink"}`}
          aria-label="Уведомления"
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
  const { data, setNotifyPrefs } = useStore();
  const mode = data.notifyPrefs.email ?? "instant";
  const selfWatch = data.notifyPrefs.selfWatch !== false;
  return (
    <div className="border-b border-linesoft px-3.5 py-3">
      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Уведомления по почте</p>
      <div className="flex gap-1">
        {(
          [
            ["instant", "Сразу"],
            ["daily", "Дайджест"],
            ["off", "Выкл"],
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
        Подписывать меня на мои задачи
      </label>
    </div>
  );
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { data, me } = useStore();
  return (
    <Dropdown
      width={280}
      align="right"
      button={(open) => (
        <button className={`flex items-center gap-2 rounded-md border py-1 pl-1.5 pr-2 transition-colors ${open ? "border-accent bg-accentsoft" : "border-line bg-panel hover:border-line2"}`} aria-label="Меню пользователя">
          <Avatar user={me} size={26} />
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
          <div className="border-b border-linesoft px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <Avatar user={me} size={34} />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-ink">{me.name}</p>
                <p className="text-[11px] text-faint">{me.role} · {data.project.name}</p>
              </div>
            </div>
            <div className="mt-2">
              <RoleBadge role={me.accessRole} size="sm" />
            </div>
          </div>
          <AppearanceSettings />
          <NotifySettings />
          <MenuItem
            onClick={() => {
              onLogout();
              close();
            }}
          >
            Выйти
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

function ProjectSwitcher() {
  const { data, switchProject } = useStore();
  if (data.projects.length <= 1) return <span className="font-semibold text-sub">{data.project.name}</span>;
  const sorted = [...data.projects].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <Dropdown
      width={264}
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
      {(close) => (
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {sorted.map((p) => (
            <MenuItem
              key={p.id}
              onClick={() => {
                switchProject(p.id);
                close();
              }}
            >
              <span className="flex w-full items-center gap-2">
                <span className="w-12 shrink-0 rounded bg-linesoft px-1 text-center font-mono text-[10px] font-bold text-sub">
                  {p.key}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.isShared && <span className="shrink-0 text-[9.5px] uppercase text-faint">общий</span>}
                {p.id === data.currentProjectId && <IcCheck size={12} className="shrink-0 text-accent" />}
              </span>
            </MenuItem>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

export default function Topbar({ onLogout }: { onLogout?: () => void }) {
  const { data, ui, setCreateOpen, can, logout, goHome } = useStore();
  const doLogout = onLogout ?? logout;
  // «Проекты» — назад на главный экран; кликабельно только когда он вообще есть
  // (≥ 2 доступных проектов), иначе это просто метка (UI_RESTRUCTURE.md D4).
  const homeAvailable = data.projects.length >= 2;
  const viewTitle = {
    board: "Доска",
    backlog: "Список задач",
    timeline: "Таймлайн",
    workflow: "Рабочий процесс",
    access: "Права доступа",
    admin: "Департаменты",
    docs: "Документация",
    collaborating: "Мои подключения",
  }[ui.view];
  const canCreate = can("create");

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-line bg-panel px-5">
      <nav className="flex min-w-0 items-center gap-1 text-[13px] text-faint">
        {homeAvailable ? (
          <button onClick={goHome} className="font-semibold text-sub transition-colors hover:text-accent" title="На главный экран">
            Проекты
          </button>
        ) : (
          <span className="font-semibold text-sub">Проекты</span>
        )}
        <IcChevR size={12} />
        <ProjectSwitcher />
        <IcChevR size={12} />
        <span className="font-bold text-ink">{viewTitle}</span>
      </nav>

      <div className="ml-auto flex items-center gap-2.5">
        <SearchBox />
        <Bell />
        {canCreate ? (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.35)] transition-all hover:bg-accentdeep hover:shadow-[0_4px_14px_rgba(11,95,217,0.4)] active:scale-[0.97]"
          >
            <IcPlus size={14} /> Создать
          </button>
        ) : (
          <Tip label="Ваша роль не позволяет создавать задачи">
            <button className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-line bg-canvas px-3.5 text-[13px] font-semibold text-faint">
              <IcLock size={13} /> Создать
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
