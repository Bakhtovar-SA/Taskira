/** Роадмап: фиксированные проекты и отдельно прокручиваемая шкала из общих примитивов Таймлайна.
 * В DOM только видимые строки; координаты календарной шкалы передаются через CSSOM (ADR-0010). */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoadmapDto, RoadmapProjectDto } from "../../server/src/contract";
import { roadmapApi } from "../api";
import { useStore } from "../store";
import { useT } from "../i18n";
import { cssVars } from "../cssVars";
import { PX_PER_DAY, addDays, scaleTicks, timeScale, ZOOMS, type TimeScale, type Zoom } from "../timeScale";
import { TimeCanvas, TimeHeader, TIME_PAD } from "./TimeCanvas";
import { ROW_H, barSpan, isLate, parseDay, roadmapRange, rowPositions, visibleItems, type BarSpan, type Group } from "../roadmapLayout";
import { Tabs } from "../ds/Tabs";
import { Button, IconButton } from "../ds/Button";
import { Menu } from "../ds/Overlay";
import { EmptyState } from "../ds/Display";
import { IcFlag, IcDots } from "../icons";
import { ProjectMark, projectTone } from "../ui";
import "../styles/roadmap.css";

const ZOOM_KEY = "taskira.roadmap.zoom";
const readZoom = (): Zoom => {
  try { const z = localStorage.getItem(ZOOM_KEY) as Zoom; return ZOOMS.includes(z) ? z : "month"; }
  catch { return "month"; }
};

export default function RoadmapView() {
  const { t, tn, lang, errText } = useT();
  const { data, setView, switchProject } = useStore();
  const [state, setState] = useState<{ data: RoadmapDto | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    setState(s => ({ ...s, loading: true, error: null }));
    roadmapApi.get().then(
      d => { if (request.current === id) setState({ data: d, error: null, loading: false }); },
      e => { if (request.current === id) setState(s => ({ ...s, loading: false, error: e instanceof Error ? e : new Error(String(e)) })); },
    );
  }, []);
  useEffect(() => { load(); return () => { request.current++; }; }, [load]);
  const [zoom, setZoom] = useState<Zoom>(readZoom);
  const [department, setDepartment] = useState("");
  const changeZoom = (z: Zoom) => { setZoom(z); try { localStorage.setItem(ZOOM_KEY, z); } catch { /* private mode */ } };
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const now = useMemo(() => new Date(), []);
  const projects = useMemo(() => state.data?.projects ?? [], [state.data]);
  const groups = useMemo<Group<RoadmapProjectDto>[]>(() => {
    const by = new Map<string, RoadmapProjectDto[]>();
    for (const p of projects) by.set(p.departmentId, [...(by.get(p.departmentId) ?? []), p]);
    const start = (p: RoadmapProjectDto) => barSpan(p, now)?.from.getTime() ?? Infinity;
    return [...by].map(([id, ps]) => ({ id, name: data.departments.find(d => d.id === id)?.name ?? t("home.noDepartment"),
      projects: ps.sort((a, b) => start(a) - start(b) || a.name.localeCompare(b.name)) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, data.departments, now, t]);
  const filtered = useMemo(() => groups.filter(g => !department || g.id === department), [groups, department]);
  const spans = useMemo(() => new Map(projects.map(p => [p.id, barSpan(p, now)])), [projects, now]);
  const deps = useMemo(() => state.data?.dependencies ?? [], [state.data]);
  const waits = useMemo(() => {
    const names = new Map(projects.map(p => [p.id, p.name]));
    const m = new Map<string, string>();
    for (const d of deps) m.set(d.dependentId, [m.get(d.dependentId), names.get(d.sourceId)].filter(Boolean).join(", "));
    return m;
  }, [projects, deps]);
  const range = useMemo(() => roadmapRange(projects, now), [projects, now]);
  const { y: rowY, height } = useMemo(() => rowPositions(filtered), [filtered]);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement | null>(null);
  const header = useRef<HTMLDivElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [win, setWin] = useState({ top: 0, h: 0, w: 0 });
  const measure = useCallback((node: HTMLDivElement) => {
    const top = Math.floor(node.scrollTop / (ROW_H / 2)) * (ROW_H / 2);
    setWin(w => w.top === top && w.h === node.clientHeight && w.w === node.clientWidth ? w : { top, h: node.clientHeight, w: node.clientWidth });
    left.current?.style.setProperty("--scrollbar-h", `${node.offsetHeight - node.clientHeight}px`);
    if (left.current && left.current.scrollTop !== node.scrollTop) left.current.scrollTop = node.scrollTop;
    header.current?.style.setProperty("--scroll-x", `${node.scrollLeft}px`);
  }, []);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    right.current = node; observer.current?.disconnect(); observer.current = null;
    if (node) { measure(node); observer.current = new ResizeObserver(() => measure(node)); observer.current.observe(node); }
  }, [measure]);
  const scale = useMemo(() => timeScale(range.origin, Math.max(range.days, Math.ceil((win.w - TIME_PAD - 48) / (zoom === "month" ? 96 / 31 : PX_PER_DAY[zoom]))), zoom, 96), [range, zoom, win.w]);
  const ticks = useMemo(() => scaleTicks(scale, zoom, {
    day: d => String(d.getDate()), month: d => d.toLocaleDateString(locale, { month: "short" }).replace(".", ""),
    year: d => String(d.getFullYear()), quarter: d => t("timeline.quarter", { n: Math.floor(d.getMonth() / 3) + 1 }),
  }), [scale, zoom, locale, t]);
  const today = useMemo(() => ({ x: (scale.x(now) + scale.x(addDays(now, 1))) / 2, label: now.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "") }), [scale, now, locale]);
  const shown = useMemo(() => visibleItems(filtered, win.top, win.h || 800, ROW_H * 3), [filtered, win.top, win.h]);
  const scrollToToday = useCallback((smooth: boolean) => right.current?.scrollTo({ left: Math.max(0, TIME_PAD + today.x - Math.min(240, win.w / 4)), behavior: smooth ? "smooth" : "auto" }), [today, win.w]);
  useEffect(() => { if (win.w) scrollToToday(false); }, [scrollToToday, win.w]);
  useEffect(() => { if (right.current) { right.current.scrollTop = 0; measure(right.current); } }, [department, measure]);
  const store = useRef({ data, setView, switchProject }); store.current = { data, setView, switchProject };
  const open = useCallback((id: string) => {
    const { data: d, setView: sv, switchProject: sp } = store.current;
    sv(d.projects.find(p => p.id === id)?.defaultView ?? "board"); if (id !== d.currentProjectId) sp(id);
  }, []);
  const edit = useCallback((id: string) => {
    const { data: d, setView: sv, switchProject: sp } = store.current;
    if (id !== d.currentProjectId) sp(id); sv("projectSettings", "roadmap");
  }, []);
  const departmentName = groups.find(g => g.id === department)?.name ?? t("roadmap.allDepartments");
  const x = (d: Date) => TIME_PAD + scale.x(d);
  return <div className="roadmap-view">
    <header className="roadmap-toolbar">
      <h1>{t("roadmap.title")}</h1>
      <span className="roadmap-count">{projects.length} {tn(projects.length, "roadmap.projects.one", "roadmap.projects.few", "roadmap.projects.many")} · {groups.length} {tn(groups.length, "roadmap.departments.one", "roadmap.departments.few", "roadmap.departments.many")}</span>
      <div className="roadmap-tools">
        <Menu label={t("roadmap.allDepartments")} trigger={props => <Button {...props} size="sm" variant="ghost" className="roadmap-filter" iconRight={<span aria-hidden>▾</span>}>{departmentName}</Button>}
          items={[{ id: "all", label: t("roadmap.allDepartments"), onSelect: () => setDepartment("") }, ...groups.map(g => ({ id: g.id, label: g.name, onSelect: () => setDepartment(g.id) }))]} />
        <Tabs mode="filter" label={t("timeline.zoom")} value={zoom} onChange={changeZoom} items={ZOOMS.map(z => ({ id: z, label: t(`timeline.zoom.${z}`) }))} />
        <Button size="sm" variant="secondary" onClick={() => scrollToToday(true)}>{t("timeline.today")}</Button>
      </div>
    </header>
    {state.loading && !state.data ? <div aria-busy="true" aria-label={t("common.loading")} className="p-4">{[0, 1, 2].map(i => <div key={i} className="skeleton mb-4 h-10 rounded-md" />)}</div> : state.error ?
      <EmptyState icon={<IcFlag size={22} />} title={t("roadmap.loadError")} sub={errText(state.error, "")} action={<Button size="sm" onClick={load}>{t("common.retry")}</Button>} /> : !projects.length ?
      <EmptyState icon={<IcFlag size={22} />} title={t("roadmap.emptyTitle")} sub={t("roadmap.emptySub")} /> : <>
      <div className="roadmap-columns roadmap-headings">
        <div className="roadmap-project-heading">{t("roadmap.projectHeading")}</div>
        <div className="roadmap-scale-clip"><div ref={node => { header.current = node; cssVars({ "--canvas-w": TIME_PAD + scale.width + 48, "--scroll-x": right.current?.scrollLeft ?? 0 })(node); }} className="roadmap-scale-shift"><TimeHeader ticks={ticks} today={today} compact monthYears={zoom === "month"} /></div></div>
      </div>
      <div className="roadmap-columns roadmap-body">
        <div ref={left} className="roadmap-projects" onScroll={e => { if (right.current && right.current.scrollTop !== e.currentTarget.scrollTop) right.current.scrollTop = e.currentTarget.scrollTop; }}>
          <div className="roadmap-rows" ref={cssVars({ "--rows-h": height })}>
            {shown.map(it => it.kind === "group" ? <div key={it.group.id} ref={cssVars({ "--row-y": it.y })} className="roadmap-department">{it.group.name} · {it.group.projects.length}</div> :
              <ProjectRow key={it.item.id} y={it.y} p={it.item} now={now} locale={locale} onOpen={open} onEdit={edit} />)}
          </div>
        </div>
        <div ref={scrollRef} onScroll={e => measure(e.currentTarget)} tabIndex={0} role="group" aria-label={t("roadmap.aria")} className="roadmap-timeline focusable">
          <TimeCanvas scale={scale} ticks={ticks} today={today} header={false} compact>
            <div className="roadmap-rows" ref={cssVars({ "--rows-h": height })}>
              <svg aria-hidden className="roadmap-dependencies" width={TIME_PAD + scale.width + 48} height={height}>
                <defs>{[false, true].map(late => <marker key={String(late)} id={late ? "rm-arrow-late" : "rm-arrow"} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" className={late ? "fill-[var(--status-danger)]" : "fill-[var(--text-3)]"} /></marker>)}</defs>
                {deps.map(d => {
                  const s = spans.get(d.sourceId), dest = spans.get(d.dependentId), y1 = rowY.get(d.sourceId), y2 = rowY.get(d.dependentId);
                  if (!s || !dest || y1 === undefined || y2 === undefined) return null;
                  const x1 = x(addDays(s.to, 1)), x2 = x(dest.from), bend = Math.max(24, Math.abs(x2 - x1) / 2), late = isLate(d, spans);
                  return <path key={`${d.sourceId}>${d.dependentId}`} d={`M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 2} ${y2}`} fill="none" strokeWidth={1.5} markerEnd={`url(#${late ? "rm-arrow-late" : "rm-arrow"})`} className={late ? "stroke-[var(--status-danger)]" : "stroke-[var(--text-3)] opacity-70"} />;
                })}
              </svg>
              {shown.map(it => it.kind === "group" ? <div key={it.group.id} ref={cssVars({ "--row-y": it.y })} className="roadmap-department-band" /> :
                <TimelineRow key={it.item.id} y={it.y} p={it.item} span={spans.get(it.item.id) ?? null} scale={scale} todayX={today.x} waits={waits.get(it.item.id) ?? ""} locale={locale} onOpen={open} onEdit={edit} />)}
            </div>
          </TimeCanvas>
        </div>
      </div>
      <footer className="roadmap-legend">{(["today", "done", "remaining", "tentative", "milestone", "deps"] as const).map(item => <span key={item}><i aria-hidden data-kind={item} />{t(`roadmap.legend.${item}`)}</span>)}</footer>
    </>}
  </div>;
}

type RowProps = { y: number; p: RoadmapProjectDto; locale: string; onOpen: (id: string) => void; onEdit: (id: string) => void };
const format = (date: string, locale: string) => parseDay(date).toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
const ProjectRow = memo(function ProjectRow({ y, p, now, locale, onOpen, onEdit }: RowProps & { now: Date }) {
  const { t } = useT();
  const milestone = [...p.milestones].filter(m => parseDay(m.date) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())).sort((a, b) => a.date.localeCompare(b.date))[0];
  return <div data-project-id={p.id} className="roadmap-project-row" ref={cssVars({ "--row-y": y })}>
    <button className="roadmap-project-open ds-focus" onClick={() => onOpen(p.id)} title={p.name}>
      <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={24} />
      <span className="roadmap-project-copy"><strong>{p.name}</strong><small>{milestone ? `${milestone.name} · ${format(milestone.date, locale)}` : !p.startDate && !p.targetDate ? t("roadmap.noDates") : `${p.startDate ? format(p.startDate, locale) : "…"} — ${p.targetDate ? format(p.targetDate, locale) : "…"}`}</small></span>
      <span className="roadmap-progress">{p.done} / {p.total}</span>
    </button>
    {p.canEdit && <div className="roadmap-row-menu"><Menu placement="bottom-end" label={t("roadmap.edit", { name: p.name })}
      trigger={props => <IconButton {...props} size="sm" label={t("roadmap.rowMenu", { name: p.name })}><IcDots size={16} /></IconButton>}
      items={[{ id: "dates", label: t("roadmap.edit", { name: p.name }), onSelect: () => onEdit(p.id) }]} /></div>}
  </div>;
});
const TimelineRow = memo(function TimelineRow({ y, p, span, scale, todayX, waits, locale, onOpen, onEdit }: RowProps & { span: BarSpan | null; scale: TimeScale; todayX: number; waits: string }) {
  const { t } = useT();
  const x = (d: Date) => TIME_PAD + scale.x(d);
  const width = span ? Math.max(68, scale.x(addDays(span.to, 1)) - scale.x(span.from)) : 0;
  const progress = Math.min(1, Math.max(0, p.total ? p.done / p.total : 0));
  const confirmed = span?.solidFrom && span.solidTo ? scale.x(addDays(span.solidTo, 1)) - scale.x(span.solidFrom) : 0;
  const title = [p.name, `${p.startDate ? format(p.startDate, locale) : "…"} — ${p.targetDate ? format(p.targetDate, locale) : "…"}`, t("roadmap.progress", { done: p.done, total: p.total }), waits ? t("roadmap.waits", { names: waits }) : ""].filter(Boolean).join(" · ");
  return <div className="rm-row roadmap-timeline-row" data-project-id={p.id} data-tone={p.color ?? projectTone(p.key)} ref={cssVars({ "--row-y": y })}>
    {span ? <button className="roadmap-bar ds-focus" onClick={() => onOpen(p.id)} aria-label={title} title={title}
      ref={cssVars({ "--bar-x": x(span.from), "--bar-w": width, "--done-w": Math.min(width, Math.max(68, progress * width)), "--confirmed-w": confirmed })}>
      <span aria-hidden className="roadmap-bar-track"><span className="roadmap-bar-remaining" /><span className="roadmap-bar-done" /><span className="rm-hatch roadmap-bar-tentative" /><b className="roadmap-bar-key">{p.key}</b></span>
    </button> : <Button size="sm" variant="ghost" className="roadmap-set-dates" ref={cssVars({ "--bar-x": TIME_PAD + todayX })} disabled={!p.canEdit && t("roadmap.readOnly")} onClick={() => onEdit(p.id)}>{t("roadmap.setDates")}</Button>}
    {p.milestones.map(m => <span key={m.id} data-raised={span && scale.x(parseDay(m.date)) - scale.x(span.from) < 68 || undefined} title={`${m.name} · ${format(m.date, locale)}`} ref={cssVars({ "--mx": (x(parseDay(m.date)) + x(addDays(parseDay(m.date), 1))) / 2 })} className="roadmap-milestone"><i aria-hidden className="rm-milestone" /><span>{m.name}</span></span>)}
  </div>;
});
