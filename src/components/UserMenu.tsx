import { ScreenPopover, PersonAvatar, RoleTag } from "./settings/parts";
import { Button } from "../ds/Button";
import { IcSettings } from "../icons";
import { UserCardBody } from "../ui";
import { useStore } from "../store";
import { useT } from "../i18n";
import { useOpenSettings } from "../settings/useOpenSettings";

export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { t } = useT();
  const { data, me } = useStore();
  const openSettings = useOpenSettings();
  return (
    <ScreenPopover
      className="w-[280px]" label={t("topbar.userMenuAria")}
      placement="bottom-end"
      trigger={(props, open) => (
        <Button {...props} variant="ghost" size="sm" className={`sidebar-user-menu min-w-0 flex-1 flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors duration-150 ${open ? "bg-active" : "hover:bg-hover"} [&>span.truncate]:flex [&>span.truncate]:w-full [&>span.truncate]:min-w-0 [&>span.truncate]:items-center [&>span.truncate]:gap-2`} aria-label={t("topbar.userMenuAria")}>
          {/* interactive=false: клик по аватарке здесь должен открывать это же
              меню (логаут/настройки), а не всплывающую карточку профиля —
              её показывает сам заголовок открытого меню ниже. */}
          <PersonAvatar user={me} size={30} interactive={false} />
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="block truncate text-[14.5px] font-semibold leading-tight text-ink">{me.name}</span>
            <span className="block mt-0.5 text-[13px] leading-tight text-sub">{me.role}</span>
          </span>
        </Button>
      )}
    >
      {(close) => (
        <>
          {/* The profile body shares this popover, so its settings stay in the same focus context. */}
          <div className="border-b border-linesoft">
            <UserCardBody userId={me.id} />
            <div className="-mt-2 px-4 pb-3">
              <p className="text-[12px] text-faint">{data.project.name}</p>
              <div className="mt-2">
                <RoleTag role={me.accessRole} size="sm" />
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="ds-menu-item w-full justify-start"
            onClick={() => {
              openSettings("settings");
              close();
            }}
          >
            <span className="flex items-center gap-2">
              <IcSettings size={16} tone="gray" /> {t("settings.menu")}
            </span>
          </Button>
          <p className="border-t border-linesoft px-4 py-2 tabular text-[12px] text-faint">
            Taskira {import.meta.env.VITE_APP_VERSION || "dev"}
          </p>
          <Button variant="ghost" size="sm" className="ds-menu-item w-full justify-start"
            onClick={() => {
              onLogout();
              close();
            }}
          >
            {t("topbar.logout")}
          </Button>
        </>
      )}
    </ScreenPopover>
  );
}
