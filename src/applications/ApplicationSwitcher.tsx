import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { applicationsCopy } from "../i18n/applications";
import { Button, IconButton } from "../ds/Button";
import { Menu, type MenuEntry } from "../ds/LazyOverlay";
import { IcBoard, IcBook, IcBriefcase, IcCheck, IcChevD, IcSettings } from "../icons";
import type { ApplicationId } from "../../server/src/applicationContract";

export function ApplicationIcon({ application, size = 18 }: { application: ApplicationId; size?: number }) {
  return application === "knowledge" ? <IcBook size={size} tone="orange" /> : application === "objects" ? <IcBriefcase size={size} tone="teal" /> : <IcBoard size={size} tone="violet" />;
}

export default function ApplicationSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang } = useT();
  const c = applicationsCopy(lang);
  const { application = "work", applications, applicationsError, selectApplication, refreshApplications, goHome, setView } = useStore();
  const [open, setOpen] = useState(false);
  const current = c.apps[application];
  const available = applications?.applications.filter((app) => app.enabled && app.projectIds.length > 0) ?? [];
  if (!applications) return applicationsError ? compact ? (
    <IconButton variant="ghost" size="sm" onClick={() => void refreshApplications()} label={`${c.loadError}. ${c.retry}`}><ApplicationIcon application={application} /></IconButton>
  ) : <div className="mx-3 mb-2"><p role="alert" className="text-[12px] text-danger">{c.loadError}</p><Button variant="ghost" size="sm" onClick={() => void refreshApplications()}>{c.retry}</Button></div>
    : <span role="status" aria-label={c.loading} className={compact ? "skeleton h-8 w-8 rounded-lg" : "skeleton mx-3 mb-2 h-8 rounded-lg"} />;

  const title = <span className="flex min-w-0 items-center gap-2">
    <ApplicationIcon application={application} />
    <span className="min-w-0 flex-1 truncate text-left font-semibold">{current.name}</span>
  </span>;
  if (available.length <= 1 && available[0]?.id === application) return compact ? (
    <IconButton variant="ghost" size="sm" label={`${current.name} · ${c.home}`} onClick={goHome}><ApplicationIcon application={application} /></IconButton>
  ) : <Button variant="ghost" size="sm" onClick={goHome} className="mx-3 mb-2 justify-start" aria-label={`${current.name} · ${c.home}`}>{title}</Button>;

  const items: MenuEntry[] = available.map((app) => ({
    id: app.id,
    text: c.apps[app.id].name,
    label: <span className="block py-1"><span className="block font-semibold">{c.apps[app.id].name}</span><span className="block text-[12px] text-faint">{c.apps[app.id].purpose}</span></span>,
    icon: <ApplicationIcon application={app.id} />,
    hint: app.id === application ? <IcCheck size={16} /> : undefined,
    onSelect: () => { void selectApplication(app.id); },
  }));
  if (applications.canManage) items.push({ kind: "sep", id: "settings-separator" }, {
    id: "application-settings", label: c.manage, icon: <IcSettings size={16} />,
    onSelect: () => setView("orgSettings", "applications"),
  });
  if (!items.length) return compact ? <span title={c.unavailable}><ApplicationIcon application={application} /></span> : <div className="mx-3 mb-2 text-[13px] text-faint">{title}<span className="mt-1 block">{c.unavailable}</span></div>;
  return <div className={compact ? "contents" : "mx-3 mb-2"}>
    <Menu label={c.applications} items={items} open={open} onOpenChange={setOpen} className="w-[min(292px,calc(100vw-32px))]"
      trigger={(props) => compact ? <IconButton {...props} variant="ghost" size="sm" label={c.switcher} aria-description={current.name}><ApplicationIcon application={application} /></IconButton> :
        <Button {...props} variant="secondary" size="sm" className="w-full" aria-label={c.switcher} aria-description={current.name} iconRight={<IcChevD size={14} />}>{title}</Button>} />
  </div>;
}
