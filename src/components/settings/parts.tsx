/** Каркас страниц настроек (ТЗ 5.9): заголовок, пояснение, карточки со строками «подпись — управление». */
import { lazy, Suspense, useCallback, useId, useRef, useState, type ReactNode } from "react";
import type { AccessRole, Status, User } from "../../types";
import { Avatar, Skeleton, Tag } from "../../ds/Display";
import { IconButton } from "../../ds/Button";
import { UserCardBody, useAvatarSrc } from "../../ui";
import { useT } from "../../i18n";
import { workflowStatusName } from "../../workflowStatus";

const LazyPopover = lazy(() => import("../../ds/Overlay").then((m) => ({ default: m.Popover })));
type ScreenPopoverProps = Parameters<typeof import("../../ds/Overlay").Popover>[0];
export function ScreenPopover(props: ScreenPopoverProps) {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const renderTrigger: ScreenPopoverProps["trigger"] = (triggerProps, isOpen) => {
    const identified = { ...triggerProps, id: triggerId };
    return props.trigger(identified, isOpen);
  };
  const changeOpen = useCallback((next: boolean) => {
    const button = document.getElementById(triggerId);
    const panelId = button?.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!next && (document.activeElement === document.body || panel?.contains(document.activeElement))) button?.focus();
    setOpen(next);
  }, [triggerId]);
  const trigger = renderTrigger({ ref: anchor, onClick: () => { setLoaded(true); setOpen(true); }, "aria-expanded": false, "aria-haspopup": props.role === "menu" ? "menu" : "dialog", "aria-controls": "" }, false);
  if (!loaded) return trigger;
  return <Suspense fallback={trigger}><LazyPopover {...props} trigger={renderTrigger} open={open} onOpenChange={changeOpen} /></Suspense>;
}

// Screen adapters keep profile loading and project roles outside the design system.
type Person = Pick<User, "name"> & Partial<Pick<User, "id" | "avatarUpdatedAt" | "initials" | "color">>;
export function PersonAvatar({ user, size = 24, ring = false, interactive = false }: {
  user: Person | null | undefined; size?: number; ring?: boolean; interactive?: boolean;
}) {
  const { t } = useT();
  const src = useAvatarSrc(user?.id, user?.avatarUpdatedAt);
  const tokenSize = size >= 52 ? 64 : size >= 36 ? 40 : size >= 30 ? 32 : size >= 27 ? 28 : size >= 22 ? 24 : 20;
  const circle = <Avatar person={{ name: user?.name ?? t("createIssue.unassigned"), src }} size={tokenSize} ring={ring} />;
  if (!interactive || !user?.id) return circle;
  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <ScreenPopover label={user.name} className="w-[260px]"
        trigger={(props) => <IconButton {...props} size={tokenSize >= 36 ? "lg" : tokenSize >= 28 ? "md" : "sm"} label={user.name} className="rounded-full p-0">{circle}</IconButton>}>
        <UserCardBody userId={user.id} />
      </ScreenPopover>
    </span>
  );
}

export const ROLE_TONE = { admin: "red", manager: "indigo", employee: "blue", viewer: "gray" } as const;
export function RoleTag({ role, size = "md" }: { role: AccessRole; size?: "sm" | "md" }) {
  const { t } = useT();
  return <Tag tone={ROLE_TONE[role]} size={size} dot>{t(`role.${role}.name`)}</Tag>;
}

export function StatusTag({ status, size = "md" }: { status: Status; size?: "sm" | "md" }) {
  const { t } = useT();
  return <Tag tone={status.category === "done" ? "green" : status.category === "inprogress" ? "blue" : "gray"} size={size} dot>{workflowStatusName(status, t)}</Tag>;
}

export function ScreenSkeletonRow() {
  return <div className="flex items-center gap-3 px-4 py-3" aria-hidden="true"><Skeleton.Circle size={20} /><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton.Line w="76%" /><Skeleton.Line w="42%" h={10} /></div></div>;
}

/** Каркас новой страницы настроек: заголовок, пояснение, карточки. */
export function SettingsPage({ title, desc, children, wide = false }: { title: ReactNode; desc?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto ${wide ? "max-w-[1060px]" : "max-w-[760px]"} px-5 py-6 sm:px-8`}>
      <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      {desc && <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-sub">{desc}</p>}
      <div className="mt-6 flex flex-col gap-5">{children}</div>
    </div>
  );
}

export function SettingsCard({ title, children, footer }: { title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
      {title && <h2 className="border-b border-linesoft px-5 py-3 text-[13px] font-semibold text-ink">{title}</h2>}
      <div className="flex flex-col divide-y divide-linesoft">{children}</div>
      {footer && <div className="border-t border-linesoft bg-sunken/60 px-5 py-2.5 text-[11.5px] text-faint">{footer}</div>}
    </section>
  );
}

/** Строка настройки: подпись и пояснение слева, управление справа (на узком экране — под ними). */
export function SettingRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
