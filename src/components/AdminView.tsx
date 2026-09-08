import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { projectsApi, usersApi, type SafeUser } from "../api";
import type { ProjectRole, ProjectSummary } from "../types";
import { roleMeta } from "../permissions";
import { LIMITS } from "../validation";
import { IcChevD, IcChevR, IcInbox, IcLock, IcPlus, IcTrash, IcUsers } from "../icons";

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
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] font-semibold text-ink hover:border-linesoft focus:border-accent focus:bg-panel focus:outline-none"
    />
  );
}

function MiniAvatar({ user }: { user: { name?: string; initials?: string; color?: string } | undefined }) {
  return (
    <span
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: user?.color ?? "#94a3b8" }}
      title={user?.name}
    >
      {user?.initials ?? "?"}
    </span>
  );
}

/** Состав конкретного проекта — ленивая загрузка bootstrap на раскрытие.
 *  Добавление здесь НЕ открывает другие проекты отдела: выбор проекта + роли явный. */
function ProjectMembers({ projectId, allUsers }: { projectId: string; allUsers: SafeUser[] }) {
  const { setProjectMember, removeProjectMember } = useStore();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; members: { userId: string; role: ProjectRole }[]; users: SafeUser[] }
  >({ status: "loading" });
  const [addUser, setAddUser] = useState("");
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
    return <p className="border-t border-linesoft bg-canvas/30 px-3 py-2 text-[11px] text-faint">Загрузка состава…</p>;
  if (state.status === "error")
    return (
      <p className="border-t border-linesoft bg-canvas/30 px-3 py-2 text-[11px] text-danger">
        Не удалось загрузить состав.{" "}
        <button className="underline" onClick={load}>
          повторить
        </button>
      </p>
    );

  const roleByUser = new Map(state.members.map((m) => [m.userId, m.role]));
  const rows = state.members
    .map((m) => ({ m, u: state.users.find((x) => x.id === m.userId) }))
    .sort((a, b) => (a.u?.name ?? "").localeCompare(b.u?.name ?? "", "ru"));
  const candidates = allUsers
    .filter((u) => u.isActive && u.globalRole !== "admin" && !roleByUser.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    <div className="border-t border-linesoft bg-canvas/30 px-3 py-2.5">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">Состав проекта · {state.members.length}</p>

      <div className="space-y-1">
        {rows.map(({ m, u }) => (
          <div key={m.userId} className="flex items-center gap-2">
            <MiniAvatar user={u} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{u?.name ?? m.userId}</span>
            <select
              value={roleByUser.get(m.userId)}
              disabled={busy}
              onChange={(e) => run(setProjectMember(projectId, m.userId, e.target.value as ProjectRole))}
              className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] font-semibold text-sub focus:border-accent focus:outline-none disabled:opacity-50"
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleMeta(r).name}
                </option>
              ))}
            </select>
            <button
              disabled={busy}
              onClick={() => run(removeProjectMember(projectId, m.userId))}
              className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10.5px] font-semibold text-sub transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
            >
              Убрать
            </button>
          </div>
        ))}
        {state.members.length === 0 && <p className="text-[11px] text-faint">Участников пока нет.</p>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={addUser}
          onChange={(e) => setAddUser(e.target.value)}
          disabled={busy || candidates.length === 0}
          className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-sub focus:border-accent focus:outline-none disabled:opacity-50"
        >
          <option value="">{candidates.length ? "— добавить человека —" : "нет кандидатов"}</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          value={addRole}
          onChange={(e) => setAddRole(e.target.value as ProjectRole)}
          disabled={busy}
          className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-semibold text-sub focus:border-accent focus:outline-none disabled:opacity-50"
        >
          {PROJECT_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleMeta(r).name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !addUser}
          onClick={() => {
            const uid = addUser;
            setAddUser("");
            run(setProjectMember(projectId, uid, addRole));
          }}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Добавить
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
        Добавление в этот проект не открывает остальные проекты отдела. «Наблюдатель» — только просмотр.
      </p>
    </div>
  );
}

export default function AdminView() {
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
  const [allUsers, setAllUsers] = useState<SafeUser[]>([]);
  useEffect(() => {
    if (!canManage) return;
    usersApi.list().then(setAllUsers).catch(() => {});
  }, [canManage]);

  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <IcLock size={15} /> Раздел доступен только администратору ресурса.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[900px] min-[1536px]:max-w-[1120px] min-[1920px]:max-w-[1360px] px-6 py-5">
        <div className="anim-fadeup flex items-start justify-between gap-3">
          <div>
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Департаменты и проекты</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              Отдел = группа проектов. Проект по умолчанию виден участникам своего отдела; «общий» — видят все.
              {ldap && " В режиме LDAP членство в отделе приходит из группы AD."}
            </p>
          </div>
          {ldap && (
            <button
              onClick={resyncLdap}
              title="Пересобрать членство в отделах из групп LDAP для всех LDAP-пользователей"
              className="shrink-0 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent"
            >
              Пересинхронизировать LDAP
            </button>
          )}
        </div>

        {/* новый отдел */}
        <div className="anim-fadeup mt-4 flex items-center gap-2 rounded-xl border border-line bg-panel p-3 shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
          <input
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newDept.trim() && (createDepartment(newDept.trim()), setNewDept(""))}
            placeholder="Название нового отдела"
            maxLength={LIMITS.department.name.max}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12.5px] focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => {
              createDepartment(newDept.trim());
              setNewDept("");
            }}
            disabled={!newDept.trim()}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <IcPlus size={13} /> Отдел
          </button>
        </div>

        {/* список отделов */}
        <div className="anim-fadeup mt-4 space-y-3" style={{ animationDelay: "60ms" }}>
          {data.departments.map((d) => {
            const projs = byDept[d.id] ?? [];
            const f = form(d.id);
            return (
              <section key={d.id} className="rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
                <header className="flex items-center gap-2 border-b border-linesoft bg-canvas/50 px-3 py-2">
                  <IcInbox size={15} className="shrink-0 text-accent" />
                  <EditableName value={d.name} onSave={(v) => renameDepartment(d.id, v)} maxLength={LIMITS.department.name.max} />
                  <span className="shrink-0 text-[11px] text-faint">{projs.length} проект(ов)</span>
                  <button
                    onClick={() =>
                      projs.length === 0 &&
                      window.confirm(`Удалить отдел «${d.name}»?`) &&
                      deleteDepartment(d.id)
                    }
                    disabled={projs.length > 0}
                    title={projs.length > 0 ? "Сначала удалите или перенесите проекты" : "Удалить отдел"}
                    className="shrink-0 rounded-md border border-line bg-panel p-1.5 text-sub transition-colors hover:border-danger hover:text-danger disabled:opacity-30 disabled:hover:border-line disabled:hover:text-sub"
                  >
                    <IcTrash size={13} />
                  </button>
                </header>

                {ldap && (
                  <div className="flex items-center gap-2 border-b border-linesoft bg-canvas/30 px-3 py-1.5">
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-faint">LDAP-группа</span>
                    <input
                      key={d.ldapGroupDn ?? ""}
                      defaultValue={d.ldapGroupDn ?? ""}
                      placeholder="DN группы AD, напр. cn=dept-ib,ou=groups,dc=corp,dc=example,dc=com"
                      maxLength={LIMITS.department.ldapGroupDn.max}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (d.ldapGroupDn ?? "")) setDepartmentLdapGroup(d.id, v || null);
                      }}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-sub hover:border-linesoft focus:border-accent focus:bg-panel focus:outline-none"
                    />
                  </div>
                )}

                <div className="divide-y divide-linesoft">
                  {projs.map((p) => (
                    <div key={p.id}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="w-16 shrink-0 rounded bg-linesoft px-1.5 py-0.5 text-center font-mono text-[10.5px] font-bold text-sub">
                          {p.key}
                        </span>
                        <EditableName value={p.name} onSave={(v) => patchProject(p.id, { name: v })} maxLength={LIMITS.project.name.max} />
                        <label className="flex shrink-0 items-center gap-1 text-[11px] text-sub">
                          <input
                            type="checkbox"
                            checked={p.isShared}
                            onChange={(e) => patchProject(p.id, { isShared: e.target.checked })}
                          />
                          общий
                        </label>
                        <button
                          onClick={() => setOpenMembers((s) => ({ ...s, [p.id]: !s[p.id] }))}
                          className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent"
                        >
                          {openMembers[p.id] ? <IcChevD size={12} /> : <IcChevR size={12} />}
                          <IcUsers size={12} /> Состав
                        </button>
                        <button
                          onClick={() => switchProject(p.id)}
                          disabled={p.id === data.currentProjectId}
                          className="shrink-0 rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                        >
                          {p.id === data.currentProjectId ? "открыт" : "Открыть"}
                        </button>
                        <button
                          onClick={() =>
                            window.confirm(`Удалить проект ${p.key} со всеми задачами? Действие необратимо.`) &&
                            deleteProject(p.id)
                          }
                          className="shrink-0 rounded-md border border-line bg-panel p-1.5 text-sub transition-colors hover:border-danger hover:text-danger"
                        >
                          <IcTrash size={13} />
                        </button>
                      </div>
                      {openMembers[p.id] && <ProjectMembers projectId={p.id} allUsers={allUsers} />}
                    </div>
                  ))}

                  {/* новый проект в этом отделе */}
                  <div className="flex flex-wrap items-center gap-2 bg-canvas/40 px-3 py-2">
                    <input
                      value={f.key}
                      onChange={(e) => setForm(d.id, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                      placeholder="КЛЮЧ"
                      maxLength={10}
                      className="w-20 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px] uppercase focus:border-accent focus:outline-none"
                    />
                    <input
                      value={f.name}
                      onChange={(e) => setForm(d.id, { name: e.target.value })}
                      placeholder="Название проекта"
                      maxLength={LIMITS.project.name.max}
                      className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] focus:border-accent focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        if (!KEY_RE.test(f.key) || !f.name.trim()) return;
                        createProject({ key: f.key, name: f.name.trim(), departmentId: d.id });
                        setForm(d.id, { key: "", name: "" });
                      }}
                      disabled={!KEY_RE.test(f.key) || !f.name.trim()}
                      className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      <IcPlus size={12} /> Проект
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
          {data.departments.length === 0 && (
            <p className="rounded-xl border border-dashed border-line bg-panel px-4 py-6 text-center text-[12px] text-faint">
              Отделов пока нет — создайте первый выше.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
