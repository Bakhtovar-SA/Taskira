import { Button, IconButton } from "../ds/Button";
import { Kbd } from "../ds/Display";
import { Menu } from "../ds/LazyOverlay";
import { IcLock, IcPanel, IcPlus, IcSearch, IcSettings } from "../icons";
import { useT } from "../i18n";
import { openHomeCreate, openPalette, paletteShortcut } from "../palette/events";
import { useOpenSettings } from "../settings/useOpenSettings";
import { useStore } from "../store";
import { openSidebarDrawer, SETTINGS_VIEWS } from "./Sidebar";
import { Bell } from "./Topbar";
import { UserMenu } from "./UserMenu";

export default function GlobalTopbar() {
  const { t } = useT();
  const { bootStatus, data, can, setCreateOpen, logout, me } = useStore();
  const openSettings = useOpenSettings();
  const canCreate = bootStatus === "home" || (bootStatus === "ready" && !!data.currentProjectId && can("create"));
  return <header className="global-topbar shrink-0 border-b border-linesoft">
    <div className="global-topbar-row">
      <IconButton variant="ghost" size="sm" label={t("sidebar.menu")} onClick={openSidebarDrawer} className="global-menu-button lg:hidden">
        <IcPanel size={18} />
      </IconButton>
      <div className="global-topbar-center">
        <Button variant="secondary" size="sm" onClick={openPalette} aria-label={t("sidebar.search")} className="sidebar-search global-search min-w-0"
          iconLeft={<IcSearch size={16} />} iconRight={<Kbd>{paletteShortcut()}</Kbd>}>
          {t("sidebar.search")}
        </Button>
        <Button variant={canCreate ? "primary" : "ghost"} size="sm" disabled={canCreate ? false : t("topbar.createDeniedTip")}
          onClick={() => bootStatus === "home" ? openHomeCreate() : setCreateOpen(true)} className="project-create"
          aria-label={t("topbar.createAria")} iconLeft={canCreate ? <IcPlus size={18} /> : <IcLock size={18} />} kbd="C">
          <span className="hidden sm:inline">{t("topbar.task")}</span>
        </Button>
      </div>
      <div className="global-topbar-right">
        <Bell />
        <Menu label={t("sidebar.settings")} placement="bottom-end"
          trigger={props => <IconButton {...props} variant="ghost" size="sm" label={t("sidebar.settings")}><IcSettings size={18} /></IconButton>}
          items={SETTINGS_VIEWS.filter(v => !v.adminOnly || me.globalRole === "admin").map(v => ({
            id: v.id, label: t(v.labelKey), icon: v.icon({ size: 16, tone: v.tone }),
            onSelect: () => openSettings(v.id as "settings" | "projectSettings" | "orgSettings"),
          }))} />
        <UserMenu onLogout={logout} sidebar />
      </div>
    </div>
  </header>;
}
