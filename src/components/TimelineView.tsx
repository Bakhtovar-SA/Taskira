import { useCallback, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { ISSUE_PAGE_SIZE, freshRows, useEpics, useIssueSet, useIssuesRevision, useLoadMoreSentinel, useOnRevision, type IssueSetQuery } from "../issuePages";
import { IcChevR, IcTimeline } from "../icons";
import { Lozenge, Empty, SkeletonRow, directionColor } from "../ui";
import { TypeIcon } from "../icons";
import { useT } from "../i18n";

// 52 недель (год) с пиксельными колонками + горизонтальный скролл — раньше
// было 8 фиксированных недель без возможности посмотреть дальше (overdrive).
const WEEKS = 52;
const WEEK_PX = 56;
/** Поле слева от первой недели — чтобы подпись направления у края не липла к рамке. */
const LEFT_PX = 24;
const CANVAS_W = LEFT_PX + WEEKS * WEEK_PX + 48;

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
  const { data, openIssue } = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  // Ширина видимой части скроллящейся панели (без учёта того, что реально
  // прокручено вбок) — нужна раскрытому списку задач направления, который
  // должен оставаться на месте при горизонтальном скролле недель (см. ниже,
  // sticky left-0). "100%" внутри него равнялось бы полной прокручиваемой
  // ширине (260px + 52 недели), а 100vw — ширине всего окна, а не панели.
  const [viewportW, setViewportW] = useState(0);
  // callback-ref, а не useEffect с [] — сам скроллящийся div рендерится только
  // когда epics.length > 0 (изначально при загрузке данных его в DOM ещё нет),
  // эффект «один раз при монтировании» просто ничего бы не нашёл и не
  // переподключился бы позже, когда div появится.
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollElRef.current = node;
    resizeObsRef.current?.disconnect();
    resizeObsRef.current = null;
    if (node) {
      setViewportW(node.getBoundingClientRect().width); // сразу, не ждём первый колбэк observer'а
      // getBoundingClientRect (border-box), а не entries[0].contentRect (content-box) —
      // иначе первый колбэк RO расходится с начальным значением на ширину border (1-2px).
      const ro = new ResizeObserver(() => setViewportW(node.getBoundingClientRect().width));
      ro.observe(node);
      resizeObsRef.current = ro;
    }
  }, []);

  const weeks = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return Array.from({ length: WEEKS }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i * 7);
      return d;
    });
  }, []);

  // Направления и агрегат по детям (сколько всего и сколько закрыто) — одним запросом сервера
  // (`GET …/issues/epics`), а не выводом из загруженных задач: раньше «направления» получались
  // из epicId загруженных задач, и при частичном сторе Timeline остался бы пустым или неверным.
  // Timeline обновляется по issuesRevision (счётчики закрытых зависят от смены статусов).
  const revision = useIssuesRevision();
  const epicsState = useEpics(data.currentProjectId || null, revision);
  const epics = epicsState.list;
  const dayOfWeek = (new Date().getDay() + 6) % 7;
  const todayPx = ((dayOfWeek + 0.5) / 7) * WEEK_PX;

  const scrollToToday = () => scrollElRef.current?.scrollTo({ left: 0, behavior: "smooth" });

  const locale = lang === "ru" ? "ru-RU" : "en-US";
  // Месяцы над неделями: подпись и пунктир там, где неделя начинает новый месяц.
  const months = useMemo(
    () =>
      weeks
        .map((w, i) => ({ i, w }))
        .filter(({ w, i }) => i === 0 || w.getMonth() !== weeks[i - 1].getMonth())
        .map(({ w, i }) => ({ i, label: w.toLocaleDateString(locale, { month: "short" }).replace(".", ""), year: w.getMonth() === 0 ? w.getFullYear() : null })),
    [weeks, locale],
  );
  const todayLabel = new Date().toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between gap-3 px-4 pb-3 pt-5 sm:px-6">
        <div>
          <h1 className="font-disp text-[20px] font-bold tracking-[-0.025em] text-ink">{t("timeline.title")}</h1>
          <p className="mt-0.5 text-[12.5px] text-faint">{t("timeline.subtitle")}</p>
        </div>
        {epics.length > 0 && (
          <button
            onClick={scrollToToday}
            className="mb-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-sub ring-1 ring-inset ring-line transition-colors hover:bg-hover hover:text-ink"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-subtle)]" /> {t("timeline.today")}
          </button>
        )}
      </div>

      {epicsState.loading && epics.length === 0 ? (
        <div className="mx-4 sm:mx-6" aria-busy="true" aria-label={t("common.loading")}>
          {[0, 1, 2].map((n) => (
            <div key={n} className="py-4">
              <div className="skeleton h-3.5 w-40" />
              <div className="skeleton mt-3 h-7 rounded-lg" style={{ width: `${[46, 62, 38][n]}%`, marginLeft: `${[4, 18, 30][n]}%` }} />
            </div>
          ))}
        </div>
      ) : epicsState.error && epics.length === 0 ? (
        <div className="mx-4 sm:mx-6">
          <Empty
            icon={<IcTimeline size={20} tone="teal" />}
            title={t("timeline.loadError")}
            sub={epicsState.error}
            action={
              <button
                onClick={epicsState.reload}
                className="h-8 rounded-lg border border-line bg-panel px-3 text-[12.5px] font-medium text-sub shadow-e1 hover:bg-hover hover:text-ink"
              >
                {t("common.retry")}
              </button>
            }
          />
        </div>
      ) : epics.length === 0 ? (
        <div className="mx-4 sm:mx-6">
          <Empty icon={<IcTimeline size={20} tone="teal" />} title={t("timeline.emptyTitle")} sub={t("timeline.emptySub")} />
        </div>
      ) : (
        <div
          ref={scrollRef}
          tabIndex={0}
          role="group"
          aria-label={t("timeline.aria")}
          className="focusable relative min-h-0 flex-1 overflow-auto border-t border-linesoft"
        >
          <div className="relative min-h-full" style={{ width: CANVAS_W }}>
            {/* Сетка: недели — один фоновый repeating-gradient (не 52 элемента на
                строку), границы месяцев — пунктир. Лежит под строками на всю высоту. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0"
              style={{
                left: LEFT_PX,
                backgroundImage: `repeating-linear-gradient(to right, color-mix(in oklch, var(--border-subtle) 70%, transparent) 0 1px, transparent 1px ${WEEK_PX}px)`,
              }}
            />
            {months.slice(1).map((m) => (
              <span
                key={m.i}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-0 border-l border-dashed border-line"
                style={{ left: LEFT_PX + m.i * WEEK_PX }}
              />
            ))}
            {/* Линия «сегодня» с датой в шапке. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent shadow-[0_0_12px_var(--accent-glow)]"
              style={{ left: LEFT_PX + todayPx }}
            />

            {/* Шапка: месяцы и недели, стекло поверх прокрутки. */}
            <div className="glass sticky top-0 z-10 border-b border-linesoft">
              <div className="relative h-6">
                {months.map((m) => (
                  <span
                    key={m.i}
                    className="absolute top-[7px] text-[11px] font-bold uppercase tracking-[0.06em] text-sub"
                    style={{ left: LEFT_PX + Math.max(m.i * WEEK_PX + 6, m.i === 0 ? todayPx + 34 : 0) }}
                  >
                    {m.label}
                    {m.year ? ` ${m.year}` : ""}
                  </span>
                ))}
              </div>
              <div className="relative h-6">
                {weeks.map((w, i) => (
                  <span
                    key={i}
                    className={`absolute top-0.5 w-[56px] text-center text-[11.5px] tabular ${i === 0 ? "font-bold text-accenttext" : "text-faint"}`}
                    style={{ left: LEFT_PX + i * WEEK_PX - WEEK_PX / 2 + 1 }}
                  >
                    {w.getDate()}
                  </span>
                ))}
                <em
                  className="absolute -top-5 z-30 -translate-x-1/2 rounded-md bg-accent px-1.5 text-[10.5px] font-bold not-italic leading-4 text-onaccent shadow-[0_2px_10px_-2px_var(--accent-glow)]"
                  style={{ left: LEFT_PX + todayPx }}
                >
                  {todayLabel}
                </em>
              </div>
            </div>

            {epics.map((epic) => {
              // Счётчики — агрегат сервера по всем детям; раскрытый список может показывать меньше
              // (постраничная подгрузка): это не рассинхрон, под списком подписано «Показано N из M».
              const total = epic.childTotal;
              const done = epic.childDone;
              const start = Math.max(0, Math.min(epic.tStart ?? 0, WEEKS - 1));
              const span = Math.max(1, Math.min(epic.tSpan ?? 3, WEEKS - start));
              const expanded = open[epic.id];
              const pct = total ? Math.round((done / total) * 100) : 0;
              return (
                <div
                  key={epic.id}
                  className="relative"
                  style={
                    {
                      "--bar-x": `${LEFT_PX + start * WEEK_PX}px`,
                      "--bar": directionColor(epic.id, epic.color),
                    } as React.CSSProperties
                  }
                >
                  {/* Строка направления: имя стоит у начала своей полосы (как роадмап
                      Linear), полоса — под ним. */}
                  <div className="relative h-[84px]">
                    <button
                      onClick={() => setOpen((o) => ({ ...o, [epic.id]: !expanded }))}
                      aria-expanded={expanded}
                      className="timeline-name absolute left-0 top-3 flex max-w-[520px] items-center gap-2 rounded-md py-0.5 pl-1 pr-2 text-left transition-colors hover:bg-hover/70"
                    >
                      <IcChevR size={11} className={`shrink-0 text-faint transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_color-mix(in_oklch,var(--bar)_20%,transparent)]" style={{ background: "var(--bar)" }} />
                      <span className="truncate text-[13px] font-bold tracking-[-0.01em] text-ink">{epic.title}</span>
                      <span className="shrink-0 rounded-md bg-sunken px-1.5 text-[11px] font-semibold tabular text-sub ring-1 ring-inset ring-linesoft">
                        {t("timeline.issueCount", { done, total: total, key: epic.key })}
                      </span>
                    </button>
                    <button
                      onClick={() => openIssue(epic.id)}
                      title={t("timeline.barTitle", { title: epic.title, done, total: total })}
                      className="timeline-bar group absolute left-0 top-[50px] flex h-7 items-center overflow-hidden rounded-lg text-ink ring-1 ring-inset ring-[var(--bar-edge)]"
                      style={{ width: span * WEEK_PX }}
                    >
                      {/* Атмосферная заливка полосы: мягкий градиент тона направления
                          (ТЗ 5.12 f / 5.15 — «градиент в календаре»), прогресс — насыщенная
                          часть того же тона со светящейся передней кромкой. */}
                      <span aria-hidden className="timeline-bar-bg absolute inset-0" />
                      <span className="timeline-bar-fill absolute inset-y-0 left-0" style={{ width: `${pct}%` }} />
                      <span className="relative z-10 truncate px-2.5 font-mono text-[11px]">{epic.key}</span>
                      {span * WEEK_PX * (pct / 100) >= 104 && (
                        <span className="absolute top-1/2 z-10 -translate-x-[calc(100%+7px)] -translate-y-1/2 text-[11px] font-bold tabular" style={{ left: `${pct}%` }}>
                          {pct}%
                        </span>
                      )}
                    </button>
                  </div>
                  {expanded && (
                    <div className="anim-fadeup sticky left-0 mb-2 rounded-lg border border-linesoft bg-panel/90 shadow-e1" style={{ width: Math.max(0, (viewportW || 600) - 32), marginLeft: 16 }}>
                      <EpicChildren projectId={data.currentProjectId} epicId={epic.id} total={total} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
