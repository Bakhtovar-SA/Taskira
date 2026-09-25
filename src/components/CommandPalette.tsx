import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { useT, type TKey } from "../i18n";
import type { SearchResultItem, StatusCategory } from "../types";
import { IcCompose, IcGlobe, IcHome, IcKeyboard, IcMoon, IcSearch, IcSun, IcDisplay, IcX, StatusGlyph } from "../icons";
import { Kbd, Modal, ProjectMark } from "../ui";
import { setThemeMode } from "../theme";
import { NAV_GROUPS } from "./Sidebar";
import { matchScore, fuzzyScore, swapLayout } from "../palette/fuzzy";
import { readRecent, type RecentIssue } from "../palette/recent";
import { paletteShortcut } from "../palette/events";
import { useIssueSearch } from "../issueSearch";

/**
 * Командная палитра (ТЗ 5.8 п.4). Один вход ко всему: разделы, проекты,
 * действия и задачи по всем видимым проектам (тот же серверный поиск, что в
 * шапке, ТЗ 3.4). Нечёткий поиск по командам и запрос в чужой раскладке
 * («ljcrf» находит «Доска»). Всё с клавиатуры: ↑/↓, Enter, Esc.
 *
 * Стекло — по ADR-0016 (всплывающие поверхности), а не на контенте.
 * Грузится отдельным чанком только при первом открытии.
 */

type Row = {
  id: string;
  group: "recent" | "nav" | "projects" | "actions" | "issues";
  label: string;
  /** Дополнительные слова для поиска (английское имя раздела, ключ проекта). */
  keywords?: string[];
  icon: React.ReactNode;
  hint?: React.ReactNode;
  run: () => void;
};

const GROUP_LABEL: Record<Row["group"], TKey> = {
  recent: "palette.group.recent",
  nav: "palette.group.nav",
  projects: "palette.group.projects",
  actions: "palette.group.actions",
  issues: "palette.group.issues",
};
const GROUP_ORDER: Row["group"][] = ["recent", "nav", "actions", "projects", "issues"];

/** Английские имена разделов: палитру ищут и так, особенно в чужой раскладке. */
const VIEW_ALIASES: Record<string, string[]> = {
  board: ["board", "kanban"],
  backlog: ["list", "backlog", "issues"],
  sprints: ["sprints"],
  timeline: ["timeline", "roadmap", "gantt"],
  reports: ["reports", "analytics"],
  workflow: ["workflow", "statuses"],
  access: ["access", "permissions", "roles"],
  admin: ["departments", "admin"],
  docs: ["docs", "help"],
  collaborating: ["shared", "collaborating"],
};

export default function CommandPalette({ onClose, onShortcuts }: { onClose: () => void; onShortcuts: () => void }) {
  const { t, lang, setLang } = useT();
  const { data, idx, me, ui, setView, setCreateOpen, can, openIssue, switchProject, goHome, searchAllProjects, logout } = useStore();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const done = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const openFound = (projectId: string, id: string) =>
    projectId === data.currentProjectId ? openIssue(id) : switchProject(projectId, id);

  // Задачи — серверным поиском по всем проектам, с паузой 200 мс, от двух символов.
  const term = q.trim();
  useEffect(() => {
    if (term.length < 2) {
      setRemote(null);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchAllProjects(term).then(
        (r) => {
          if (!live) return;
          setRemote(r.items.slice(0, 8));
          setSearching(false);
        },
        () => live && setSearching(false),
      );
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [term, searchAllProjects]);

  // В текущем проекте — поиск по подстроке («интегр» находит «Интеграция»):
  // серверный кросс-проектный поиск полнотекстовый и ищет только целые слова.
  const local = useIssueSearch(term.length >= 2 ? data.currentProjectId || null : null, term, { limit: 6, emptyMode: "none" });
  const busy = searching || (term.length >= 2 && local.status === "loading");

  const commands = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    if (data.projects.length >= 2)
      rows.push({ id: "home", group: "nav", label: t("sidebar.nav.home"), keywords: ["home"], icon: <IcHome size={16} tone="violet" />, run: goHome });
    for (const g of NAV_GROUPS)
      for (const item of g.items) {
        if (item.adminOnly && me.globalRole !== "admin") continue;
        if (item.collabOnly && data.collaborations.length === 0) continue;
        if (item.sprintsOnly && !data.project.sprintsEnabled) continue;
        rows.push({
          id: `view:${item.id}`,
          group: "nav",
          label: t(item.labelKey),
          keywords: VIEW_ALIASES[item.id],
          icon: item.icon({ size: 16, tone: item.tone }),
          hint: item.kbd ? <Kbd>{item.kbd}</Kbd> : undefined,
          run: () => setView(item.id),
        });
      }
    if (can("create"))
      rows.push({ id: "create", group: "actions", label: t("palette.newIssue"), keywords: ["new issue", "create"], icon: <IcCompose size={16} tone="violet" />, hint: <Kbd>C</Kbd>, run: () => setCreateOpen(true) });
    rows.push(
      { id: "theme:light", group: "actions", label: t("palette.themeLight"), keywords: ["light theme"], icon: <IcSun size={16} tone="amber" />, run: () => setThemeMode("light") },
      { id: "theme:dark", group: "actions", label: t("palette.themeDark"), keywords: ["dark theme"], icon: <IcMoon size={16} tone="indigo" />, run: () => setThemeMode("dark") },
      { id: "theme:system", group: "actions", label: t("palette.themeSystem"), keywords: ["system theme"], icon: <IcDisplay size={16} tone="gray" />, run: () => setThemeMode("system") },
      { id: "lang", group: "actions", label: t("palette.switchLang"), keywords: ["language", "язык"], icon: <IcGlobe size={16} tone="sky" />, run: () => setLang(lang === "ru" ? "en" : "ru") },
      { id: "shortcuts", group: "actions", label: t("palette.shortcuts"), keywords: ["shortcuts", "keys"], icon: <IcKeyboard size={16} tone="gray" />, hint: <Kbd>?</Kbd>, run: onShortcuts },
      { id: "logout", group: "actions", label: t("palette.logout"), keywords: ["logout", "sign out"], icon: <IcX size={16} tone="red" />, run: logout },
    );
    for (const p of data.projects) {
      if (p.id === data.currentProjectId) continue;
      rows.push({
        id: `project:${p.id}`,
        group: "projects",
        label: p.name,
        keywords: [p.key],
        icon: <ProjectMark projectKey={p.key} size={18} />,
        hint: <span className="font-mono text-[11px] text-faint">{p.key}</span>,
        run: () => switchProject(p.id),
      });
    }
    return rows;
  }, [data.projects, data.collaborations.length, data.project.sprintsEnabled, data.currentProjectId, me.globalRole, t, lang, can, goHome, setView, setCreateOpen, setLang, onShortcuts, logout, switchProject]);

  const recent = useMemo(() => readRecent().filter((r) => r.id !== ui.selectedIssueId), [ui.selectedIssueId]);

  const issueRow = (i: { id: string; projectId: string; key: string; title: string; category: StatusCategory; projectKey?: string }, group: Row["group"]): Row => ({
    id: `${group}:${i.id}`,
    group,
    label: i.title,
    keywords: [i.key],
    icon: <StatusGlyph category={i.category} size={15} />,
    hint: (
      <span className="font-mono text-[11px] text-faint">
        {i.key}
      </span>
    ),
    run: () => openFound(i.projectId, i.id),
  });

  // Видимые строки: пустой запрос — недавнее + всё по группам; иначе —
  // нечёткое совпадение, лучшие сверху внутри группы, плюс найденные задачи.
  const rows = useMemo<Row[]>(() => {
    if (!term) return [...recent.map((r: RecentIssue) => issueRow(r, "recent")), ...commands];
    const scored = commands
      .map((r) => ({ r, s: matchScore(term, [r.label, ...(r.keywords ?? [])]) }))
      .filter((x): x is { r: Row; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
    const seen = new Set<string>();
    const found = [
      ...local.results.map((i) =>
        issueRow({ id: i.id, projectId: data.currentProjectId, key: i.key, title: i.title, category: idx.statuses.get(i.statusId)?.category ?? "todo" }, "issues"),
      ),
      ...(remote ?? []).map((i) => issueRow({ ...i, category: i.statusCategory }, "issues")),
    ].filter((r) => !seen.has(r.id) && !!seen.add(r.id));
    const out: Row[] = [];
    for (const g of GROUP_ORDER) out.push(...scored.filter((r) => r.group === g), ...found.filter((r) => r.group === g));
    return out;
  }, [term, commands, remote, recent, local.results, idx.statuses, data.currentProjectId]);

  useEffect(() => setActive(0), [term]);
  const safeActive = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${safeActive}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [safeActive]);

  // Подсказка «ищем «доска»», когда лучшее совпадение нашлось только в другой раскладке.
  const top = rows[0];
  const viaLayout =
    !!term && !!top && top.group !== "issues" && [top.label, ...(top.keywords ?? [])].every((x) => fuzzyScore(term, x) === null);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((safeActive + 1) % Math.max(1, rows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((safeActive - 1 + rows.length) % Math.max(1, rows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[safeActive];
      if (r) done(r.run)();
    }
  };

  let lastGroup: Row["group"] | null = null;

  return (
    <Modal onClose={onClose} w={640} title={t("palette.aria")} variant="palette">
      <div className="flex h-[54px] items-center gap-3 border-b border-linesoft px-4">
        <IcSearch size={16} className="shrink-0 text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t("palette.placeholder")}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows.length ? `${listId}-${safeActive}` : undefined}
          aria-label={t("palette.aria")}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
        />
        {viaLayout && (
          <span className="shrink-0 rounded-md bg-accentsoft px-1.5 py-0.5 text-[11.5px] font-medium text-accenttext">
            {t("palette.layoutHint", { q: swapLayout(term) })}
          </span>
        )}
        {busy && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-line border-t-accent" aria-hidden="true" />}
      </div>

      <div ref={listRef} id={listId} role="listbox" aria-label={t("palette.aria")} className="max-h-[min(440px,60vh)] overflow-y-auto p-1.5 [scrollbar-width:thin]">
        {rows.length === 0 && !busy && (
          <div className="px-4 py-9 text-center">
            <p className="text-[13.5px] font-medium text-ink">{t("palette.empty", { q: term })}</p>
            <p className="mt-1 text-[12.5px] text-faint">{t("palette.emptyHint", { key: data.project.key || "CORP" })}</p>
          </div>
        )}
        {rows.length === 0 && busy && <p className="px-4 py-9 text-center text-[12.5px] text-faint">{t("palette.searching")}</p>}
        {rows.map((r, i) => {
          const header = r.group !== lastGroup ? t(GROUP_LABEL[r.group]) : null;
          lastGroup = r.group;
          const on = i === safeActive;
          return (
            <div key={r.id}>
              {header && <p className="px-2.5 pb-1 pt-2.5 text-[11.5px] font-semibold text-faint first:pt-1">{header}</p>}
              <div
                id={`${listId}-${i}`}
                data-row={i}
                role="option"
                aria-selected={on}
                onMouseMove={() => !on && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={done(r.run)}
                className={`palette-row relative flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-[13.5px] ${on ? "is-active text-ink" : "text-sub"}`}
              >
                <span className="flex w-[18px] shrink-0 justify-center">{r.icon}</span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {r.hint && <span className="shrink-0">{r.hint}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="flex h-9 items-center gap-4 border-t border-linesoft px-4 text-[11.5px] text-faint">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t("palette.hintSelect")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {t("palette.hintRun")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {t("palette.hintClose")}
        </span>
        <span className="ml-auto font-mono tabular">{paletteShortcut()}</span>
      </footer>
    </Modal>
  );
}

/** Оверлей «?» (ТЗ 5.8 п.5): все сочетания в одном месте. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const groups: { title: TKey; items: [React.ReactNode, TKey][] }[] = [
    {
      title: "shortcuts.groupGlobal",
      items: [
        [<Kbd key="k">{paletteShortcut()}</Kbd>, "shortcuts.palette"],
        [<Kbd key="s">/</Kbd>, "shortcuts.search"],
        [<Kbd key="c">C</Kbd>, "shortcuts.create"],
        [
          <span key="n" className="flex items-center gap-1">
            <Kbd>1</Kbd>–<Kbd>4</Kbd>
          </span>,
          "shortcuts.views",
        ],
        [
          <span key="gh" className="flex items-center gap-1">
            <Kbd>G</Kbd> <Kbd>H</Kbd>
          </span>,
          "shortcuts.goHome",
        ],
        [
          <span key="gr" className="flex items-center gap-1">
            <Kbd>G</Kbd> <Kbd>R</Kbd>
          </span>,
          "shortcuts.goReports",
        ],
        [
          <span key="gs" className="flex items-center gap-1">
            <Kbd>G</Kbd> <Kbd>S</Kbd>
          </span>,
          "shortcuts.goSettings",
        ],
        [<Kbd key="e">Esc</Kbd>, "shortcuts.close"],
        [<Kbd key="h">?</Kbd>, "shortcuts.help"],
      ],
    },
    {
      title: "shortcuts.groupBoard",
      items: [
        [<Kbd key="enter">↵</Kbd>, "shortcuts.openCard"],
        [<Kbd key="m">M</Kbd>, "shortcuts.moveCard"],
      ],
    },
  ];
  return (
    <Modal onClose={onClose} w={460} title={t("shortcuts.title")}>
      <div className="flex items-center gap-2.5 border-b border-linesoft px-5 py-4">
        <IcKeyboard size={18} tone="violet" />
        <h3 className="text-[15px] font-semibold text-ink">{t("shortcuts.title")}</h3>
        <button onClick={onClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink" aria-label={t("common.close")}>
          <IcX size={14} />
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">
        {groups.map((g) => (
          <section key={g.title}>
            <p className="mb-1.5 text-[12px] font-semibold text-faint">{t(g.title)}</p>
            <ul className="divide-y divide-linesoft/70">
              {g.items.map(([keys, label]) => (
                <li key={label} className="flex h-9 items-center justify-between text-[13.5px] text-ink">
                  {t(label)}
                  {keys}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

