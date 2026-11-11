/** Карточка доски, её заглушка и своё изображение при перетаскивании. Вынесено из Board.tsx без изменения поведения. */
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cssVars } from "../cssVars";
import { localToday } from "../calendarLayout";
import { enter } from "../motion";
import { flipPending, noteLanding as noteFlipLanding } from "../boardFlip";
import { fmtDate } from "../store/mappers";
import type { Issue, Status, User } from "../types";
import { DueRing, IcMove, IcSubtasks, PriorityIcon, StatusGlyph } from "../icons";
import { directionColor, labelTone } from "../ui";
import { UserAvatarGroup } from "./UserAvatar";
import { Checkbox } from "../ds/Field";
import { Menu } from "../ds/LazyOverlay";
import { RepeatMark } from "./RepeatMark";
import { Skeleton, Tag } from "../ds/Display";
import { useT } from "../i18n";
import { preloadIssueModal } from "../lazyModals";
import { type IssueEpic } from "../api";

/** Карточка доски.
 *
 *  Ассоциированные сущности приходят СВЕРХУ уже найденными, а не ищутся здесь
 *  через data.users.find / data.issues.find: раньше каждая карточка линейно
 *  проходила оба массива, что давало квадратичную сложность на весь экран
 *  (аудит PERF-02). Плюс memo — чтобы тик счётчика уведомлений в общем контексте
 *  не перерисовывал все карточки разом (PERF-01).
 */
export const Card = memo(function Card({
  issue,
  usersById,
  epic,
  status,
  statusPos,
  onOpen: openIssue,
  onDragStart,
  onDragEnd,
  onDropOn,
  onOver,
  onMove,
  flash,
  draggable,
  moveTargets,
  selecting,
  selected,
  onToggleSelect,
}: {
  issue: Issue;
  /** Справочник пользователей (стабилен, пока не меняется `data.users`): исполнители
   *  карточки выбираются здесь, а не массивом сверху — новый массив на каждый рендер
   *  доски ломал memo (ADR-0011, шаг 0). */
  usersById: ReadonlyMap<string, User>;
  /** Направление карточки из справочника (`useEpics`), а не из списка задач в сторе. */
  epic: Pick<IssueEpic, "id" | "title" | "color"> | undefined;
  /** Статус карточки (стабильный объект из справочника) и его место в процессе 0…1 — для глифа. */
  status: Status | undefined;
  statusPos: number;
  /** Открыть задачу. Пропсом, а не `useStore()` внутри: подписка на контекст обходит memo. */
  onOpen: (id: string) => void;
  /** Все колбэки стабильны (useCallback в доске/колонке) и получают задачу аргументом,
   *  а не замыкают её: иначе memo(Card) не держит (ADR-0011, шаг 0). */
  onDragStart: (issue: Issue) => void;
  onDragEnd: () => void;
  onDropOn: (e: React.DragEvent, target: Issue) => void;
  onOver: () => void;
  onMove: (issueId: string, statusId: string) => void;
  flash: boolean;
  draggable: boolean;
  moveTargets: Status[];
  /** Режим выделения (ROUTE-03): клик и Enter/пробел отмечают карточку вместо открытия, перетаскивание выключено —
   *  так выделение не спорит с нативным drag&drop одной карточки (ADR-0007). */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { t, lang } = useT();
  const assignees = useMemo(
    () => issue.assigneeIds.map((id) => usersById.get(id)).filter((u): u is User => !!u),
    [issue.assigneeIds, usersById],
  );
  const [menu, setMenu] = useState(false);
  // Приземление после переноса (ТЗ 5.13 п.3) и сдвиг соседей — FLIP в `boardFlip.ts` по снимку из `moveOnBoard`.
  // Здесь — только появление (ADR-0035, прототип): карточка смонтировалась с отметкой свежего события и не
  // переносом (у переноса есть снимок) — значит, это новая задача; въезжает пружиной. Один раз, при монтировании.
  const cardRef = useRef<HTMLElement>(null);
  // Новая карточка (не перенос): въезжает пружиной `enter()`, а CSS-приземление `dropLand` ей не нужно — иначе два
  // движения по transform спорят. Цветовая вспышка остаётся (`anim-flash*`, без transform).
  const [fresh] = useState(() => flash && !flipPending(issue.id));
  useLayoutEffect(() => {
    if (fresh && cardRef.current) enter(cardRef.current);
  }, []);
  const doneCat = status?.category === "done";
  const today = localToday();
  const dueDays = issue.dueDate ? Math.round((Date.parse(issue.dueDate) - Date.parse(today)) / 864e5) : null;
  const overdue = !!issue.dueDate && !doneCat && issue.dueDate < today;

  // Перемещение без мыши (UX-02): меню открывается кнопкой и клавишей M на карточке, поэтому управляемое. Клик мимо,
  // Esc и «открыто только одно на доске» даёт сам Popover API (popover="auto"). Меню живёт внутри карточки в дереве
  // React, поэтому клики и клавиши из него не должны всплывать до карточки (иначе Enter по пункту открыл бы задачу).
  const moveButton = draggable && !selecting && (
    <span
      className="flex"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Глушим только то, что карточка поняла бы неверно: клавиши изнутри меню и Enter/Пробел на кнопке (иначе
        // открылась бы задача). M на кнопке и остальные клавиши (J/K, общие сочетания) идут дальше как обычно.
        if ((e.target as Element).closest("[popover]") || e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
    >
      <Menu
        open={menu}
        onOpenChange={setMenu}
        placement="bottom-end"
        label={t("board.moveAria", { key: issue.key })}
        trigger={(p, open) => (
          <button
            {...p}
            type="button"
            aria-label={t("board.moveAria", { key: issue.key })}
            aria-keyshortcuts="M"
            title={t("hint.boardMove")}
            className={`flex h-5 w-5 items-center justify-center rounded-md text-faint transition-opacity hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100 ${open ? "opacity-100" : "opacity-0"}`}
          >
            <IcMove size={14} />
          </button>
        )}
        items={
          moveTargets.length === 0
            ? [{ kind: "label", id: "none", label: t("board.noAllowedTransitions") }]
            : moveTargets.map((target) => ({
                id: target.id,
                label: target.name,
                icon: <StatusGlyph category={target.category} size={15} />,
                onSelect: () => onMove(issue.id, target.id),
              }))
        }
      />
    </span>
  );

  return (
    <article
      ref={cardRef}
      draggable={draggable && !selecting}
      aria-label={`${issue.key}: ${issue.title}`}
      data-selected={selecting && selected ? "" : undefined}
      onKeyDown={(e) => {
        // «m» / «ь» — открыть список переходов с клавиатуры: перетаскивание
        // мышью было единственным способом сменить статус на доске (UX-02).
        if (draggable && !selecting && (e.key.toLowerCase() === "m" || e.key === "ь")) {
          e.preventDefault();
          setMenu((v) => !v);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.id);
        e.dataTransfer.effectAllowed = "move";
        setDragGhost(e);
        onDragStart(issue);
      }}
      onDragEnd={(e) => {
        e.currentTarget.removeAttribute("data-dragging");
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOver();
      }}
      onDrop={(e) => onDropOn(e, issue)}
      onPointerEnter={preloadIssueModal}
      onFocus={preloadIssueModal}
      onClick={() => (selecting ? onToggleSelect(issue.id) : openIssue(issue.id))}
      data-issue-id={issue.id}
      data-priority={!doneCat && issue.priorityId === "critical" ? "critical" : undefined}
      data-done={doneCat || undefined}
      className={`board-card group relative flex cursor-pointer flex-col ${flash ? `anim-${fresh ? "flash" : "drop"}${doneCat ? "-done" : ""}` : ""}`}
    >
      <div className="board-card-title-row flex min-h-5 items-start gap-2">
        {selecting && (
          <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onChange={() => onToggleSelect(issue.id)} label={t("backlog.selectRow", { key: issue.key })} labelHidden tabIndex={-1} />
          </span>
        )}
        <h3 className="min-w-0 flex-1"><button type="button" className="board-card-open" aria-label={selecting ? t("backlog.selectRow", { key: issue.key }) : issue.key + ": " + issue.title} aria-pressed={selecting ? selected : undefined} onClick={e => { e.stopPropagation(); if (selecting) onToggleSelect(issue.id); else openIssue(issue.id); }}>{issue.title}</button></h3>
        {moveButton}
      </div>
      {epic && <div className="board-card-direction" title={epic.title}>
        <i ref={cssVars({ "--direction-color": directionColor(epic.id, epic.color) })} />
        <span>{epic.title}</span>
      </div>}
      {issue.labels.length > 0 && <div className="board-card-labels" title={issue.labels.length > 2 ? issue.labels.join(", ") : undefined}>
        {issue.labels.slice(0, 2).map(l => <Tag key={l} size="sm" tone={labelTone(l)}>{l}</Tag>)}
        {issue.labels.length > 2 && <span className="board-card-labels-more tabular">+{issue.labels.length - 2}</span>}
      </div>}
      <div className="board-card-meta">
        <PriorityIcon p={issue.priorityId} size={17} />
        <span className="board-card-key tabular">{issue.key}</span>
        {issue.dueDate && <span className="board-card-due tabular"
          data-urgency={doneCat ? "done" : overdue ? "late" : dueDays !== null && dueDays <= 3 ? "soon" : "later"}
          title={overdue ? t("board.quickChip.overdue") : undefined}
          aria-label={overdue ? t("board.overdueDate", { date: fmtDate(issue.dueDate, lang) }) : undefined}>
          <DueRing due={issue.dueDate} today={today} done={doneCat} size={14} />
          <span>{fmtDate(issue.dueDate, lang)}</span>
        </span>}
        {issue.repeat && <RepeatMark repeat={issue.repeat} solo={!issue.dueDate} className="board-card-repeat" />}
        <span className="board-card-assignees ml-auto flex items-center gap-2">
          {!!issue.subtasksSummary?.total && <span
            className="board-card-subtasks flex items-center gap-1 tabular"
            data-complete={issue.subtasksSummary.done === issue.subtasksSummary.total || undefined}
            title={t("board.subtasksTip", { done: issue.subtasksSummary.done, total: issue.subtasksSummary.total })}
            aria-label={t("board.subtasksTip", { done: issue.subtasksSummary.done, total: issue.subtasksSummary.total })}>
            <IcSubtasks size={14} />{issue.subtasksSummary.done}/{issue.subtasksSummary.total}
          </span>}
          <UserAvatarGroup users={assignees} size={22} interactive />
        </span>
      </div>
    </article>
  );
});

/** Заглушка повторяет порядок и размеры карточки. */
export function BoardSkeletonCard() {
  return <div className="board-card flex flex-col" aria-hidden="true">
    <Skeleton.Line h={14} /><Skeleton.Line w="66%" h={14} />
    <div className="flex h-[22px] items-center gap-2">
      <Skeleton.Line w="64px" h={12} /><Skeleton.Line w="56px" h={20} />
      <span className="ml-auto"><Skeleton.Circle size={22} /></span>
    </div>
  </div>;
}


/**
 * Своё изображение перетаскиваемой карточки (ТЗ 5.13 п.3, ADR-0007 — нативный DnD):
 * копия карточки чуть под наклоном, с акцентной кромкой и тенью, а на исходном
 * месте — пунктирный силуэт (`data-dragging`). Атрибут и размеры пишутся через
 * DOM/CSSOM, не через состояние React: начало перетаскивания не перерисовывает
 * ни одной карточки (ADR-0011, шаг 0), а CSSOM разрешён CSP (ADR-0010).
 */
/** Где курсор взял карточку и куда её отпустили — для FLIP-приземления в Card (модульное состояние: перетаскивание
 *  одно на страницу, а через React оно перерисовало бы доску). */
let grab = { x: 0, y: 0 };
export const noteLanding = (id: string, e: React.DragEvent) => noteFlipLanding(id, e.clientX - grab.x, e.clientY - grab.y);

export function setDragGhost(e: React.DragEvent<HTMLElement>) {
  const card = e.currentTarget;
  card.setAttribute("data-dragging", "");
  const rect = card.getBoundingClientRect();
  grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  if (typeof e.dataTransfer.setDragImage !== "function") return;
  const wrap = document.createElement("div");
  wrap.className = "drag-ghost";
  const clone = card.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-dragging");
  clone.removeAttribute("id");
  clone.style.width = `${rect.width}px`;
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  // Точка захвата — там же, где курсор взял карточку (+ поле обёртки под тень).
  e.dataTransfer.setDragImage(wrap, e.clientX - rect.left + 16, e.clientY - rect.top + 16);
  requestAnimationFrame(() => wrap.remove());
}
