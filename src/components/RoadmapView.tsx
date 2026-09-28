/** Роадмап проектов (ТЗ 5.15): видимые проекты полосами во времени, сгруппированные по отделам; вехи отметками;
 *  зависимости линиями; линия «сегодня»; масштаб недели / месяцы / кварталы; заливка — доля закрытых задач.
 *  Шкала, сетка, шапка и «сегодня» — общие примитивы Таймлайна (timeScale.ts, TimeCanvas.tsx), не вторая реализация.
 *  Клик — в проект. Диаграммы Ганта по задачам, пересчёта дат по зависимостям и «инициатив» здесь нет — по ТЗ.
 *
 *  Производительность (бюджет 5.2, 100 проектов): строка (`Row`, memo) знает позиции только в днях от начала шкалы,
 *  а пиксели считает CSS — `calc(дни * var(--ppd))`, где --ppd (px на день) стоит один раз на контейнере. Смена
 *  масштаба меняет одну переменную и шапку делений, строки React не перерисовывает. Но переменная наследуется всем
 *  поддеревом, и пересчёт стилей растёт с числом элементов (замер: 100 проектов, ×4 CPU — 200–300 мс только на
 *  стили), поэтому в DOM — только строки в окне прокрутки плюс запас (высоты фиксированы: ROW_H, GROUP_H), остальные
 *  не рисуются. Линии зависимостей — SVG-атрибуты в пикселях (их десятки), перерисовываются при смене масштаба.
 *  Все позиции — CSSOM (cssVars, ADR-0010), не style="". */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoadmapDto, RoadmapProjectDto } from "../../server/src/contract";
import { roadmapApi } from "../api";
import { useStore } from "../store";
import { useT } from "../i18n";
import { cssVars } from "../cssVars";
import { PX_PER_DAY, daysBetween, scaleTicks, timeScale, ZOOMS, type Zoom } from "../timeScale";
import { TimeCanvas, TIME_PAD } from "./TimeCanvas";
import { ROW_H, barSpan, isLate, parseDay, roadmapRange, rowPositions, visibleItems, type BarSpan, type Group } from "../roadmapLayout";
import { Tabs } from "../ds/Tabs";
import { Button } from "../ds/Button";
import { EmptyState } from "../ds/Display";
import { IcFlag, IcSettings } from "../icons";
import { ProjectMark, projectTone } from "../ui";

const ZOOM_KEY = "taskira.roadmap.zoom";
const readZoom = (): Zoom => {
  try {
    const v = localStorage.getItem(ZOOM_KEY);
    return ZOOMS.includes(v as Zoom) ? (v as Zoom) : "month";
  } catch {
    return "month";
  }
};

/** Позиция на шкале в CSS: TIME_PAD + дни × px/день (--ppd ставит контейнер). */
const at = (days: number) => `calc(${TIME_PAD}px + ${days} * var(--ppd))`;
const len = (days: number) => `calc(${days} * var(--ppd))`;

type State = { data: RoadmapDto | null; error: string | null; loading: boolean };

export default function RoadmapView() {
  const { t, lang } = useT();
  const { data, setView, switchProject } = useStore();
  const [state, setState] = useState<State>({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    roadmapApi.get().then(
      (d) => setState({ data: d, error: null, loading: false }),
      (e: unknown) => setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) })),
    );
  }, []);
  useEffect(load, [load]);

  const [zoom, setZoomState] = useState<Zoom>(readZoom);
  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try {
      localStorage.setItem(ZOOM_KEY, z);
    } catch {
      /* приватный режим — масштаб не переживёт перезагрузку */
    }
  };

  const scrollEl = useRef<HTMLDivElement | null>(null);
  const [viewportW, setViewportW] = useState(0);
  // Окно прокрутки по вертикали, округлённое до половины строки: перерисовка — только когда в окно входит новая строка.
  const [win, setWin] = useState({ top: 0, h: 0 });
  const ro = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLElement) => {
    const r = node.getBoundingClientRect();
    const top = Math.floor(node.scrollTop / (ROW_H / 2)) * (ROW_H / 2);
    setViewportW(r.width);
    setWin((w) => (w.top === top && w.h === r.height ? w : { top, h: r.height }));
  }, []);
  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollEl.current = node;
      ro.current?.disconnect();
      ro.current = null;
      if (node) {
        measure(node);
        ro.current = new ResizeObserver(() => measure(node));
        ro.current.observe(node);
      }
    },
    [measure],
  );

  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const now = useMemo(() => new Date(), []);
  const projects = useMemo(() => state.data?.projects ?? [], [state.data]);
  const deps = useMemo(() => state.data?.dependencies ?? [], [state.data]);

  // Отделы — по имени, проекты внутри — по дате начала (без дат — в конце), затем по имени.
  const groups = useMemo<Group<RoadmapProjectDto>[]>(() => {
    const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? t("home.noDepartment");
    const by = new Map<string, RoadmapProjectDto[]>();
    for (const p of projects) by.set(p.departmentId, [...(by.get(p.departmentId) ?? []), p]);
    const startKey = (p: RoadmapProjectDto) => barSpan(p, now)?.from.getTime() ?? Infinity;
    return [...by.entries()]
      .map(([id, ps]) => ({ id, name: deptName(id), projects: ps.sort((a, b) => startKey(a) - startKey(b) || a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, data.departments, now, t]);

  const spans = useMemo(() => new Map<string, BarSpan | null>(projects.map((p) => [p.id, barSpan(p, now)])), [projects, now]);
  const waits = useMemo(() => {
    const names = new Map(projects.map((p) => [p.id, p.name]));
    const m = new Map<string, string>();
    for (const d of deps) m.set(d.dependentId, [m.get(d.dependentId), names.get(d.sourceId)].filter(Boolean).join(", "));
    return m;
  }, [projects, deps]);
  const range = useMemo(() => roadmapRange(projects, now), [projects, now]);
  const scale = useMemo(() => {
    const fill = Math.ceil((viewportW - TIME_PAD - 48) / PX_PER_DAY[zoom]);
    return timeScale(range.origin, Math.max(range.days, fill), zoom);
  }, [range, zoom, viewportW]);
  const ticks = useMemo(
    () =>
      scaleTicks(scale, zoom, {
        day: (d) => String(d.getDate()),
        month: (d) => d.toLocaleDateString(locale, { month: "short" }).replace(".", ""),
        year: (d) => String(d.getFullYear()),
        quarter: (d) => t("timeline.quarter", { n: Math.floor(d.getMonth() / 3) + 1 }),
      }),
    [scale, zoom, locale, t],
  );
  const todayX = scale.x(now) + scale.pxPerDay / 2;
  const today = useMemo(() => ({ x: todayX, label: now.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "") }), [todayX, now, locale]);
  const { y: rowY, height } = useMemo(() => rowPositions(groups), [groups]);
  // Высота шапки TimeCanvas (два ряда по 24 px + граница) — строки начинаются под ней.
  const shown = useMemo(() => visibleItems(groups, win.top - 49, win.h || 800, 600), [groups, win]);

  // Сегодня — у левой четверти экрана: видно и начатое, и ближайшее.
  const scrollToToday = (smooth: boolean) =>
    scrollEl.current?.scrollTo({ left: Math.max(0, TIME_PAD + todayX - Math.min(240, viewportW / 4)), behavior: smooth ? "smooth" : "auto" });
  const didScroll = useRef(false);
  useEffect(() => {
    if (didScroll.current || !viewportW || projects.length === 0) return;
    didScroll.current = true;
    scrollToToday(false);
  });

  // Действия строк — стабильные ссылки (строки memo), свежие данные стора — через ref.
  const storeRef = useRef({ data, setView, switchProject });
  storeRef.current = { data, setView, switchProject };
  const open = useCallback((id: string) => {
    const { data: d, setView: sv, switchProject: sp } = storeRef.current;
    sv(d.projects.find((x) => x.id === id)?.defaultView ?? "board");
    if (id !== d.currentProjectId) sp(id);
  }, []);
  const edit = useCallback((id: string) => {
    const { data: d, setView: sv, switchProject: sp } = storeRef.current;
    if (id !== d.currentProjectId) sp(id);
    sv("projectSettings", "roadmap");
  }, []);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-5 sm:px-6">
      <div className="min-w-0">
        <h1 className="font-disp text-[20px] font-bold tracking-[-0.025em] text-ink">{t("roadmap.title")}</h1>
        <p className="mt-0.5 text-[12.5px] text-faint">{t("roadmap.subtitle")}</p>
      </div>
      {projects.length > 0 && (
        <div className="mb-0.5 flex shrink-0 items-center gap-2">
          <Tabs label={t("timeline.zoom")} value={zoom} onChange={setZoom} items={ZOOMS.map((z) => ({ id: z, label: t(`timeline.zoom.${z}`) }))} />
          <button
            onClick={() => scrollToToday(true)}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-sub ring-1 ring-inset ring-line transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-subtle)]" /> {t("timeline.today")}
          </button>
        </div>
      )}
    </div>
  );

  if (state.loading && !state.data)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="mx-4 sm:mx-6" aria-busy="true" aria-label={t("common.loading")}>
          {["ml-[4%] w-[46%]", "ml-[18%] w-[62%]", "ml-[30%] w-[38%]"].map((cls) => (
            <div key={cls} className="py-4">
              <div className="skeleton h-3.5 w-40" />
              <div className={`skeleton mt-3 h-6 rounded-lg ${cls}`} />
            </div>
          ))}
        </div>
      </div>
    );
  if (state.error && !state.data)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="mx-4 sm:mx-6">
          <EmptyState
            icon={<IcFlag size={22} tone="teal" />}
            title={t("roadmap.loadError")}
            sub={state.error}
            action={<Button size="sm" variant="secondary" onClick={load}>{t("common.retry")}</Button>}
          />
        </div>
      </div>
    );
  if (projects.length === 0)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="mx-4 sm:mx-6">
          <EmptyState icon={<IcFlag size={22} tone="teal" />} title={t("roadmap.emptyTitle")} sub={t("roadmap.emptySub")} />
        </div>
      </div>
    );

  const x = (d: Date) => TIME_PAD + scale.x(d);
  const endX = (d: Date) => x(d) + scale.pxPerDay; // последний день включительно
  const todayDay = daysBetween(range.origin, now);

  return (
    <div className="flex h-full flex-col">
      {header}
      <div
        ref={scrollRef}
        onScroll={(e) => measure(e.currentTarget)}
        tabIndex={0}
        role="group"
        aria-label={t("roadmap.aria")}
        className="focusable relative min-h-0 flex-1 overflow-auto border-t border-linesoft"
      >
        <TimeCanvas scale={scale} ticks={ticks} today={today}>
          <div className="relative h-[var(--rows-h)]" ref={cssVars({ "--rows-h": height, "--ppd": scale.pxPerDay })}>
            {/* Линии зависимостей: от конца полосы источника к началу зависимой. Красная — источник не успевает. */}
            <svg aria-hidden className="pointer-events-none absolute left-0 top-0 z-[1] h-[var(--rows-h)] w-full overflow-visible">
              <defs>
                <marker id="rm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 8 4 0 8z" className="fill-[var(--text-3)]" />
                </marker>
                <marker id="rm-arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 8 4 0 8z" className="fill-[var(--status-danger)]" />
                </marker>
              </defs>
              {deps.map((d) => {
                const s = spans.get(d.sourceId);
                const dep = spans.get(d.dependentId);
                const y1 = rowY.get(d.sourceId);
                const y2 = rowY.get(d.dependentId);
                if (!s || !dep || y1 === undefined || y2 === undefined) return null;
                const x1 = endX(s.to);
                const x2 = x(dep.from);
                const bend = Math.max(24, Math.abs(x2 - x1) / 2);
                const late = isLate(d, spans);
                return (
                  <path
                    key={`${d.sourceId}>${d.dependentId}`}
                    d={`M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 2} ${y2}`}
                    fill="none"
                    strokeWidth={1.5}
                    markerEnd={`url(#${late ? "rm-arrow-late" : "rm-arrow"})`}
                    className={late ? "stroke-[var(--status-danger)]" : "stroke-[var(--text-3)] opacity-70"}
                  />
                );
              })}
            </svg>

            {shown.map((it) =>
              it.kind === "group" ? (
                <div key={`g:${it.group.id}`} ref={cssVars({ "--y": it.y })} className="absolute inset-x-0 top-[var(--y)] h-[36px]">
                  <div className="sticky left-0 flex h-full w-fit items-end px-4 pb-1.5 text-[12px] font-semibold text-sub sm:px-6">
                    {it.group.name} · {it.group.projects.length}
                  </div>
                </div>
              ) : (
                <Row
                  key={it.item.id}
                  y={it.y}
                  p={it.item}
                  span={spans.get(it.item.id) ?? null}
                  origin={range.origin}
                  todayDay={todayDay}
                  now={now}
                  waits={waits.get(it.item.id) ?? ""}
                  locale={locale}
                  onOpen={open}
                  onEdit={edit}
                />
              ),
            )}
          </div>
        </TimeCanvas>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-linesoft px-4 py-2 text-[12px] text-faint sm:px-6">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-px bg-accent" /> {t("roadmap.legend.today")}
        </span>
        <span className="flex items-center gap-2">
          <span data-tone="violet" className="rm-row inline-flex">
            <span className="rm-hatch inline-block h-2.5 w-5 rounded-sm ring-1 ring-inset ring-line" />
          </span>
          {t("roadmap.legend.tentative")}
        </span>
        <span className="flex items-center gap-2">
          <span data-tone="violet" className="rm-row inline-flex">
            <span className="rm-milestone inline-block h-2 w-2 rotate-45 rounded-[1px]" />
          </span>
          {t("roadmap.legend.milestone")}
        </span>
        {deps.length > 0 && <span>{t("roadmap.legend.deps")}</span>}
      </div>
    </div>
  );
}

/** Строка проекта. Все позиции — в днях от начала шкалы; пиксели — CSS (см. шапку файла). */
const Row = memo(function Row({
  y,
  p,
  span,
  origin,
  todayDay,
  now,
  waits,
  locale,
  onOpen,
  onEdit,
}: {
  y: number;
  p: RoadmapProjectDto;
  span: BarSpan | null;
  origin: Date;
  todayDay: number;
  now: Date;
  waits: string;
  locale: string;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const { t } = useT();
  const fmt = (s: string) => parseDay(s).toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const d0 = span ? daysBetween(origin, span.from) : todayDay;
  const dn = span ? daysBetween(span.from, span.to) + 1 : 0;
  const s0 = span?.solidFrom ? daysBetween(span.from, span.solidFrom) : 0;
  const sn = span?.solidFrom && span.solidTo ? daysBetween(span.solidFrom, span.solidTo) + 1 : 0;
  const title = [
    p.name,
    p.startDate || p.targetDate ? `${p.startDate ? fmt(p.startDate) : "…"} — ${p.targetDate ? fmt(p.targetDate) : "…"}` : t("roadmap.noDates"),
    t("roadmap.progress", { done: p.done, total: p.total }),
    waits ? t("roadmap.waits", { names: waits }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      data-tone={p.color ?? projectTone(p.key)}
      className="rm-row absolute inset-x-0 top-[var(--row-y)] h-[84px]"
      ref={cssVars({ "--row-y": y, "--bar-x": at(d0), "--bar-w": `max(8px, ${len(dn)})`, "--solid-x": len(s0), "--solid-w": len(sn), "--pct": `${pct}%` })}
    >
      <div className="timeline-name absolute left-0 top-3 z-[2] flex max-w-[520px] items-center gap-2 py-0.5 pl-1 pr-2">
        <button onClick={() => onOpen(p.id)} className="flex min-w-0 items-center gap-2 rounded-md text-left transition-colors duration-150 hover:text-accent">
          <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={18} />
          <span className="truncate text-[13px] font-bold tracking-[-0.01em] text-ink">{p.name}</span>
        </button>
        <span className="shrink-0 rounded-md bg-sunken px-1.5 text-[11px] font-semibold tabular text-sub ring-1 ring-inset ring-linesoft">
          {span ? t("roadmap.progressShort", { done: p.done, total: p.total }) : t("roadmap.noDates")}
        </span>
        {p.canEdit && (
          <button
            onClick={() => onEdit(p.id)}
            aria-label={t("roadmap.edit", { name: p.name })}
            title={t("roadmap.edit", { name: p.name })}
            className="shrink-0 rounded-md p-1 text-faint transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            <IcSettings size={13} />
          </button>
        )}
      </div>
      {span && (
        <button
          onClick={() => onOpen(p.id)}
          title={title}
          aria-label={title}
          className="timeline-bar group absolute left-0 top-[51px] z-[2] flex h-[22px] items-center overflow-hidden rounded-md text-ink ring-1 ring-inset ring-[var(--bar-edge)]"
        >
          <span aria-hidden className="rm-hatch absolute inset-0" />
          {sn > 0 && (
            <span aria-hidden className="absolute inset-y-0 left-[var(--solid-x)] w-[var(--solid-w)] overflow-hidden">
              <span className="timeline-bar-bg absolute inset-0" />
              <span className="timeline-bar-fill absolute inset-y-0 left-0 w-[var(--pct)]" />
            </span>
          )}
          <span className="relative z-10 min-w-0 truncate px-2 font-mono text-[10.5px] font-semibold">{p.key}</span>
        </button>
      )}
      {p.milestones.map((m) => {
        const md = daysBetween(origin, parseDay(m.date));
        return (
          <span
            key={m.id}
            ref={cssVars({ "--mx": `calc(${TIME_PAD}px + ${md + 0.5} * var(--ppd))` })}
            title={`${m.name} · ${fmt(m.date)}`}
            className="absolute left-[var(--mx)] top-[40px] z-[3] flex h-[22px] items-center"
          >
            <span aria-hidden data-done={daysBetween(parseDay(m.date), now) > 0 || undefined} className="rm-milestone -ml-[5px] h-2.5 w-2.5 rotate-45 rounded-[2px] ring-2 ring-[var(--bg-panel)]" />
            <span className="absolute left-0 top-[24px] max-w-[160px] -translate-x-1/2 truncate text-[10.5px] font-semibold text-sub">{m.name}</span>
          </span>
        );
      })}
    </div>
  );
});
