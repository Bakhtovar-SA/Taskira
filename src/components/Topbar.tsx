import { useEffect, useMemo, useRef, useState } from "react";
import { relTime, useStore } from "../store";
import { IcBell, IcCheck, IcChevD, IcChevR, IcLock, IcPlus, IcSearch, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, Dropdown, MenuItem, RoleBadge, Tip } from "../ui";

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
      <div className={`flex items-center gap-2 rounded-md border bg-white px-2.5 transition-all duration-200 ${focus ? "w-[340px] border-accent shadow-[0_0_0_3px_rgba(11,95,217,0.12)]" : "w-[228px] border-line"}`}>
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

function Bell() {
  const { data, openIssue } = useStore();
  const [seen, setSeen] = useState<number>(Date.now());

  const feed = useMemo(() => {
    const all = data.issues.flatMap((i) => i.activity.map((a) => ({ ...a, key: i.key, issueId: i.id })));
    return all.sort((a, b) => b.ts - a.ts).slice(0, 9);
  }, [data.issues]);

  const unread = feed.filter((f) => f.ts > seen && f.authorId !== data.currentUserId).length;

  return (
    <Dropdown
      width={330}
      align="right"
      button={(open) => (
        <button className={`relative flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${open ? "border-accent bg-accentsoft text-accent" : "border-line bg-white text-sub hover:text-ink"}`} aria-label="Уведомления">
          <IcBell size={15} />
          {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">{unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div onMouseEnter={() => setSeen(Date.now() + 1000)}>
          <p className="border-b border-linesoft px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-faint">Лента активности</p>
          <div className="max-h-[330px] overflow-y-auto">
            {feed.map((f) => {
              const u = data.users.find((x) => x.id === f.authorId);
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    openIssue(f.issueId);
                    close();
                  }}
                  className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-accentsoft"
                >
                  <Avatar user={u ?? null} size={24} />
                  <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">
                    <b className="font-semibold">{u?.name.split(" ")[0]}</b> {f.text} ·{" "}
                    <span className="font-mono text-[11px] font-semibold text-accent">{f.key}</span>
                    <span className="mt-0.5 block text-[11px] text-faint">{relTime(f.ts)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

/* Меню пользователя: профиль + демо-переключение ролей */
function UserMenu() {
  const { data, me, switchUser } = useStore();
  return (
    <Dropdown
      width={300}
      align="right"
      button={(open) => (
        <button className={`flex items-center gap-2 rounded-md border py-1 pl-1.5 pr-2 transition-colors ${open ? "border-accent bg-accentsoft" : "border-line bg-white hover:border-[#b9c6da]"}`} aria-label="Меню пользователя">
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
          <p className="px-3.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-faint">Войти как (демо прав доступа)</p>
          {data.users.map((u) => (
            <MenuItem
              key={u.id}
              onClick={() => {
                switchUser(u.id);
                close();
              }}
            >
              <Avatar user={u} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">{u.name}</span>
              </span>
              <RoleBadge role={u.accessRole} size="sm" />
              {u.id === data.currentUserId && <IcCheck size={12} className="text-accent" />}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export default function Topbar() {
  const { data, ui, setCreateOpen, can } = useStore();
  const viewTitle = {
    board: "Доска",
    backlog: "Бэклог",
    timeline: "Таймлайн",
    workflow: "Рабочий процесс",
    access: "Права доступа",
    docs: "Документация",
  }[ui.view];
  const canCreate = can("create");

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-line bg-panel px-5">
      <nav className="flex min-w-0 items-center gap-1 text-[13px] text-faint">
        <span className="font-semibold text-sub">Проекты</span>
        <IcChevR size={12} />
        <span className="font-semibold text-sub">{data.project.name}</span>
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
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
