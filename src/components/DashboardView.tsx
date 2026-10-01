/** Дашборды (ADR-0022): раздел организации «Дашборды» (`/dashboards/:id`, первым пунктом — встроенные «Отчёты»)
 *  и вкладка проекта «Обзор» (`/p/KEY/overview`). Оба — одна и та же сетка виджетов; разница — где хранится набор
 *  и кто его правит. Данные каждый видит только в пределах своих прав — это обеспечивает сервер. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useT, type TKey } from "../i18n";
import { useStore } from "../store";
import { dashboardsApi, type DashboardDto } from "../api";
import { Button, Dialog, EmptyState, IconButton, Input, Menu } from "../ds";
import { IcDashboard, IcDots, IcPencil, IcPlus, IcUndo } from "../icons";
import { DashboardTabs, useDashboardList } from "../dashboards/DashboardTabs";
import { LIMITS } from "../validation";
import { DashboardGrid, GAP, ROW_H, WidgetFrame } from "../dashboards/DashboardGrid";
import { WidgetBody, type WidgetNav } from "../dashboards/widgets";
import { AddWidgetDialog, WidgetSettingsDialog } from "../dashboards/WidgetDialogs";
import { useDashboardData } from "../dashboards/useDashboardData";
import { DASHBOARD_TEMPLATES, DEFAULT_ORG_OVERVIEW, DEFAULT_PROJECT_OVERVIEW, ORG_OVERVIEW_ID, addFromCatalog, defaultTitleKey, type Widget } from "../dashboards/catalog";
import { compact } from "../dashboards/grid";

/* ---------------- общий холст: просмотр и правка ---------------- */

function useNav(): WidgetNav {
  const { data, openIssue, switchProject } = useStore();
  const [, navigate] = useLocation();
  return useMemo(
    () => ({
      openIssue: (projectId, issueId) => {
        if (projectId === data.currentProjectId) openIssue(issueId, "page");
        else switchProject(projectId, issueId, "page");
      },
      openList: (projectId, query) => {
        const key = data.projects.find((p) => p.id === projectId)?.key;
        if (!key) return;
        const qs = new URLSearchParams(query).toString();
        navigate(`/p/${encodeURIComponent(key)}/list${qs ? `?${qs}` : ""}`);
      },
      openProject: (projectId) => {
        const key = data.projects.find((p) => p.id === projectId)?.key;
        if (key) navigate(`/p/${encodeURIComponent(key)}/overview`);
      },
    }),
    [data.currentProjectId, data.projects, openIssue, switchProject, navigate],
  );
}

function Canvas({
  saved,
  canEdit,
  projectId,
  onSave,
  head,
  actions,
  editExtra,
  emptyHint,
}: {
  saved: Widget[];
  canEdit: boolean;
  /** Обзор проекта: область всех виджетов — этот проект. null — дашборд организации. */
  projectId: string | null;
  onSave: (widgets: Widget[]) => Promise<void>;
  head: ReactNode;
  actions?: ReactNode;
  editExtra?: (stop: () => void) => ReactNode;
  emptyHint: string;
}) {
  const { t } = useT();
  const { data } = useStore();
  const nav = useNav();
  const [draft, setDraft] = useState<Widget[] | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const editing = draft !== null;
  const widgets = draft ?? saved;
  const d = useDashboardData(widgets, projectId);

  const titleOf = (w: Widget) => w.title?.trim() || t(defaultTitleKey(w));
  const hintOf = (w: Widget) => {
    if (projectId) return undefined;
    if (w.projectId) return data.projects.find((p) => p.id === w.projectId)?.key;
    if (w.departmentId) return data.departments.find((x) => x.id === w.departmentId)?.name;
    return undefined;
  };
  const scopeProject = (w: Widget) => projectId ?? w.projectId ?? null;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(compact(draft));
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };
  const remove = (id: string) => setDraft((cur) => compact((cur ?? saved).filter((w) => w.id !== id)));
  const configured = configId ? widgets.find((w) => w.id === configId) : undefined;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-5 sm:px-6">
        <div className="mr-auto min-w-0">{head}</div>
        {editing ? (
          <>
            {editExtra?.(() => setDraft(null))}
            <Button size="sm" iconLeft={<IcPlus size={13} />} onClick={() => setAdding(true)} disabled={widgets.length >= LIMITS.widgetsPerDashboard ? t("dash.tooMany", { n: LIMITS.widgetsPerDashboard }) : false}>
              {t("dash.addWidget")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} loading={saving}>
              {t("dash.done")}
            </Button>
          </>
        ) : (
          <>
            {actions}
            <IconButton size="sm" label={t("dash.refresh")} onClick={d.refresh}>
              <IcUndo size={14} className="-scale-x-100" />
            </IconButton>
            {canEdit && (
              <Button size="sm" iconLeft={<IcPencil size={13} />} onClick={() => setDraft(saved)}>
                {t("dash.edit")}
              </Button>
            )}
          </>
        )}
      </div>
      {editing && <p className="px-4 pb-3 text-[12px] text-faint sm:px-6">{t("dash.editHint")}</p>}
      {d.failed && !editing && (
        <p className="mx-4 mb-3 rounded-lg bg-dangersoft px-3 py-2 text-[12.5px] text-danger sm:mx-6" role="alert">
          {t("dash.loadFailed")}{" "}
          <button type="button" onClick={d.refresh} className="font-semibold underline">
            {t("common.retry")}
          </button>
        </p>
      )}
      <div className="px-4 pb-8 sm:px-6">
        {widgets.length === 0 ? (
          <EmptyState
            icon={<IcDashboard size={22} tone="violet" />}
            title={t("dash.emptyTitle")}
            sub={emptyHint}
            action={
              editing ? (
                <Button size="sm" variant="primary" iconLeft={<IcPlus size={13} />} onClick={() => setAdding(true)}>
                  {t("dash.addWidget")}
                </Button>
              ) : canEdit ? (
                <Button size="sm" variant="primary" iconLeft={<IcPencil size={13} />} onClick={() => setDraft(saved)}>
                  {t("dash.edit")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DashboardGrid
            widgets={widgets}
            editing={editing}
            onChange={setDraft}
            onRemove={remove}
            renderFrame={(w, drag) => (
              <WidgetFrame
                title={titleOf(w)}
                hint={hintOf(w)}
                editing={editing}
                drag={drag}
                loading={d.loading && !!d.results[w.id]}
                onConfigure={() => setConfigId(w.id)}
                onRemove={() => remove(w.id)}
              >
                {d.results[w.id] ? (
                  <WidgetBody w={w} data={d.results[w.id]} nav={nav} projectId={scopeProject(w)} height={w.h * ROW_H + (w.h - 1) * GAP - 44} />
                ) : (
                  <WidgetSkeleton />
                )}
              </WidgetFrame>
            )}
          />
        )}
      </div>
      <AddWidgetDialog
        open={adding}
        onClose={() => setAdding(false)}
        onPick={(item) => {
          setDraft((cur) => addFromCatalog(cur ?? saved, item));
          setAdding(false);
        }}
      />
      {configured && (
        <WidgetSettingsDialog
          w={configured}
          orgScope={!projectId}
          onChange={(next) => setDraft((cur) => (cur ?? saved).map((w) => (w.id === next.id ? next : w)))}
          onClose={() => setConfigId(null)}
        />
      )}
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="flex h-full flex-col justify-end gap-2" aria-hidden="true">
      <div className="ds-sk h-3 w-2/3" />
      <div className="ds-sk h-3 w-1/2" />
    </div>
  );
}

/* ---------------- обзор проекта ---------------- */

function ProjectOverview() {
  const { t } = useT();
  const { data, toast } = useStore();
  const projectId = data.currentProjectId;
  const [state, setState] = useState<{ dashboard: DashboardDto | null; canEdit: boolean; loaded: boolean }>({ dashboard: null, canEdit: false, loaded: false });

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setState((s) => ({ ...s, loaded: false }));
    dashboardsApi.overview(projectId).then(
      (r) => alive && setState({ dashboard: r.dashboard, canEdit: r.canEdit, loaded: true }),
      () => alive && setState({ dashboard: null, canEdit: false, loaded: true }),
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const { errText } = useT();
  const save = async (widgets: Widget[]) => {
    try {
      const d = await dashboardsApi.saveOverview(projectId, widgets);
      setState((s) => ({ ...s, dashboard: d }));
      toast("success", t("dash.saved"));
    } catch (e) {
      toast("error", errText(e, t("dash.saveFailed")));
      throw e;
    }
  };
  const reset = async (stop: () => void) => {
    try {
      await dashboardsApi.resetOverview(projectId);
      setState((s) => ({ ...s, dashboard: null }));
      stop();
      toast("success", t("dash.resetDone"));
    } catch (e) {
      toast("error", errText(e, t("dash.saveFailed")));
    }
  };

  if (!state.loaded) return <div className="p-6" aria-busy="true" />;
  const widgets = state.dashboard?.widgets ?? DEFAULT_PROJECT_OVERVIEW;
  return (
    <Canvas
      key={projectId}
      saved={widgets}
      canEdit={state.canEdit}
      projectId={projectId}
      onSave={save}
      emptyHint={t("dash.emptyProject")}
      head={
        <>
          <h1 className="font-disp text-[20px] font-bold tracking-[-0.025em] text-ink">{t("dash.overview")}</h1>
          <p className="mt-0.5 text-[12.5px] text-faint">{state.dashboard ? t("dash.overviewSub") : t("dash.overviewBuiltin")}</p>
        </>
      }
      editExtra={(stop) =>
        state.dashboard ? (
          <Button size="sm" variant="ghost" onClick={() => void reset(stop)}>
            {t("dash.resetOverview")}
          </Button>
        ) : null
      }
    />
  );
}

/* ---------------- раздел «Дашборды» ---------------- */

function NewDashboardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (d: DashboardDto) => void }) {
  const { t, errText } = useT();
  const { me, toast } = useStore();
  const [name, setName] = useState("");
  const [tpl, setTpl] = useState(DASHBOARD_TEMPLATES[0].id);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = me.globalRole === "admin";
  const create = async () => {
    const template = DASHBOARD_TEMPLATES.find((x) => x.id === tpl)!;
    setBusy(true);
    try {
      const d = await dashboardsApi.create({ name: name.trim() || t(template.nameKey), shared: isAdmin && shared, widgets: template.widgets() });
      onCreated(d);
    } catch (e) {
      toast("error", errText(e, t("dash.createFailed")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("dash.newTitle")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void create()} loading={busy}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label={t("dash.name")} value={name} autoFocus maxLength={LIMITS.dashboard.name.max} placeholder={t(DASHBOARD_TEMPLATES.find((x) => x.id === tpl)!.nameKey)} onChange={(e) => setName(e.target.value)} />
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-sub">{t("dash.startFrom")}</legend>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {DASHBOARD_TEMPLATES.map((x) => (
              <label key={x.id} className={`cursor-pointer rounded-lg px-3 py-2 ring-1 ring-inset transition-colors ${tpl === x.id ? "bg-accentsoft ring-accent/60" : "ring-line/70 hover:bg-hover"}`}>
                <input type="radio" name="dash-tpl" value={x.id} checked={tpl === x.id} onChange={() => setTpl(x.id)} className="sr-only" />
                <span className="block text-[13px] font-semibold text-ink">{t(x.nameKey)}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">{t(x.descKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {isAdmin && (
          <label className="flex items-start gap-2 text-[12.5px] text-sub">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-ink">{t("dash.shareLabel")}</span>
              <span className="block text-[11.5px] text-faint">{t("dash.shareHint")}</span>
            </span>
          </label>
        )}
      </div>
    </Dialog>
  );
}

function RenameDialog({ d, onClose, onDone }: { d: DashboardDto; onClose: () => void; onDone: (d: DashboardDto) => void }) {
  const { t, errText } = useT();
  const { toast } = useStore();
  const [name, setName] = useState(d.name);
  const submit = async () => {
    const v = name.trim();
    if (!v || v === d.name) return onClose();
    try {
      onDone(await dashboardsApi.patch(d.id, { name: v }));
    } catch (e) {
      toast("error", errText(e, t("dash.saveFailed")));
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("dash.rename")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Input label={t("dash.name")} value={name} autoFocus maxLength={LIMITS.dashboard.name.max} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
    </Dialog>
  );
}

function OrgDashboards() {
  const { t, errText } = useT();
  const { ui, me, setView, toast } = useStore();
  const { list, setList } = useDashboardList();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState(false);
  const builtin = !ui.section || ui.section === ORG_OVERVIEW_ID;
  const current = list && !builtin ? list.find((d) => d.id === ui.section) : undefined;

  // /dashboards без id — встроенный «Обзор организации»; адрес обновится сам (useRouterSync).
  useEffect(() => {
    if (!ui.section) setView("dashboards", ORG_OVERVIEW_ID);
  }, [ui.section, setView]);

  /** Встроенный обзор не правится; «Сохранить как свой» — личная копия, которую можно менять. */
  const copyOverview = async () => {
    setCopying(true);
    try {
      const d = await dashboardsApi.create({ name: t("dash.orgOverview"), shared: false, widgets: DEFAULT_ORG_OVERVIEW });
      setList((l) => [...l, d]);
      setView("dashboards", d.id);
      toast("success", t("dash.copied"));
    } catch (e) {
      toast("error", errText(e, t("dash.createFailed")));
    } finally {
      setCopying(false);
    }
  };

  const replace = (d: DashboardDto) => setList((l) => l.map((x) => (x.id === d.id ? d : x)));
  const save = async (widgets: Widget[]) => {
    if (!current) return;
    try {
      replace(await dashboardsApi.patch(current.id, { widgets }));
      toast("success", t("dash.saved"));
    } catch (e) {
      toast("error", errText(e, t("dash.saveFailed")));
      throw e;
    }
  };
  const toggleShared = async () => {
    if (!current) return;
    try {
      replace(await dashboardsApi.patch(current.id, { shared: current.kind !== "org" }));
    } catch (e) {
      toast("error", errText(e, t("dash.saveFailed")));
    }
  };
  const remove = async () => {
    if (!current) return;
    try {
      await dashboardsApi.remove(current.id);
      setList((l) => l.filter((x) => x.id !== current.id));
      setDeleting(false);
      setView("dashboards", "");
      toast("success", t("dash.deleted"));
    } catch (e) {
      toast("error", errText(e, t("dash.saveFailed")));
    }
  };

  const tabs = <DashboardTabs current={builtin ? ORG_OVERVIEW_ID : (current?.id ?? "")} dashboards={list} onNew={() => setCreating(true)} />;
  const dialogs = (
    <>
      {creating && (
        <NewDashboardDialog
          onClose={() => setCreating(false)}
          onCreated={(d) => {
            setList((l) => [...l, d]);
            setCreating(false);
            setView("dashboards", d.id);
          }}
        />
      )}
      {renaming && current && (
        <RenameDialog
          d={current}
          onClose={() => setRenaming(false)}
          onDone={(d) => {
            replace(d);
            setRenaming(false);
          }}
        />
      )}
      {deleting && current && (
        <Dialog
          open
          onClose={() => setDeleting(false)}
          title={t("dash.deleteTitle", { name: current.name })}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={() => void remove()}>
                {t("common.delete")}
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-sub">{t(current.kind === "org" ? "dash.deleteSharedHint" : "dash.deleteHint")}</p>
        </Dialog>
      )}
    </>
  );

  if (builtin)
    return (
      <div className="flex h-full flex-col">
        {tabs}
        <div className="min-h-0 flex-1">
          <Canvas
            saved={DEFAULT_ORG_OVERVIEW}
            canEdit={false}
            projectId={null}
            onSave={async () => undefined}
            emptyHint=""
            head={
              <>
                <h1 className="font-disp text-[20px] font-bold tracking-[-0.025em] text-ink">{t("dash.orgOverview")}</h1>
                <p className="mt-0.5 text-[12.5px] text-faint">{t("dash.orgOverviewSub")}</p>
              </>
            }
            actions={
              <Button size="sm" iconLeft={<IcPlus size={13} />} onClick={() => void copyOverview()} loading={copying}>
                {t("dash.copyToMine")}
              </Button>
            }
          />
        </div>
        {dialogs}
      </div>
    );
  if (!list) return <div className="flex h-full flex-col">{tabs}</div>;
  if (!current)
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        {tabs}
        <div className="px-4 py-8 sm:px-6">
          <EmptyState
            icon={<IcDashboard size={22} tone="violet" />}
            title={t("dash.notFound")}
            sub={t("dash.notFoundSub")}
            action={
              <Button size="sm" variant="primary" iconLeft={<IcPlus size={13} />} onClick={() => setCreating(true)}>
                {t("dash.new")}
              </Button>
            }
          />
        </div>
        {dialogs}
      </div>
    );

  const kindLabel: TKey = current.kind === "org" ? "dash.kind.org" : "dash.kind.personal";
  const canShare = me.globalRole === "admin" && current.ownerId === me.id;
  return (
    <div className="flex h-full flex-col">
      {tabs}
      <div className="min-h-0 flex-1">
        <Canvas
          key={current.id}
          saved={current.widgets}
          canEdit={current.canEdit}
          projectId={null}
          onSave={save}
          emptyHint={t(current.canEdit ? "dash.emptyEditable" : "dash.emptyReadonly")}
          head={
            <>
              <h1 className="truncate font-disp text-[20px] font-bold tracking-[-0.025em] text-ink">{current.name}</h1>
              <p className="mt-0.5 text-[12.5px] text-faint">{t(kindLabel)}</p>
            </>
          }
          actions={
            current.canEdit && (
              <Menu
                label={t("dash.more")}
                placement="bottom-end"
                trigger={(p) => (
                  <IconButton {...p} size="sm" label={t("dash.more")}>
                    <IcDots size={14} />
                  </IconButton>
                )}
                items={[
                  { id: "rename", label: t("dash.rename"), onSelect: () => setRenaming(true) },
                  ...(canShare ? [{ id: "share", label: t(current.kind === "org" ? "dash.makePersonal" : "dash.makeShared"), onSelect: () => void toggleShared() }] : []),
                  { kind: "sep" as const, id: "s" },
                  { id: "delete", label: t("common.delete"), danger: true, onSelect: () => setDeleting(true) },
                ]}
              />
            )
          }
        />
      </div>
      {dialogs}
    </div>
  );
}

export default function DashboardView({ mode }: { mode: "org" | "project" }) {
  return mode === "project" ? <ProjectOverview /> : <OrgDashboards />;
}
