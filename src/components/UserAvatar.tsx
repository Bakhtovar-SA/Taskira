/** Аватар человека в приложении (трек G, шаг G3; карта COMPONENTS.md: Avatar/AvatarStack → Avatar/AvatarGroup).
 *  Вид — ds-аватар (классы ds-av, тон по имени, концепция 6); сверх того, что умеет чистый ds-компонент: загруженное
 *  фото (useAvatarSrc), пустой кружок «не назначен», любые размеры экранов (через --av, ADR-0010) и карточка
 *  пользователя по клику — Popover вокруг (ленивый: доска и боковая панель во входном чанке). */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { User } from "../types";
import { useStore } from "../store";
import { getAvatarBlobUrl } from "../api";
import { IcBriefcase, IcCamera, IcPhone, IcTrash } from "../icons";
import { useT } from "../i18n";
import { cropAndResizeAvatar } from "../avatarCrop";
import { cssVars } from "../cssVars";
import { toneOf } from "../ds/Display";
import { Popover } from "../ds/LazyOverlay";

/** Аватару достаточно имени — любой объект с ним (не только полный User: напр. `actor` в уведомлениях). С id аватар
 *  может быть кликабельным (карточка пользователя), с avatarUpdatedAt — показать загруженное фото. */
export type AvatarUser = Pick<User, "name"> &
  Partial<Pick<User, "id" | "avatarUpdatedAt" | "initials">> & {
    /** Не используется: тон — по имени (концепция 6), цвета из данных в интерфейс не попадают. Поле допущено, чтобы
     *  старые вызовы с {name, initials, color} продолжали собираться. */
    color?: string;
  };

/** Картинка аватарки (blob-URL, авторизованный fetch с кэшем — см. getAvatarBlobUrl
 *  в api/index.ts) — null, пока грузится или если её нет. */
export function useAvatarSrc(userId?: string, avatarUpdatedAt?: number | null): string | null {
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

const initialsOf = (u: AvatarUser) =>
  u.initials ||
  u.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/** Клик и Enter/Пробел по аватару внутри кликабельной строки или карточки (доска, список) не должны открывать ещё и
 *  задачу; клавиши изнутри открытой карточки — тоже. Остальные клавиши идут дальше (общие сочетания). */
const stopClick = (e: MouseEvent) => e.stopPropagation();
const stopKeys = (e: KeyboardEvent) => {
  if ((e.target as Element).closest("[popover]") || e.key === "Enter" || e.key === " ") e.stopPropagation();
};

export function UserAvatar({
  user,
  size = 26,
  ring = false,
  interactive = false,
}: {
  user: AvatarUser | null | undefined;
  size?: number;
  ring?: boolean;
  /** true — открывать карточку пользователя по клику. По умолчанию нет: аватар часто сидит внутри чужого
   *  управляющего элемента (фильтр по исполнителю, пункт меню, триггер) — там клик должен управлять им. */
  interactive?: boolean;
}) {
  const { t } = useT();
  const src = useAvatarSrc(user?.id, user?.avatarUpdatedAt);
  const [open, setOpen] = useState(false);
  const sizeRef = useMemo(() => cssVars({ "--av": size }), [size]);

  if (!user)
    return (
      <span ref={sizeRef} className="ds-av ds-av-empty" role="img" aria-label={t("createIssue.unassigned")} title={t("createIssue.unassigned")}>
        <span aria-hidden="true">–</span>
      </span>
    );

  const circle = (
    <span ref={sizeRef} className={`ds-av tk-tone-${toneOf(user.name)}`} data-ring={ring || undefined} role="img" aria-label={user.name} title={interactive ? undefined : user.name}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">{initialsOf(user)}</span>}
    </span>
  );
  if (!interactive || !user.id) return circle;
  const userId = user.id;
  return (
    <span className="inline-flex" onClick={stopClick} onKeyDown={stopKeys}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label={user.name}
        className="w-[260px] !p-0"
        trigger={(p) => (
          <button {...p} type="button" className="ds-focus flex rounded-full" aria-label={user.name} title={user.name}>
            {circle}
          </button>
        )}
      >
        <UserCardBody userId={userId} />
      </Popover>
    </span>
  );
}

/** Несколько человек внахлёст (исполнители задачи), максимум `max`, остаток — кружок «+N». Пустой список — тот же
 *  «не назначен», что одиночный UserAvatar(null). */
export function UserAvatarGroup({ users, size = 22, max = 3, interactive = false }: { users: AvatarUser[]; size?: number; max?: number; interactive?: boolean }) {
  const { t } = useT();
  const sizeRef = useMemo(() => cssVars({ "--av": size }), [size]);
  if (users.length === 0) return <UserAvatar user={null} size={size} />;
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="ds-av-group">
      {shown.map((u, i) => (
        <UserAvatar key={u.id ?? i} user={u} size={size} ring interactive={interactive} />
      ))}
      {rest > 0 && (
        <span ref={sizeRef} className="ds-av ds-av-more" data-ring title={t("ui.more", { count: rest })}>
          +{rest}
        </span>
      )}
    </span>
  );
}

/** Содержимое карточки пользователя — без обёртки Dropdown, чтобы Topbar мог
 *  вставить её прямо в уже открытое меню профиля (обёртывать в ЕЩЁ один
 *  Dropdown внутри открытого было бы багом: любой другой открывшийся Dropdown
 *  закрывает все прочие через DROPDOWN_OPEN_EVT, так что вложенный тут же
 *  захлопнул бы меню профиля под собой). UserAvatar с interactive — тот же
 *  контент в собственном Popover, для клика по чужому аватару. Для себя
 *  дополнительно показывает загрузку/удаление аватарки (самообслуживание —
 *  см. план миграции 027, без admin-загрузки за другого). Должность/телефон
 *  читаются из уже загруженного data.users — отдельный запрос не нужен. */
export function UserCardBody({ userId }: { userId: string }) {
  const { t } = useT();
  const { data, idx, uploadAvatar, removeAvatar } = useStore();
  const user = idx.users.get(userId);
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
        <UserAvatar user={user} size={56} />
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
