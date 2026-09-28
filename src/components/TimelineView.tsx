import { useCallback, useMemo, useRef, useState } from "react";
import { PX_PER_DAY, addDays, scaleTicks, startOfWeek, timeScale, ZOOMS, type Zoom } from "../timeScale";
import { TimeCanvas, TIME_PAD } from "./TimeCanvas";
import { cssVars } from "../cssVars";
import { Tabs } from "../ds/Tabs";
import { useStore } from "../store";
import { ISSUE_PAGE_SIZE, freshRows, useEpics, useIssueSet, useIssuesRevision, useLoadMoreSentinel, useOnRevision, type IssueSetQuery } from "../issuePages";
import { IcChevR, IcTimeline } from "../icons";
import { Lozenge, SkeletonRow, directionColor } from "../ui";
import { Button } from "../ds/Button";
import { EmptyState } from "../ds/Display";
import { TypeIcon } from "../icons";
import { useT } from "../i18n";

// Направления лежат на сетке недель от текущего понедельника (issues.t_start / t_span — номера недель),
// горизонт — год. Масштаб (недели / месяцы / кварталы) меняет только px на день, не данные.
const WEEKS = 52;
const ZOOM_KEY = "taskira.timeline.zoom";
const readZoom = (): Zoom => {
  try {
    const v = localStorage.getItem(ZOOM_KEY);
    return ZOOMS.includes(v as Zoom) ? (v as Zoom) : "week";
  } catch {
    return "week";
  }
};

/** Задачи раскрытого направления: собственный постраничный набор (`?epicId=`), а не выборка из
 *  всех задач в сторе. Число в шапке узла — агрегат сервера по ВСЕМ детям, поэтому пока набор не
 *  дочитан, показанных строк меньше числа в шапке: это ожидаемо и подписано «Показано N из M». */
function EpicChildren({ projectId, epicId, total }: { projectId: string; epicId: string; total: number }) {
  const { t } = useT();
  const { idx, openIssue } = useStore();
  const query = useMemo<IssueSetQuery | null>(
    () => (projectId ? { projectId, filters: { epicId }, sort: "rank", dir: "asc" } : null),
    [projectId, epicId],
  );
  const set = useIssueSet(query, { withCounts: false });
  useOnRevision(useIssuesRevision(), set.revalidate);
  const rows = useMemo(() => freshRows(set.items, idx.issues), [set.items, idx.issues]);
  const { hasMore, loading, loadingMore, loadMore } = set;
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading && !loadingMore, rows.length);

  if (loading && rows.length === 0) {
    return (
      <div aria-busy="true" aria-label={t("common.loading")}>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (set.error && rows.length === 0) {
    return (
      <div className="px-10 py-2.5 text-[12px] text-danger">
        <p>{t("timeline.childrenError")}</p>
        <button onClick={set.reload} className="mt-1 font-semibold text-accent hover:underline">
          {t("common.retry")}
        </button>
      </div>
    );
  }
  return (
    <>
      {rows.length === 0 && <p className="px-10 py-2.5 text-[12px] text-faint">{t("timeline.noIssues")}</p>}
      {rows.map((k) => {
        const st = idx.statuses.get(k.statusId);
        if (!st) return null;
        return (
            <button key={k.id} onClick={() => openIssue(k.id)} className="flex w-full items-center gap-2.5 px-10 py-2 text-left transition-colors hover:bg-accentsoft/60">
              <TypeIcon type={k.typeId} size={13} />
              <span className="font-mono text-[10.5px] font-semibold text-faint">{k.key}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{k.title}</span>
              <Lozenge status={st} size="sm" />
            </button>
        );
      })}
      <div ref={sentinelRef} className="px-10 py-1.5 text-[11px] text-faint">
        {set.error ? (
          <button onClick={loadMore} className="font-semibold text-accent hover:underline">
            {t("board.loadMoreFailed")}
          </button>
        ) : hasMore ? (
          <span className="flex items-center gap-3">
            <span>{t("timeline.shownOf", { shown: rows.length, total })}</span>
            {!loadingMore && (
              <button onClick={loadMore} className="font-semibold text-accent hover:underline">
                {t("timeline.loadMore")}
              </button>
            )}
          </span>
        ) : null}
      </div>
    </>
  );
}

export default function TimelineView() {
  const { t, lang } = useT();
  const { data, openIssue, setView } = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [zoom, setZoomState] = useState<Zoom>(readZoom);
  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try {
      localStorage.setItem(ZOOM_KEY, z);
    } catch {
      /* приватный режим — масштаб не переживёт перезагрузку */
    }
  };
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  // Ширина видимой части скроллящейся панели — нужна раскрытому списку задач направления, который
  // остаётся на месте при горизонтальной прокрутке (sticky left-0), и шкале: на мелком масштабе год
  // уже экрана, и шкала дотягивается до правого края. getBoundingClientRect (border-box), а не
  // contentRect — иначе первый колбэк RO расходится с начальным значением на ширину рамки.
  const [viewportW, setViewportW] = useState(0);
  // callback-ref, а не эффект с [] — панель появляется только когда направления загрузились.
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollElRef.current = node;
    resizeObsRef.current?.disconnect();
    resizeObsRef.current = null;
    if (node) {
      setViewportW(node.getBoundingClientRect().width);
      const ro = new ResizeObserver(() => setViewportW(node.getBoundingClientRect().width));
      ro.observe(node);
      resizeObsRef.current = ro;
    }
  }, []);

  // Направления и агрегат по детям (сколько всего и сколько закрыто) — одним запросом сервера
  // (`GET …/issues/epics`), а не выводом из загруженных задач: при частичном сторе Timeline иначе
  // остался бы пустым или неверным. Обновляется по issuesRevision (закрытые зависят от статусов).
  const revision = useIssuesRevision();
  const epicsState = useEpics(data.currentProjectId || null, revision);
  const epics = epicsState.list;

  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const origin = useMemo(() => startOfWeek(new Date()), []);
  const scale = useMemo(() => {
    const fill = Math.ceil((viewportW - TIME_PAD - 48) / PX_PER_DAY[zoom]);
    return timeScale(origin, Math.max(WEEKS * 7, fill), zoom);
  }, [origin, zoom, viewportW]);
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
  const now = new Date();
  const today = { x: scale.x(now) + scale.pxPerDay / 2, label: now.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "") };
  const weekPx = 7 * scale.pxPerDay;

  const scrollToToday = () => scrollElRef.current?.scrollTo({ left: 0, behavior: "smooth" });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-5 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-disp text-[20px] font-bold tracking-[-0.025em] text-ink">{t("timeline.title")}</h1>
          <p className="mt-0.5 text-[12.5px] text-faint">{t("timeline.subtitle")}</p>
        </div>
        {epics.length > 0 && (
          <div className="mb-0.5 flex shrink-0 items-center gap-2">
            <Tabs
              label={t("timeline.zoom")}
              value={zoom}
              onChange={setZoom}
              items={ZOOMS.map((z) => ({ id: z, label: t(`timeline.zoom.${z}`) }))}
            />
            <button
              onClick={scrollToToday}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-sub ring-1 ring-inset ring-line transition-colors hover:bg-hover hover:text-ink"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-subtle)]" /> {t("timeline.today")}
            </button>
          </div>
        )}
      </div>

      {epicsState.loading && epics.length === 0 ? (
        <div className="mx-4 sm:mx-6" aria-busy="true" aria-label={t("common.loading")}>
          {["ml-[4%] w-[46%]", "ml-[18%] w-[62%]", "ml-[30%] w-[38%]"].map((cls) => (
            <div key={cls} className="py-4">
              <div className="skeleton h-3.5 w-40" />
              <div className={`skeleton mt-3 h-7 rounded-lg ${cls}`} />
            </div>
          ))}
        </div>
      ) : epicsState.error && epics.length === 0 ? (
        <div className="mx-4 sm:mx-6">
          <EmptyState
            icon={<IcTimeline size={22} tone="teal" />}
            title={t("timeline.loadError")}
            sub={epicsState.error}
            action={<Button size="sm" variant="secondary" onClick={epicsState.reload}>{t("common.retry")}</Button>}
          />
        </div>
      ) : epics.length === 0 ? (
        <div className="mx-4 sm:mx-6">
          <EmptyState
            icon={<IcTimeline size={22} tone="teal" />}
            title={t("timeline.emptyTitle")}
            sub={t("timeline.emptySub")}
            action={<Button size="sm" variant="secondary" onClick={() => setView("backlog")}>{t("empty.timeline.action")}</Button>}
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          tabIndex={0}
          role="group"
          aria-label={t("timeline.aria")}
          className="focusable relative min-h-0 flex-1 overflow-auto border-t border-linesoft"
        >
          <TimeCanvas scale={scale} ticks={ticks} today={today}>
            {epics.map((epic) => {
              // Счётчики — агрегат сервера по всем детям; раскрытый список может показывать меньше
              // (постраничная подгрузка): это не рассинхрон, под списком подписано «Показано N из M».
              const total = epic.childTotal;
              const done = epic.childDone;
              const start = Math.max(0, Math.min(epic.tStart ?? 0, WEEKS - 1));
              const span = Math.max(1, Math.min(epic.tSpan ?? 3, WEEKS - start));
              const barW = Math.max(8, span * weekPx);
              const expanded = open[epic.id];
              const pct = total ? Math.round((done / total) * 100) : 0;
              return (
                <div
                  key={epic.id}
                  className="relative"
                  ref={cssVars({
                    "--bar-x": TIME_PAD + scale.x(addDays(origin, start * 7)),
                    "--bar-w": barW,
                    "--bar": directionColor(epic.id, epic.color),
                    "--pct": `${pct}%`,
                  })}
                >
                  {/* Строка направления: имя стоит у начала своей полосы (как роадмап Linear), полоса — под ним. */}
                  <div className="relative h-[84px]">
                    <button
                      onClick={() => setOpen((o) => ({ ...o, [epic.id]: !expanded }))}
                      aria-expanded={expanded}
                      className="timeline-name absolute left-0 top-3 flex max-w-[520px] items-center gap-2 rounded-md py-0.5 pl-1 pr-2 text-left transition-colors hover:bg-hover/70"
                    >
                      <IcChevR size={11} className={`shrink-0 text-faint transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--bar)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--bar)_20%,transparent)]" />
                      <span className="truncate text-[13px] font-bold tracking-[-0.01em] text-ink">{epic.title}</span>
                      <span className="shrink-0 rounded-md bg-sunken px-1.5 text-[11px] font-semibold tabular text-sub ring-1 ring-inset ring-linesoft">
                        {t("timeline.issueCount", { done, total, key: epic.key })}
                      </span>
                    </button>
                    <button
                      onClick={() => openIssue(epic.id)}
                      title={t("timeline.barTitle", { title: epic.title, done, total })}
                      className="timeline-bar group absolute left-0 top-[50px] flex h-7 items-center overflow-hidden rounded-lg text-ink ring-1 ring-inset ring-[var(--bar-edge)]"
                    >
                      {/* Заливка — мягкий градиент тона направления; прогресс — насыщенная часть того же тона. */}
                      <span aria-hidden className="timeline-bar-bg absolute inset-0" />
                      <span className="timeline-bar-fill absolute inset-y-0 left-0 w-[var(--pct)]" />
                      {barW >= 64 && <span className="relative z-10 truncate px-2.5 font-mono text-[11px]">{epic.key}</span>}
                      {barW * (pct / 100) >= 104 && (
                        <span className="absolute left-[var(--pct)] top-1/2 z-10 -translate-x-[calc(100%+7px)] -translate-y-1/2 text-[11px] font-bold tabular">{pct}%</span>
                      )}
                    </button>
                  </div>
                  {expanded && (
                    <div
                      ref={cssVars({ "--panel-w": Math.max(0, (viewportW || 600) - 32) })}
                      className="anim-fadeup sticky left-4 mb-2 ml-4 w-[var(--panel-w)] rounded-lg border border-linesoft bg-panel/90 shadow-e1"
                    >
                      <EpicChildren projectId={data.currentProjectId} epicId={epic.id} total={total} />
                    </div>
                  )}
                </div>
              );
            })}
          </TimeCanvas>
        </div>
      )}

      {(epicsState.truncated || epics.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-linesoft px-4 py-2 text-[12px] text-faint sm:px-6">
          <span className="flex items-center gap-2">
            <span className="inline-block h-3 w-px bg-accent" /> {t("timeline.legend")}
          </span>
          {epicsState.truncated && <span className="font-medium text-warn">{t("timeline.epicsTruncated", { n: epics.length })}</span>}
        </div>
      )}
    </div>
  );
}
