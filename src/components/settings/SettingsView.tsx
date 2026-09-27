/** Настройки — три дома (ADR-0013 §2, IA §3, ТЗ 5.9): Личные, Проект, Организация. Слева — все доступные
 *  разделы, сгруппированные по дому; справа — страница раздела. Каждая настройка живёт ровно в одном месте. */
import { lazy, Suspense, type ReactNode } from "react";
import { useStore } from "../../store";
import { useT, type TKey } from "../../i18n";
import { allowedSections } from "../../settings/access";
import { DEFAULT_SECTION, type SettingsHome } from "../../settings/sections";
import {
  IcArchive,
  IcBell,
  IcBolt,
  IcBriefcase,
  IcCompose,
  IcDiamond,
  IcDownload,
  IcEye,
  IcFilter,
  IcFlag,
  IcFlow,
  IcGlobe,
  IcInbox,
  IcLink,
  IcLock,
  IcReport,
  IcSettings,
  IcShield,
  IcSun,
  IcUsers,
  type IconTone,
} from "../../icons";
import { EmptyState } from "../../ds";
import { ProjectMark } from "../../ui";
import { PersonalSection } from "./PersonalSettings";

const WorkflowView = lazy(() => import("../WorkflowView"));
const PermissionsView = lazy(() => import("../PermissionsView"));
const AdminView = lazy(() => import("../AdminView"));

type Meta = { icon: (p: { size?: number; tone?: IconTone }) => ReactNode; tone: IconTone };
const META: Record<string, Meta> = {
  profile: { icon: (p) => <IcBriefcase {...p} />, tone: "violet" },
  notifications: { icon: (p) => <IcBell {...p} />, tone: "amber" },
  appearance: { icon: (p) => <IcSun {...p} />, tone: "orange" },
  language: { icon: (p) => <IcGlobe {...p} />, tone: "sky" },
  general: { icon: (p) => <IcSettings {...p} />, tone: "gray" },
  workflow: { icon: (p) => <IcFlow {...p} />, tone: "pink" },
  fields: { icon: (p) => <IcFilter {...p} />, tone: "indigo" },
  templates: { icon: (p) => <IcCompose {...p} />, tone: "violet" },
  access: { icon: (p) => <IcShield {...p} />, tone: "green" },
  modules: { icon: (p) => <IcFlag {...p} />, tone: "amber" },
  archive: { icon: (p) => <IcArchive {...p} />, tone: "gray" },
  users: { icon: (p) => <IcUsers {...p} />, tone: "blue" },
  departments: { icon: (p) => <IcInbox {...p} />, tone: "violet" },
  ldap: { icon: (p) => <IcLink {...p} />, tone: "teal" },
  license: { icon: (p) => <IcDiamond {...p} />, tone: "indigo" },
  export: { icon: (p) => <IcDownload {...p} />, tone: "sky" },
  audit: { icon: (p) => <IcEye {...p} />, tone: "gray" },
  maintenance: { icon: (p) => <IcBolt {...p} />, tone: "amber" },
  health: { icon: (p) => <IcReport {...p} />, tone: "green" },
};

const HOME_KEY: Record<SettingsHome, TKey> = {
  settings: "settings.home.personal",
  projectSettings: "settings.home.project",
  orgSettings: "settings.home.org",
};
const HOMES: SettingsHome[] = ["settings", "projectSettings", "orgSettings"];
const sectionKey = (home: SettingsHome, s: string) =>
  `settings.${home === "settings" ? "personal" : home === "projectSettings" ? "project" : "org"}.${s}` as TKey;

export function useSettingsNav() {
  const { me, data } = useStore();
  const ctx = { isAdmin: me.globalRole === "admin", hasProject: !!data.currentProjectId };
  return (home: SettingsHome) => allowedSections(home, ctx);
}

export default function SettingsView() {
  const { t } = useT();
  const { ui, data, setView } = useStore();
  const nav = useSettingsNav();
  const home = ui.view as SettingsHome;
  const allowed = nav(home);
  const section = ui.section || (allowed.includes(DEFAULT_SECTION[home]) ? DEFAULT_SECTION[home] : allowed[0] ?? DEFAULT_SECTION[home]);
  const ok = allowed.includes(section);

  let page: ReactNode;
  if (!ok) {
    page = (
      <div className="pt-16">
        <EmptyState icon={<IcLock size={22} tone="gray" />} title={t("settings.denied")} sub={t(home === "orgSettings" ? "settings.deniedOrg" : "settings.deniedProject")} />
      </div>
    );
  } else if (home === "settings") page = <PersonalSection section={section} />;
  else if (home === "projectSettings") {
    page =
      section === "access" ? <PermissionsView /> : <WorkflowView part={section as "workflow" | "templates" | "fields"} />;
  } else page = <AdminView />;

  return (
    <div className="flex h-full min-h-0 max-md:flex-col">
      <nav aria-label={t("settings.title")} className="shrink-0 border-linesoft md:w-[236px] md:overflow-y-auto md:border-r md:px-3 md:py-5 max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:px-3 max-md:py-2">
        <p className="px-2.5 pb-2 font-disp text-[15px] font-bold tracking-[-0.01em] text-ink max-md:hidden">{t("settings.title")}</p>
        {HOMES.map((h) => {
          const items = nav(h);
          if (!items.length) return null;
          return (
            <div key={h} className="md:mb-3 max-md:contents">
              <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11.5px] font-semibold text-faint max-md:hidden">
                {h === "projectSettings" && <ProjectMark projectKey={data.project.key} size={14} />}
                {t(HOME_KEY[h])}
                {h === "projectSettings" && <span className="truncate font-medium">· {data.project.name}</span>}
              </p>
              {items.map((s) => {
                const on = h === home && s === section;
                const m = META[s];
                return (
                  <button
                    key={`${h}:${s}`}
                    type="button"
                    onClick={() => setView(h, s)}
                    aria-current={on ? "page" : undefined}
                    className={`ds-focus flex h-8 w-full shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors max-md:w-auto ${
                      on ? "bg-panel font-semibold text-ink shadow-[var(--highlight-top),0_1px_2px_oklch(0.2_0.05_288/0.08),0_0_0_1px_var(--border-subtle)]" : "text-sub hover:bg-hover/70 hover:text-ink"
                    }`}
                  >
                    {m.icon({ size: 15, tone: on ? m.tone : undefined })}
                    {t(sectionKey(h, s))}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Suspense fallback={null}>
          <div key={`${home}:${section}`} className="h-full">
            {page}
          </div>
        </Suspense>
      </div>
    </div>
  );
}
