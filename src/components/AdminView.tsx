import { Switch, Input } from "../ds/Field";
import { Avatar } from "../ds/Display";
import { Button, IconButton } from "../ds/Button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { openProjectWizard } from "../palette/events";
import { API_BASE, departmentsApi, projectsApi, usersApi, type DepartmentMember, type SafeUser } from "../api";
import type { ProjectRole, ProjectSummary } from "../types";
import { LIMITS } from "../validation";
import { IcChevD, IcChevR, IcInbox, IcLock, IcPlus, IcTrash, IcUsers } from "../icons";
import { ProjectMark } from "../ui";
import { Combobox, type ComboOption } from "../ds/Combobox";
import { useT } from "../i18n";

const PROJECT_ROLES: ProjectRole[] = ["manager", "employee", "viewer"];

function DepartmentUserPicker({ exclude, busy, onPick }: { exclude: Set<string>; busy: boolean; onPick: (id: string) => void }) {
  const { t } = useT();
  const [selection, setSelection] = useState<ComboOption | null>(null);
  const [revision, setRevision] = useState(0);
  const load = useCallback(async (q: string) => (await usersApi.pickable(q)).filter((u) => !exclude.has(u.id)).map((u) => ({ id: u.id, label: u.name, description: u.jobRole })), [exclude]);
  return <fieldset disabled={busy} aria-busy={busy} className="flex flex-col gap-2">
    <Combobox key={revision} label={t("ui.whomToAdd")} placeholder={t("ui.findEmployee")} minChars={2} load={load} value={selection} onSelect={setSelection} />
    <Button variant="primary" size="sm" disabled={busy || !selection} onClick={() => {
      if (!selection || busy) return;
      onPick(selection.id); setSelection(null); setRevision((v) => v + 1);
    }}>{t("ui.add")}</Button>
  </fieldset>;
}

/** Инлайн-переименование: input выглядит как текст, сохраняет по blur/Enter. */
function EditableName({ value, onSave, maxLength }: { value: string; onSave: (v: string) => void; maxLength: number }) {
  const { t } = useT();
  return (
    <div className="min-w-0 flex-1"><Input
      key={value}
      aria-label={t("admin.renameDepartment", { name: value })}
      defaultValue={value}
      maxLength={maxLength}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = value;
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== value) onSave(v);
        else e.target.value = value;
      }}

    /></div>
  );
}

function MiniAvatar({ user }: { user: { name?: string; initials?: string; color?: string } | undefined }) {
  return (
    <Avatar person={{ name: user?.name ?? "?" }} size={24} />
  );
}

/** Состав отдела (department_members, миграция 009) — ленивая загрузка на
 *  раскрытие, тот же паттерн, что ProjectMembers выше. LDAP-строки (source
 *  из группы AD) показаны, но не убираются отсюда — только через саму
 *  группу в директории; убрать можно только вручную добавленных. */
function DepartmentMembers({ departmentId }: { departmentId: string }) {
  const { t, lang } = useT();
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; members: DepartmentMember[] }
  >({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const load = useCallback(() => {
    setState({ status: "loading" });
    departmentsApi
      .listMembers(departmentId)
      .then((members) => alive.current && setState({ status: "ready", members }))
      .catch(() => alive.current && setState({ status: "error" }));
  }, [departmentId]);
  useEffect(() => load(), [load]);

  const run = (op: Promise<unknown>) => {
    setBusy(true);
    op.catch(() => {}).finally(() => {
      if (!alive.current) return;
      setBusy(false);
      load();
    });
  };

  if (state.status === "loading")
    return <p className="border-t border-linesoft bg-sunken px-3 py-2 text-[11px] text-faint">{t("admin.loadingMembers")}</p>;
  if (state.status === "error")
    return (
      <p className="border-t border-linesoft bg-sunken px-3 py-2 text-[11px] text-danger">
        {t("admin.loadMembersFailed")}{" "}
        <Button variant="ghost" size="sm" className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0" onClick={load}>
          {t("reports.retry")}
        </Button>
      </p>
    );

  const rows = [...state.members].sort((a, b) => a.name.localeCompare(b.name, lang === "ru" ? "ru" : "en"));
  const exclude = new Set(state.members.map((m) => m.userId));

  return (
    <div className="border-t border-linesoft bg-sunken px-3 py-2.5">
      <p className="mb-1.5 text-[11.5px] font-medium text-faint">{t("admin.departmentMembers", { count: rows.length })}</p>

      <div className="space-y-1">
        {rows.map((m) => (
          <div key={m.userId} className="flex items-center gap-2">
            <MiniAvatar user={m} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{m.name}</span>
            <span
              title={t(m.source === "ldap" ? "admin.fromLdap" : "admin.addedManually")}
              className="shrink-0 rounded bg-linesoft px-1.5 py-0.5 text-[11.5px] font-semibold text-faint"
            >
              {m.source === "ldap" ? "LDAP" : t("admin.manually")}
            </span>
            <Button variant="secondary" size="sm"
              disabled={m.source === "ldap" ? t("admin.removeInDirectory") : busy}
              onClick={() => run(departmentsApi.removeMember(departmentId, m.userId))}
              className="shrink-0 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
            >
              {t("access.remove")}
            </Button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[11px] text-faint">{t("admin.noMembers")}</p>}
      </div>

      <div className="mt-2">
        <DepartmentUserPicker
          exclude={exclude}
          busy={busy}
          onPick={(userId) => run(departmentsApi.addMember(departmentId, userId))}
        />
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
        {t("admin.departmentMembersHint")}
      </p>
    </div>
  );
}

export default function AdminView() {
  const { t } = useT();
  const {
    data,
    can,
    createDepartment,
    renameDepartment,
    deleteDepartment,
    switchProject,
    setView,
    authMode,
    setDepartmentLdapGroup,
    resyncLdap,
  } = useStore();
  const canManage = can("manageAccess");
  const ldap = authMode === "ldap";

  const byDept = useMemo(() => {
    const m: Record<string, ProjectSummary[]> = {};
    for (const p of data.projects) (m[p.departmentId] ??= []).push(p);
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.key.localeCompare(b.key));
    return m;
  }, [data.projects]);

  const [newDept, setNewDept] = useState("");

  const [openDeptMembers, setOpenDeptMembers] = useState<Record<string, boolean>>({});
  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <IcLock size={15} /> {t("admin.denied")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[900px] min-[1536px]:max-w-[1120px] min-[1920px]:max-w-[1360px] px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t("admin.title")}</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {t("admin.subtitle")}{ldap && ` ${t("admin.ldapSubtitle")}`}
            </p>
          </div>
          {/* Экспорт — «Организация → Экспорт», ресинк и LDAP-группы отделов — «Организация → LDAP» (ТЗ 5.9). */}
        </div>

        {/* новый отдел */}
        <div className="mt-4 flex items-center gap-2 surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-3">
          <div className="min-w-0 flex-1"><Input aria-label={t("admin.newDepartmentPlaceholder")}
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newDept.trim() && (createDepartment(newDept.trim()), setNewDept(""))}
            placeholder={t("admin.newDepartmentPlaceholder")}
            maxLength={LIMITS.department.name.max}

          /></div>
          <Button variant="primary" size="sm"
            onClick={() => {
              createDepartment(newDept.trim());
              setNewDept("");
            }}
            disabled={!newDept.trim()}
            className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
          >
            <IcPlus size={13} /> {t("admin.department")}
          </Button>
        </div>

        {/* список отделов */}
        <div className="mt-4 space-y-3">
          {data.departments.map((d) => {
            const projs = byDept[d.id] ?? [];
            return (
              <section key={d.id} className="surface-raised rounded-xl ring-1 ring-inset ring-line/70">
                <header className="flex items-center gap-2 border-b border-linesoft bg-sunken px-3 py-2">
                  <IcInbox size={15} className="shrink-0 text-accent" />
                  <EditableName value={d.name} onSave={(v) => renameDepartment(d.id, v)} maxLength={LIMITS.department.name.max} />
                  <span className="shrink-0 text-[11px] text-faint">{t("admin.projectCount", { count: projs.length })}</span>
                  <Button variant="secondary" size="sm"
                    onClick={() => setOpenDeptMembers((s) => ({ ...s, [d.id]: !s[d.id] }))}
                    className="shrink-0 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                  >
                    {openDeptMembers[d.id] ? <IcChevD size={12} /> : <IcChevR size={12} />}
                    <IcUsers size={12} /> {t("admin.members")}
                  </Button>
                  <IconButton variant="secondary" size="sm" label={t(projs.length > 0 ? "admin.deleteDepartmentBlocked" : "admin.deleteDepartment")}
                    onClick={() =>
                      projs.length === 0 &&
                      window.confirm(t("admin.deleteDepartmentConfirm", { name: d.name })) &&
                      deleteDepartment(d.id)
                    }
                    disabled={projs.length > 0 ? t("admin.deleteDepartmentBlocked") : false}

                    className="shrink-0"
                  >
                    <IcTrash size={13} />
                  </IconButton>
                </header>

                {openDeptMembers[d.id] && <DepartmentMembers departmentId={d.id} />}

                <div className="divide-y divide-linesoft">
                  {projs.map((p) => (
                    <div key={p.id}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={22} />
                        <span className="w-12 shrink-0 font-mono text-[11.5px] font-medium text-faint">{p.key}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{p.name}</span>
                        {p.isShared && <span className="shrink-0 text-[11px] text-faint">{t("admin.shared")}</span>}
                        {/* Название, «общий», модули, состав и удаление — один дом: настройки проекта (ТЗ 5.9). */}
                        <Button variant="secondary" size="sm"
                          onClick={() => {
                            setView("projectSettings", "general");
                            if (p.id !== data.currentProjectId) switchProject(p.id);
                          }}
                          className="shrink-0 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                        >
                          {t("settings.menu")}
                        </Button>
                        <Button variant="secondary" size="sm"
                          onClick={() => {
                            setView("projectSettings", "access");
                            if (p.id !== data.currentProjectId) switchProject(p.id);
                          }}
                          className="shrink-0 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                        >
                          <IcUsers size={12} /> {t("admin.members")}
                        </Button>
                      </div>

                    </div>
                  ))}

                  {/* Новый проект — мастер с шаблоном, ключом и доступом (ТЗ 5.10). */}
                  <div className="bg-sunken px-3 py-2">
                    <Button variant="ghost" size="sm"
                      onClick={() => openProjectWizard(d.id)}
                      className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                    >
                      <IcPlus size={12} /> {t("wizard.newProjectIn", { name: d.name })}
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
          {data.departments.length === 0 && (
            <p className="rounded-xl border border-dashed border-line bg-panel px-4 py-6 text-center text-[12px] text-faint">
              {t("admin.noDepartments")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
