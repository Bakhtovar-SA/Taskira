import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { API_BASE, departmentsApi, projectsApi, usersApi, type DepartmentMember, type SafeUser } from "../api";
import type { ProjectRole, ProjectSummary } from "../types";
import { LIMITS } from "../validation";
import { IcChevD, IcChevR, IcInbox, IcLock, IcPlus, IcTrash, IcUsers } from "../icons";
import { UserSearchPicker } from "../ui";
import { useT } from "../i18n";

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const PROJECT_ROLES: ProjectRole[] = ["manager", "employee", "viewer"];

/** Инлайн-переименование: input выглядит как текст, сохраняет по blur/Enter. */
function EditableName({ value, onSave, maxLength }: { value: string; onSave: (v: string) => void; maxLength: number }) {
  return (
    <input
      key={value}
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
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] font-semibold text-ink hover:border-linesoft focus:border-accent focus:shadow-focus focus:bg-panel focus:outline-none"
    />
  );
}

function MiniAvatar({ user }: { user: { name?: string; initials?: string; color?: string } | undefined }) {
  return (
    <span
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-onaccent"
      style={{ background: user?.color ?? "var(--gray-9)" }}
      title={user?.name}
    >
      {user?.initials ?? "?"}
    </span>
  );
}

/** Состав конкретного проекта — ленивая загрузка bootstrap на раскрытие.
 *  Добавление здесь НЕ открывает другие проекты отдела: выбор проекта + роли явный.
 *  `adminIds` — только чтобы исключить админов ресурса из кандидатов пикера
 *  (у них и так полный доступ); сам список кандидатов больше не выгружается
 *  целиком — см. UserSearchPicker. */
function ProjectMembers({ projectId, adminIds }: { projectId: string; adminIds: Set<string> }) {
  const { t, lang } = useT();
  const { setProjectMember, removeProjectMember } = useStore();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; members: { userId: string; role: ProjectRole }[]; users: SafeUser[] }
  >({ status: "loading" });
  const [addRole, setAddRole] = useState<ProjectRole>("employee");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const load = useCallback(() => {
    setState({ status: "loading" });
    projectsApi
      .get(projectId)
      .then((b) => alive.current && setState({ status: "ready", members: b.members, users: b.users }))
      .catch(() => alive.current && setState({ status: "error" }));
  }, [projectId]);
  useEffect(() => load(), [load]);

  const run = (op: Promise<void>) => {
    setBusy(true);
    op.catch(() => {}).finally(() => {
      if (!alive.current) return;
      setBusy(false);
      load(); // рефетч — увидеть отказ гарда «последний менеджер» и т.п.
    });
  };

  if (state.status === "loading")
    return <p className="border-t border-linesoft bg-sunken px-3 py-2 text-[11px] text-faint">{t("admin.loadingMembers")}</p>;
  if (state.status === "error")
    return (
      <p className="border-t border-linesoft bg-sunken px-3 py-2 text-[11px] text-danger">
        {t("admin.loadMembersFailed")}{" "}
        <button className="underline" onClick={load}>
          {t("reports.retry")}
        </button>
      </p>
    );

  const roleByUser = new Map(state.members.map((m) => [m.userId, m.role]));
  const rows = state.members
    .map((m) => ({ m, u: state.users.find((x) => x.id === m.userId) }))
    .sort((a, b) => (a.u?.name ?? "").localeCompare(b.u?.name ?? "", lang === "ru" ? "ru" : "en"));
  const exclude = new Set([...roleByUser.keys(), ...adminIds]);

  return (
    <div className="border-t border-linesoft bg-sunken px-3 py-2.5">
      <p className="mb-1.5 text-[11.5px] font-medium text-faint">{t("admin.projectMembers", { count: state.members.length })}</p>

      <div className="space-y-1">
        {rows.map(({ m, u }) => (
          <div key={m.userId} className="flex items-center gap-2">
            <MiniAvatar user={u} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{u?.name ?? m.userId}</span>
            <select
              value={roleByUser.get(m.userId)}
              disabled={busy}
              onChange={(e) => run(setProjectMember(projectId, m.userId, e.target.value as ProjectRole))}
              className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] font-semibold text-sub focus:border-accent focus:shadow-focus focus:outline-none disabled:opacity-50"
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}.name`)}
                </option>
              ))}
            </select>
            <button
              disabled={busy}
              onClick={() => run(removeProjectMember(projectId, m.userId))}
              className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10.5px] font-semibold text-sub transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
            >
              {t("access.remove")}
            </button>
          </div>
        ))}
        {state.members.length === 0 && <p className="text-[11px] text-faint">{t("admin.noMembers")}</p>}
      </div>

      <div className="mt-2 flex flex-wrap items-start gap-2">
        <select
          value={addRole}
          onChange={(e) => setAddRole(e.target.value as ProjectRole)}
          disabled={busy}
          className="shrink-0 rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-semibold text-sub focus:border-accent focus:shadow-focus focus:outline-none disabled:opacity-50"
        >
          {PROJECT_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`role.${r}.name`)}
            </option>
          ))}
        </select>
        <div className="min-w-[220px] flex-1">
          <UserSearchPicker
            exclude={exclude}
            disabled={busy}
            pickLabel={t("ui.add")}
            onPick={(userId) => run(setProjectMember(projectId, userId, addRole))}
          />
        </div>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
        {t("admin.projectMembersHint")}
      </p>
    </div>
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
        <button className="underline" onClick={load}>
          {t("reports.retry")}
        </button>
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
            <button
              disabled={busy || m.source === "ldap"}
              title={t(m.source === "ldap" ? "admin.removeInDirectory" : "admin.removeFromDepartment")}
              onClick={() => run(departmentsApi.removeMember(departmentId, m.userId))}
              className="shrink-0 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10.5px] font-semibold text-sub transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
            >
              {t("access.remove")}
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[11px] text-faint">{t("admin.noMembers")}</p>}
      </div>

      <div className="mt-2">
        <UserSearchPicker
          exclude={exclude}
          disabled={busy}
          pickLabel={t("ui.add")}
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
    createProject,
    patchProject,
    deleteProject,
    switchProject,
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
  const [forms, setForms] = useState<Record<string, { key: string; name: string }>>({});
  const form = (id: string) => forms[id] ?? { key: "", name: "" };
  const setForm = (id: string, patch: Partial<{ key: string; name: string }>) =>
    setForms((s) => ({ ...s, [id]: { ...form(id), ...patch } }));

  const [openMembers, setOpenMembers] = useState<Record<string, boolean>>({});
  const [openDeptMembers, setOpenDeptMembers] = useState<Record<string, boolean>>({});
  // Только для исключения админов ресурса из пикера состава проекта (у них и
  // так полный доступ) — сам список кандидатов больше не выгружается целиком.
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!canManage) return;
    usersApi
      .list()
      .then((users) => setAdminIds(new Set(users.filter((u) => u.globalRole === "admin").map((u) => u.id))))
      .catch(() => {});
  }, [canManage]);

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
          <div className="flex shrink-0 items-center gap-2">
            {/* ТЗ 3.5 (план v2 Трек 3): полный экспорт инсталляции — обычная
                ссылка, не fetch+blob: сессия живёт в HttpOnly-cookie (api/index.ts),
                браузер сам приложит её к прямой навигации по этому же origin/site
                (SESSION_COOKIE — SameSite=Strict, что разрешает переход по ссылке
                в пределах одного site, включая dev-порты localhost:3000/:8080).
                Сервер сам вернёт 403 не-админу — здесь только UX-подсказка. */}
            {canManage && (
              <a
                href={`${API_BASE}/api/admin/export`}
                title={t("admin.exportHint")}
                className="rounded-lg border border-line bg-panel shadow-e1 px-2.5 py-1.5 text-[11.5px] font-semibold text-sub transition-colors hover:bg-hover hover:text-ink"
              >
                {t("admin.export")}
              </a>
            )}
            {ldap && (
              <button
                onClick={resyncLdap}
                title={t("admin.resyncHint")}
                className="rounded-lg border border-line bg-panel shadow-e1 px-2.5 py-1.5 text-[11.5px] font-semibold text-sub transition-colors hover:bg-hover hover:text-ink"
              >
                {t("admin.resync")}
              </button>
            )}
          </div>
        </div>

        {/* новый отдел */}
        <div className="mt-4 flex items-center gap-2 surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-3">
          <input
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newDept.trim() && (createDepartment(newDept.trim()), setNewDept(""))}
            placeholder={t("admin.newDepartmentPlaceholder")}
            maxLength={LIMITS.department.name.max}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12.5px] focus:border-accent focus:shadow-focus focus:outline-none"
          />
          <button
            onClick={() => {
              createDepartment(newDept.trim());
              setNewDept("");
            }}
            disabled={!newDept.trim()}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-onaccent transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <IcPlus size={13} /> {t("admin.department")}
          </button>
        </div>

        {/* список отделов */}
        <div className="mt-4 space-y-3">
          {data.departments.map((d) => {
            const projs = byDept[d.id] ?? [];
            const f = form(d.id);
            return (
              <section key={d.id} className="surface-raised rounded-xl ring-1 ring-inset ring-line/70">
                <header className="flex items-center gap-2 border-b border-linesoft bg-sunken px-3 py-2">
                  <IcInbox size={15} className="shrink-0 text-accent" />
                  <EditableName value={d.name} onSave={(v) => renameDepartment(d.id, v)} maxLength={LIMITS.department.name.max} />
                  <span className="shrink-0 text-[11px] text-faint">{t("admin.projectCount", { count: projs.length })}</span>
                  <button
                    onClick={() => setOpenDeptMembers((s) => ({ ...s, [d.id]: !s[d.id] }))}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-panel shadow-e1 px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:bg-hover hover:text-ink"
                  >
                    {openDeptMembers[d.id] ? <IcChevD size={12} /> : <IcChevR size={12} />}
                    <IcUsers size={12} /> {t("admin.members")}
                  </button>
                  <button
                    onClick={() =>
                      projs.length === 0 &&
                      window.confirm(t("admin.deleteDepartmentConfirm", { name: d.name })) &&
                      deleteDepartment(d.id)
                    }
                    disabled={projs.length > 0}
                    title={t(projs.length > 0 ? "admin.deleteDepartmentBlocked" : "admin.deleteDepartment")}
                    className="shrink-0 rounded-md border border-line bg-panel p-1.5 text-sub transition-colors hover:border-danger hover:text-danger disabled:opacity-30 disabled:hover:border-line disabled:hover:text-sub"
                  >
                    <IcTrash size={13} />
                  </button>
                </header>

                {openDeptMembers[d.id] && <DepartmentMembers departmentId={d.id} />}

                {ldap && (
                  <div className="flex items-center gap-2 border-b border-linesoft bg-sunken px-3 py-1.5">
                    <span className="shrink-0 text-[11.5px] font-medium text-faint">{t("admin.ldapGroup")}</span>
                    <input
                      key={d.ldapGroupDn ?? ""}
                      defaultValue={d.ldapGroupDn ?? ""}
                      placeholder={t("admin.ldapPlaceholder")}
                      maxLength={LIMITS.department.ldapGroupDn.max}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (d.ldapGroupDn ?? "")) setDepartmentLdapGroup(d.id, v || null);
                      }}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-sub hover:border-linesoft focus:border-accent focus:shadow-focus focus:bg-panel focus:outline-none"
                    />
                  </div>
                )}

                <div className="divide-y divide-linesoft">
                  {projs.map((p) => (
                    <div key={p.id}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="w-16 shrink-0 rounded bg-linesoft px-1.5 py-0.5 text-center font-mono text-[10.5px] font-semibold text-sub">
                          {p.key}
                        </span>
                        <EditableName value={p.name} onSave={(v) => patchProject(p.id, { name: v })} maxLength={LIMITS.project.name.max} />
                        <label className="flex shrink-0 items-center gap-1 text-[11px] text-sub">
                          <input
                            type="checkbox"
                            checked={p.isShared}
                            onChange={(e) => patchProject(p.id, { isShared: e.target.checked })}
                          />
                          {t("admin.shared")}
                        </label>
                        <label
                          title={t("admin.sprintsHint")}
                          className="flex shrink-0 items-center gap-1 text-[11px] text-sub"
                        >
                          <input
                            type="checkbox"
                            checked={p.sprintsEnabled}
                            onChange={(e) => patchProject(p.id, { sprintsEnabled: e.target.checked })}
                          />
                          {t("admin.sprints")}
                        </label>
                        <button
                          onClick={() => setOpenMembers((s) => ({ ...s, [p.id]: !s[p.id] }))}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-panel shadow-e1 px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:bg-hover hover:text-ink"
                        >
                          {openMembers[p.id] ? <IcChevD size={12} /> : <IcChevR size={12} />}
                          <IcUsers size={12} /> {t("admin.members")}
                        </button>
                        <button
                          onClick={() => switchProject(p.id)}
                          disabled={p.id === data.currentProjectId}
                          className="shrink-0 rounded-lg border border-line bg-panel shadow-e1 px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
                        >
                          {t(p.id === data.currentProjectId ? "admin.opened" : "admin.open")}
                        </button>
                        <button
                          onClick={() =>
                            window.confirm(t("admin.deleteProjectConfirm", { key: p.key })) &&
                            deleteProject(p.id)
                          }
                          className="shrink-0 rounded-md border border-line bg-panel p-1.5 text-sub transition-colors hover:border-danger hover:text-danger"
                        >
                          <IcTrash size={13} />
                        </button>
                      </div>
                      {openMembers[p.id] && <ProjectMembers projectId={p.id} adminIds={adminIds} />}
                    </div>
                  ))}

                  {/* новый проект в этом отделе */}
                  <div className="flex flex-wrap items-center gap-2 bg-sunken px-3 py-2">
                    <input
                      value={f.key}
                      onChange={(e) => setForm(d.id, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                      placeholder={t("admin.keyPlaceholder")}
                      maxLength={10}
                      className="w-20 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px] uppercase focus:border-accent focus:shadow-focus focus:outline-none"
                    />
                    <input
                      value={f.name}
                      onChange={(e) => setForm(d.id, { name: e.target.value })}
                      placeholder={t("admin.projectNamePlaceholder")}
                      maxLength={LIMITS.project.name.max}
                      className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] focus:border-accent focus:shadow-focus focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        if (!KEY_RE.test(f.key) || !f.name.trim()) return;
                        createProject({ key: f.key, name: f.name.trim(), departmentId: d.id });
                        setForm(d.id, { key: "", name: "" });
                      }}
                      disabled={!KEY_RE.test(f.key) || !f.name.trim()}
                      className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-onaccent transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      <IcPlus size={12} /> {t("admin.project")}
                    </button>
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
