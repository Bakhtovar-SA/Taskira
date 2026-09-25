import { useEffect, useId, useRef, useState } from "react";
import type { AccessRole, Status, User } from "./types";
import { useStore, useToasts } from "./store";
import { usersApi, getAvatarBlobUrl, type PickableUser } from "./api";
import { IcBriefcase, IcCamera, IcPhone, IcTrash, IcX } from "./icons";
import { BG_PRESETS, effectiveTheme, readBgId, readTheme, setBg, setThemeMode, type ThemeMode } from "./theme";
import { useT } from "./i18n";
import { cropAndResizeAvatar } from "./avatarCrop";
import { workflowStatusName } from "./workflowStatus";

/** Аватару достаточно имени/инициалов/цвета — принимаем любой такой объект
 *  (не только полный User: напр. `actor` в уведомлениях). id/avatarUpdatedAt
 *  опциональны для того же — если они есть, аватар кликабелен (карточка
 *  пользователя) и может показать загруженное фото, а не только инициалы. */
type AvatarUser = Pick<User, "name" | "initials" | "color"> & Partial<Pick<User, "id" | "avatarUpdatedAt">>;

/** Картинка аватарки (blob-URL, авторизованный fetch с кэшем — см. getAvatarBlobUrl
 *  в api/index.ts) — null, пока грузится или если её нет. */
function useAvatarSrc(userId?: string, avatarUpdatedAt?: number | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!userId || !avatarUpdatedAt) {
      setSrc(null);
      return;
    }
    getAvatarBlobUrl(userId, avatarUpdatedAt).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, avatarUpdatedAt]);
  return src;
}

export const Avatar = ({
  user,
  size = 26,
  ring = false,
  interactive = false,
}: {
  user: AvatarUser | null | undefined;
  size?: number;
  ring?: boolean;
  /** true — открывать карточку пользователя по клику (свой профиль/чужой).
   *  Default false: Avatar часто сидит внутри чужого интерактивного контрола
   *  (фильтр по исполнителю, пикер в Dropdown, триггер другого Dropdown) —
   *  там клик по аватарке должен управлять ЭТИМ контролом, а не открывать
   *  карточку, и вложенный Dropdown внутри уже открытого закрыл бы его
   *  (DROPDOWN_OPEN_EVT). Включай явно только там, где аватар — просто
   *  статичный показ личности (карточка/лента, не сам управляющий элемент). */
  interactive?: boolean;
}) => {
  const { t } = useT();
  const src = useAvatarSrc(user?.id, user?.avatarUpdatedAt);
  const canOpenCard = interactive && !!user?.id;

  if (!user)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line2 bg-sunken text-faint"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        title={t("createIssue.unassigned")}
      >
        –
      </span>
    );

  const circle = (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold tracking-[-0.02em] text-onaccent shadow-[inset_0_0_0_1px_oklch(1_0_0/0.12)] ${ring ? "ring-2 ring-panel" : ""} ${canOpenCard ? "cursor-pointer" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36, background: src ? undefined : user.color }}
      title={user.name}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : user.initials}
    </span>
  );

  if (!canOpenCard) return circle;

  // stopPropagation — Avatar souvent сидит внутри целиком кликабельной строки/
  // карточки (напр. Board.tsx открывает задачу по клику на всю карточку);
  // без этого клик по аватару одновременно открывал бы и карточку пользователя,
  // и саму задачу под ней.
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Dropdown button={() => circle} width={260}>
        {() => <UserCardBody userId={user.id!} />}
      </Dropdown>
    </span>
  );
};

/** Несколько исполнителей на карточке/в шапке задачи (несколько исполнителей
 *  на задаче — не путать с issue_collaborators) — внахлёст, максимум `max`
 *  штук, остаток — кружок «+N». Пустой список — тот же «не назначен», что
 *  одиночный Avatar(null). */
export const AvatarStack = ({
  users,
  size = 22,
  max = 3,
  interactive = false,
}: {
  users: AvatarUser[];
  size?: number;
  max?: number;
  /** true — все аватары в стопке кликабельны (карточка пользователя) — см.
   *  Avatar.interactive, тот же default false по той же причине. */
  interactive?: boolean;
}) => {
  const { t } = useT();
  if (users.length === 0) return <Avatar user={null} size={size} />;
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((u, i) => (
        <span key={i} className={i === 0 ? "" : "-ml-1.5"}>
          <Avatar user={u} size={size} ring interactive={interactive} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="-ml-1.5 inline-flex shrink-0 select-none items-center justify-center rounded-full bg-active font-semibold text-sub ring-2 ring-panel"
          style={{ width: size, height: size, fontSize: size * 0.34 }}
          title={t("ui.more", { count: overflow })}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
};

/** Знак проекта: плашка в тоне проекта с первой буквой ключа. Тон выбирается
 *  детерминированно по ключу из палитры проектов (ТЗ 5.3 п.6) — один и тот же
 *  проект всегда одного цвета, и цвет не хранится на сервере. */
const PROJECT_TONES = ["blue", "pink", "orange", "green", "teal", "red", "amber", "sky", "indigo"] as const;
export const projectTone = (key: string) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_TONES[h % PROJECT_TONES.length];
};
export const ProjectMark = ({ projectKey, size = 20 }: { projectKey: string; size?: number }) => (
  <span
    className={`tk-tone-${projectTone(projectKey)} inline-flex shrink-0 items-center justify-center rounded-md bg-current/15 font-bold ring-1 ring-inset ring-current/25`}
    style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    aria-hidden="true"
  >
    {projectKey[0]}
  </span>
);

/** Цвет направления: сохранённый в БД цвет, иначе — детерминированный тон из
 *  палитры проектов (ТЗ 5.3 п.6) по id, чтобы соседние полосы не сливались в
 *  один фиолетовый. */
const DIRECTION_HUES = [262, 312, 350, 25, 60, 150, 190, 230];
export const directionColor = (id: string, color?: string | null) => {
  if (color) return color;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `oklch(0.64 0.14 ${DIRECTION_HUES[h % DIRECTION_HUES.length]})`;
};

export const catColor = (cat: Status["category"]) =>
  cat === "done"
    ? { dot: "var(--c-ok)", bg: "var(--c-oksoft)", fg: "var(--c-ok-fg)" }
    : cat === "inprogress"
      ? { dot: "var(--c-warndot)", bg: "var(--c-warnsoft)", fg: "var(--c-warn-fg)" }
      : { dot: "var(--c-todo)", bg: "var(--c-todosoft)", fg: "var(--c-todo-fg)" };

export const Lozenge = ({ status, size = "md" }: { status: Status; size?: "sm" | "md" }) => {
  const { t } = useT();
  const c = catColor(status.category);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-[12px]"}`}
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />
      {workflowStatusName(status, t)}
    </span>
  );
};

export const Chip = ({ text, color, onRemove }: { text: string; color?: string; onRemove?: () => void }) => {
  const { t } = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[11.5px] ${color ? "font-medium" : "bg-sunken text-sub ring-1 ring-inset ring-linesoft"}`}
      style={color ? { background: `color-mix(in oklch, ${color} 14%, transparent)`, color } : undefined}
    >
      {text}
      {onRemove && (
        <button onClick={onRemove} className="rounded text-faint hover:bg-active hover:text-ink" aria-label={t("ui.remove", { text })}>
          <IcX size={10} />
        </button>
      )}
    </span>
  );
};

/** Событие «открылся какой-то дропдаун» — чтобы одновременно был открыт только
 *  один (ticket-scaling §2): каждый инстанс шлёт его при открытии со своим id,
 *  услышав чужой id — закрывается. Экспортирован — им же пользуется
 *  самодельное меню переходов на карточке доски (Board.tsx), которое не может
 *  использовать сам <Dropdown>: ему нужно открываться и с клавиатуры (m/ь), а
 *  не только по клику на кнопку. */
export const DROPDOWN_OPEN_EVT = "taskira:dropdown-open";

export function Dropdown({ button, children, align = "left", width = 240 }: { button: (open: boolean) => React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); align?: "left" | "right"; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const myId = useId();

  // Открытие другого дропдауна закрывает этот.
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== myId) setOpen(false);
    };
    window.addEventListener(DROPDOWN_OPEN_EVT, onOther);
    return () => window.removeEventListener(DROPDOWN_OPEN_EVT, onOther);
  }, [myId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const path = e.composedPath();
      if (ref.current && !path.includes(ref.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // capture + pointerdown закрывает меню ещё до React onClick и одинаково
    // работает для мыши, пера и тача. Bubble-mousedown терялся, когда внешний
    // компонент делал stopPropagation().
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) window.dispatchEvent(new CustomEvent(DROPDOWN_OPEN_EVT, { detail: myId }));
  };

  return (
    <div className="relative" ref={ref}>
      <div onClick={toggle}>{button(open)}</div>
      {open && (
        <div
          className="glass anim-pop absolute z-40 mt-1.5 overflow-hidden rounded-xl border border-line shadow-e3"
          style={{ width, [align]: 0 } as React.CSSProperties}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export const MenuItem = ({ onClick, children, danger, disabled, title }: { onClick?: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean; title?: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors duration-100 ${
      disabled ? "cursor-not-allowed text-faint" : danger ? "text-danger hover:bg-dangersoft" : "text-ink hover:bg-hover/70"
    }`}
  >
    {children}
  </button>
);

/** Содержимое карточки пользователя — без обёртки Dropdown, чтобы Topbar мог
 *  вставить её прямо в уже открытое меню профиля (обёртывать в ЕЩЁ один
 *  Dropdown внутри открытого было бы багом: любой другой открывшийся Dropdown
 *  закрывает все прочие через DROPDOWN_OPEN_EVT, так что вложенный тут же
 *  захлопнул бы меню профиля под собой). UserCardPopover ниже — тот же
 *  контент, но в собственном Dropdown, для клика по чужому аватару. Для себя
 *  дополнительно показывает загрузку/удаление аватарки (самообслуживание —
 *  см. план миграции 027, без admin-загрузки за другого). Должность/телефон
 *  читаются из уже загруженного data.users — отдельный запрос не нужен. */
export function UserCardBody({ userId }: { userId: string }) {
  const { t } = useT();
  const { data, idx, uploadAvatar, removeAvatar } = useStore();
  const user = idx.users.get(userId);
  const src = useAvatarSrc(user?.id, user?.avatarUpdatedAt);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;
  const isMe = data.currentUserId === userId;

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const cropped = await cropAndResizeAvatar(file);
      await uploadAvatar(cropped);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await removeAvatar();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-xl font-semibold text-onaccent shadow-e2"
          style={{ background: src ? undefined : user.color }}
        >
          {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : user.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{user.name}</p>
          {user.username && <p className="truncate text-[11.5px] text-faint">@{user.username}</p>}
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-linesoft pt-3 text-[12.5px] text-sub">
        <div className="flex items-center gap-2">
          <IcBriefcase size={13} />
          <span className="truncate">{user.role || t("userCard.notSet")}</span>
        </div>
        <div className="flex items-center gap-2">
          <IcPhone size={13} />
          <span className="truncate">{user.phone || t("userCard.notSet")}</span>
        </div>
      </div>

      {isMe && (
        <div className="mt-3 flex gap-1.5 border-t border-linesoft pt-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title={t("userCard.avatarHint")}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1.5 text-[12px] font-medium text-sub shadow-e1 transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            <IcCamera size={13} />
            {user.avatarUpdatedAt ? t("userCard.changeAvatar") : t("userCard.uploadAvatar")}
          </button>
          {user.avatarUpdatedAt && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              title={t("userCard.removeAvatar")}
              className="flex items-center justify-center rounded-lg border border-line bg-panel px-2 text-danger shadow-e1 transition-colors hover:bg-dangersoft disabled:opacity-50"
            >
              <IcTrash size={13} />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={onPick} />
        </div>
      )}
    </div>
  );
}

/** Что считается фокусируемым внутри диалога (для ловушки фокуса по Tab). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Модальное окно. Один компонент на все диалоги приложения, поэтому всё, что
 * касается доступности, чинится здесь один раз (аудит UX-01).
 *
 * Раньше это был просто div с обработчиком Esc: скринридер не знал, что открыт
 * диалог, и продолжал читать страницу под ним; Tab уводил фокус за оверлей;
 * после закрытия фокус терялся; фон продолжал прокручиваться.
 *
 * `title` — доступное имя диалога (aria-labelledby на скрытый заголовок).
 */
export function Modal({
  onClose,
  children,
  w = 860,
  title,
  variant = "center",
}: {
  onClose: () => void;
  children: React.ReactNode;
  w?: number;
  title?: string;
  /** "panel" — выезжающая справа панель на всю высоту (просмотр задачи поверх
   *  доски с сохранением контекста, ТЗ 5.6 п.4 / прототип гейта); "center" —
   *  обычный диалог. Доступность (роль, ловушка фокуса, Esc) одна и та же. */
  variant?: "center" | "panel";
}) {
  const { t } = useT();
  const resolvedTitle = title ?? t("ui.dialog");
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // onClose обычно приходит инлайн-стрелкой (`onClose={() => setX(false)}`),
  // то есть новая ссылка на функцию при каждом рендере родителя — а рендер
  // родителя происходит на каждое нажатие клавиши в любом поле внутри диалога
  // (title/description/label и т.п. держат состояние выше). Если положить
  // onClose в deps ниже, этот эффект пересоздавался бы на каждый keystroke и
  // перехватывал фокус обратно на первый focusable-элемент диалога — обычно
  // кнопку-крестик в шапке, которая в разметке идёт раньше полей ввода. Баг
  // был воспроизводим и выглядел как «фокус залипает на крестике/ссылке»
  // после первого введённого символа. Ref держит актуальный onClose без
  // повторного запуска эффекта монтирования.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Куда вернуть фокус после закрытия — обычно это кнопка/карточка,
    // с которой диалог открыли.
    const opener = document.activeElement as HTMLElement | null;

    // Фон не должен прокручиваться под открытым диалогом.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Фокус внутрь: первый осмысленный элемент, иначе сам контейнер.
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      // Ловушка фокуса: Tab с последнего элемента уводит на первый и наоборот,
      // чтобы фокус не ушёл на страницу под оверлеем.
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        box.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (e.shiftKey && (active === firstEl || active === box)) {
        e.preventDefault();
        lastEl.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className={
        variant === "panel"
          ? "anim-scrim fixed inset-0 z-50 flex justify-end bg-[color-mix(in_oklch,var(--bg-scrim)_70%,transparent)] p-2 backdrop-blur-[2px]"
          : "anim-scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--bg-scrim)] px-4 py-10 backdrop-blur-[3px]"
      }
      onMouseDown={onClose}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          variant === "panel"
            ? "anim-panel glass-edge h-full w-full overflow-y-auto rounded-xl bg-overlay shadow-[var(--highlight-top),var(--elev-4)] outline-none"
            : "anim-dialog glass-edge w-full rounded-xl bg-overlay shadow-[var(--highlight-top),var(--elev-4)] outline-none"
        }
        style={{ maxWidth: w }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">
          {resolvedTitle}
        </h2>
        {children}
      </div>
    </div>
  );
}

export const Empty = ({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-4 py-8 text-center">
    <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-sunken text-faint ring-1 ring-inset ring-linesoft">{icon}</span>
    <p className="text-[13.5px] font-medium text-ink">{title}</p>
    {sub && <p className="max-w-[260px] text-[12.5px] text-faint">{sub}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

/* ─── Скелет-заглушки на время bootstrap (round4 §1) ───────────────────── */

/** Классы «плашки» колонки доски. Один источник для настоящей колонки
 *  (`Board.tsx`) и для скелета (`SkeletonColumn`), чтобы во время bootstrap
 *  заглушка выглядела как готовая колонка, а не «прыгала» в неё после загрузки
 *  (ticket-board-columns-theme-fix). */
export const BOARD_COLUMN_SHELL =
  "flex h-full max-h-full w-[288px] shrink-0 flex-col rounded-xl bg-sunken/80 p-1.5 ring-1 ring-inset ring-linesoft/70 min-[1536px]:w-[304px] min-[1920px]:w-[328px]";

export const SkeletonRow = () => (
  <div className="flex items-center gap-3 border-b border-linesoft px-3.5 py-3 last:border-0">
    <div className="skeleton h-3.5 w-3.5 shrink-0 rounded" />
    <div className="skeleton h-3 w-14 shrink-0" />
    <div className="skeleton h-3 min-w-0 flex-1" style={{ maxWidth: 320 }} />
    <div className="skeleton hidden h-4 w-16 shrink-0 sm:block" />
    <div className="skeleton h-4 w-4 shrink-0 rounded-full" />
  </div>
);

export const SkeletonCard = () => (
  <div className="surface-raised rounded-lg p-3">
    <div className="mb-2 flex items-center gap-1.5">
      <div className="skeleton h-3.5 w-3.5 rounded" />
      <div className="skeleton h-2.5 w-12" />
    </div>
    <div className="skeleton h-3 w-full" />
    <div className="skeleton mt-1.5 h-3 w-2/3" />
    <div className="mt-3 flex items-center gap-2">
      <div className="skeleton h-3 w-16" />
      <div className="skeleton ml-auto h-5 w-5 rounded-full" />
    </div>
  </div>
);

export const SkeletonColumn = ({ cards = 3 }: { cards?: number }) => (
  <div className={BOARD_COLUMN_SHELL}>
    <div className="mb-1.5 flex items-center gap-2 px-1.5 pt-1">
      <div className="skeleton h-2 w-2 rounded-sm" />
      <div className="skeleton h-3 w-24" />
    </div>
    <div className="flex-1 space-y-2 p-0.5">
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  </div>
);

export const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex min-w-[18px] items-center justify-center rounded border border-line bg-panel px-1 font-mono text-[10.5px] leading-[16px] text-faint shadow-[inset_0_-1px_0_var(--border-default)]">{children}</kbd>
);

export const Tip = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
  <span className={`group/tip relative inline-flex ${className}`}>
    {children}
    <span className="glass pointer-events-none absolute bottom-full left-1/2 z-[60] mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink opacity-0 shadow-e3 transition-opacity delay-150 duration-150 group-hover/tip:opacity-100">
      {label}
    </span>
  </span>
);

export const roleBadgeColors: Record<AccessRole, string> = {
  admin: "var(--c-danger)",
  manager: "var(--c-accent)",
  employee: "var(--c-ok)",
  viewer: "var(--c-faint)",
};

export const RoleBadge = ({ role, size = "md" }: { role: AccessRole; size?: "sm" | "md" }) => {
  const { t } = useT();
  const meta = {
    admin: { name: t("role.admin.name"), color: "var(--c-danger)", bg: "var(--c-dangersoft)" },
    manager: { name: t("role.manager.name"), color: "var(--c-accent)", bg: "var(--c-accentsoft)" },
    employee: { name: t("role.employee.name"), color: "var(--c-ok)", bg: "var(--c-oksoft)" },
    viewer: { name: t("role.viewer.name"), color: "var(--c-sub)", bg: "var(--c-linesoft)" },
  }[role];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-medium ${size === "sm" ? "px-1.5 py-px text-[10.5px]" : "px-2 py-0.5 text-[11.5px]"}`}
      style={{ background: meta.bg, color: meta.color }}
    >
      <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.5l5.5 2v4.2c0 3.7-2.3 6-5.5 7-3.2-1-5.5-3.3-5.5-7V3.5L8 1.5z" />
      </svg>
      {meta.name}
    </span>
  );
};

export const LockedField = ({ children, reason }: { children: React.ReactNode; reason: string }) => (
  <Tip label={reason} className="w-full">
    <div className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg border border-linesoft bg-sunken px-2.5 py-1.5 text-[13px] text-faint">
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5.3a2.5 2.5 0 015 0V7" />
      </svg>
    </div>
  </Tip>
);

/** Сегментированный переключатель — один стиль для темы, почты, языка. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-0.5 rounded-lg bg-sunken p-0.5 ring-1 ring-inset ring-linesoft">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex-1 rounded-md px-1.5 py-1 text-[12px] font-medium transition-colors duration-150 ${
            value === v ? "bg-panel text-ink shadow-e1" : "text-sub hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Попап «Оформление» — тема, атмосфера (свечение за рабочим пространством)
 *  и язык. Живёт в меню профиля (Topbar) и в шапке HomeView.
 *  Хранение — localStorage (theme.ts), без сервера. */
export function AppearanceSettings() {
  const { t, lang, setLang } = useT();
  const [mode, setMode] = useState<ThemeMode>(() => readTheme());
  const [bg, setBgState] = useState<string>(() => readBgId());
  const eff = effectiveTheme(mode);
  return (
    <div className="border-b border-linesoft px-3.5 py-3">
      <p className="mb-2 text-[12px] font-medium text-sub">{t("appearance.title")}</p>
      <Segmented
        value={mode}
        ariaLabel={t("appearance.title")}
        options={[
          ["system", t("appearance.theme.system")],
          ["light", t("appearance.theme.light")],
          ["dark", t("appearance.theme.dark")],
        ]}
        onChange={(v) => {
          setThemeMode(v);
          setMode(v);
        }}
      />
      <div className="mt-3 flex items-center gap-2">
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            title={p.name}
            aria-label={t("appearance.bgAria", { name: p.name })}
            aria-pressed={bg === p.id}
            onClick={() => {
              setBg(p.id);
              setBgState(p.id);
            }}
            className={`h-7 flex-1 rounded-lg ring-offset-2 ring-offset-[var(--bg-raised)] transition-[box-shadow,transform] duration-150 hover:scale-[1.04] ${
              bg === p.id ? "ring-2 ring-accent" : "ring-1 ring-inset ring-[oklch(0.5_0.02_288/0.18)]"
            }`}
            style={{ backgroundImage: eff === "dark" ? p.dark : p.light }}
          />
        ))}
      </div>
      <p className="mb-2 mt-3.5 text-[12px] font-medium text-sub">{t("appearance.language")}</p>
      <Segmented value={lang} options={(["ru", "en"] as const).map((l) => [l, t(`lang.${l}`)] as const)} onChange={setLang} ariaLabel={t("appearance.language")} />
    </div>
  );
}

/** Переключатель (вкл/выкл). */
export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
        checked ? "bg-accent" : "bg-active ring-1 ring-inset ring-line"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-[var(--text-on-accent)] shadow-e1 transition-transform duration-200 ease-out ${
          checked ? "translate-x-[14px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

export function Toasts() {
  const toasts = useToasts();
  const { t } = useT();
  const meta = {
    success: { dot: "var(--status-done)", label: t("toast.success") },
    error: { dot: "var(--status-danger)", label: t("toast.error") },
    info: { dot: "var(--accent-solid)", label: t("toast.info") },
  };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((item) => {
        const m = meta[item.kind];
        return (
          <div key={item.id} className="glass anim-toast pointer-events-auto flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 shadow-e3">
            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: m.dot, boxShadow: `0 0 0 3px color-mix(in oklch, ${m.dot} 22%, transparent)` }} />
            <p className="min-w-0 text-[13px] leading-snug text-ink">
              <span className="sr-only">{m.label}: </span>
              {item.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Поиск сотрудника по имени/должности (`usersApi.pickable` — сервер требует
 * минимум 2 символа и отдаёт до 20 совпадений, справочник больше не
 * выгружается целиком, см. SEC-04). Общий пикер вместо плоского `<select>` со
 * всеми пользователями сразу — на организацию в несколько сотен человек
 * прокручивать такой список до нужного имени было бы мучением. Изначально
 * жил только в `IssueModal.tsx`'s `CollaboratorField`; вынесен сюда, чтобы
 * состав проекта/отдела в `AdminView.tsx` использовал тот же паттерн, а не
 * свою копию debounce-логики.
 */
export function UserSearchPicker({
  exclude,
  onPick,
  placeholder,
  pickLabel,
  disabled = false,
}: {
  exclude: Set<string>;
  onPick: (userId: string) => void;
  placeholder?: string;
  pickLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useT();
  const resolvedPlaceholder = placeholder ?? t("ui.findEmployee");
  const resolvedPickLabel = pickLabel ?? t("ui.add");
  const [pickable, setPickable] = useState<PickableUser[]>([]);
  const [pick, setPick] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setPickable([]);
      return;
    }
    let off = false;
    const t = window.setTimeout(() => {
      usersApi
        .pickable(term)
        .then((u) => !off && setPickable(u))
        .catch(() => {});
    }, 250);
    return () => {
      off = true;
      window.clearTimeout(t);
    };
  }, [search]);

  const candidates = pickable.filter((u) => !exclude.has(u.id));

  return (
    <div>
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPick("");
        }}
        placeholder={resolvedPlaceholder}
        aria-label={resolvedPlaceholder}
        disabled={disabled}
        className="w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint focus:border-accent focus:shadow-focus focus:outline-none disabled:opacity-50"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={disabled || candidates.length === 0}
          aria-label={t("ui.whomToAdd")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-[12.5px] text-sub focus:border-accent focus:shadow-focus focus:outline-none disabled:opacity-50"
        >
          <option value="">
            {t(search.trim().length < 2 ? "ui.minTwoChars" : candidates.length ? "ui.select" : "ui.noPeople")}
          </option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.jobRole ? `${u.name} · ${u.jobRole}` : u.name}
            </option>
          ))}
        </select>
        <button
          disabled={disabled || !pick}
          onClick={() => {
            onPick(pick);
            setPick("");
            setSearch("");
          }}
          className="btn-primary shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
        >
          {resolvedPickLabel}
        </button>
      </div>
    </div>
  );
}
