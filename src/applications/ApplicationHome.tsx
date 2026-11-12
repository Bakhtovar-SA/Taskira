import { lazy, Suspense, useState } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { useT } from "../i18n";
import { applicationsCopy } from "../i18n/applications";
import { workspaceApi } from "../workspace/api";
import { useResource } from "../workspace/hooks";
import { materialPath } from "../workspace/shared";
import { Button } from "../ds/Button";
import { Input } from "../ds/Field";
import { EmptyState, Skeleton } from "../ds/Display";
import { ProjectMark } from "../ui";
import { projectAvailable, defaultApplicationView } from "./navigation";
import { ApplicationIcon } from "./ApplicationSwitcher";
const HomeView = lazy(() => import("../components/HomeView"));

export default function ApplicationHome() {
  const { application = "work", applications } = useStore();
  const enabled = applications?.applications.find((app) => app.id === application)?.enabled !== false;
  return application === "work" && enabled ? <Suspense fallback={<div className="skeleton mx-6 mt-6 h-32 rounded-xl" />}><HomeView /></Suspense> : <MaterialHome key={application} />;
}

function MaterialHome() {
  const { data, application = "knowledge", applications, applicationsError, refreshApplications, enterProject, setView, me } = useStore();
  const { lang } = useT(), c = applicationsCopy(lang), app = c.apps[application];
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const projects = data.projects.filter((p) => projectAvailable(application, p.id, applications));
  const enabled = !!applications?.applications.find((a) => a.id === application)?.enabled;
  const kind = application === "knowledge" ? "document" : "object";
  const r = useResource((signal) => enabled ? workspaceApi.library(query, signal, { kind }) : Promise.resolve({ items: [], truncated: false }), [data.currentUserId, kind, query, enabled]);
  const items = r.data?.items.filter((item) => item.ref.kind === kind && projects.some((p) => p.id === item.projectId)) ?? [];
  const open = (id: string) => { setView(defaultApplicationView(application)); enterProject(id); };
  return <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
    <div className="mx-auto max-w-[1060px]">
      <div className="mb-6 flex items-start gap-3">
        <span className="mt-1 flex shrink-0 rounded-lg bg-sunken p-2"><ApplicationIcon application={application} size={24} /></span>
        <div className="min-w-0"><h1 data-view-heading tabIndex={-1} className="font-disp text-[24px] font-semibold text-ink">{app.name}</h1><p className="mt-1 max-w-[65ch] text-[14px] leading-relaxed text-sub">{app.start}</p></div>
      </div>
      {applicationsError && <div role="alert" className="mb-4 text-[13px] text-danger"><p>{c.loadError}</p><Button onClick={() => void refreshApplications()} size="sm">{c.retry}</Button></div>}
      {!enabled && applications ? <EmptyState icon={<ApplicationIcon application={application} size={24} />} title={c.unavailable} sub={c.unavailableHint} action={me.globalRole === "admin" ? <Button onClick={() => setView("orgSettings", "applications")}>{c.manage}</Button> : undefined} /> : <>
        <section className="mb-8" aria-label={c.projects}>
          <h2 className="mb-3 text-[15px] font-semibold text-ink">{c.projects}</h2>
          {!projects.length ? <EmptyState icon={<ApplicationIcon application={application} size={24} />} title={c.noProjects} sub={c.noProjectsHint} /> : <div className="divide-y divide-linesoft rounded-xl border border-linesoft bg-panel">
            {projects.map((p) => <Button key={p.id} variant="ghost" size="lg" className="w-full justify-start rounded-none text-left" onClick={() => open(p.id)} iconLeft={<ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={24} />}>
              <span className="flex min-w-0 items-center gap-3"><span className="truncate font-semibold">{p.name}</span><span className="font-mono text-[12px] text-faint">{p.key}</span></span>
            </Button>)}
          </div>}
        </section>
        <section aria-label={c.recent}>
          <div className="mb-3 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-[15px] font-semibold text-ink">{c.recent}</h2><Input aria-label={c.search} placeholder={c.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          {r.error ? <div role="alert" className="text-[13px] text-danger"><p>{r.error}</p><Button size="sm" onClick={r.reload}>{c.retry}</Button></div> : r.loading && !r.data ? <div aria-busy="true" className="space-y-3">{[0,1,2].map((n) => <Skeleton.Block key={n} h={48} />)}</div> : !items.length ? <EmptyState icon={<ApplicationIcon application={application} size={24} />} title={query.trim() ? c.noResults : c.noMaterials} sub={query.trim() ? c.noResultsHint : c.noMaterialsHint} /> : <ul className="divide-y divide-linesoft rounded-xl border border-linesoft bg-panel">
            {items.map((item) => <li key={item.ref.id}><a className="ds-focus block px-4 py-3 transition-colors hover:bg-hover" href={materialPath(item)} onClick={(event) => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(materialPath(item)); }}>
              <span className="block truncate text-[14px] font-medium text-ink">{item.title}</span><span className="block truncate text-[12px] text-faint">{item.projectName}{item.text ? ` · ${item.text.slice(0, 160)}` : ""}</span>
            </a></li>)}
          </ul>}
        </section>
      </>}
    </div>
  </div>;
}
