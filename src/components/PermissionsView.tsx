import { useMemo, useState } from "react";
import { useStore } from "../store";
import { PERMISSIONS, ROLE_ORDER, resolveRole, roleHas, roleMeta } from "../permissions";
import type { AccessRole, ProjectRole } from "../types";
import { IcCheck, IcEye, IcShield, IcUsers, IcX } from "../icons";
import { Avatar, RoleBadge, roleBadgeColors } from "../ui";

const PROJECT_ROLES: ProjectRole[] = ["manager", "employee", "viewer"];

export default function PermissionsView() {
  const { data, me, can, switchUser, setMemberRole, removeMember } = useStore();
  const meta = roleMeta(me.accessRole);
  const canManage = can("manageAccess");

  /** Эффективная роль пользователя в проекте (или null — не участник и не админ). */
  const effRole = (userId: string): AccessRole | null => {
    const u = data.users.find((x) => x.id === userId);
    return u ? resolveRole(u.globalRole, data.members[userId]) : (data.members[userId] ?? null);
  };

  const memberIds = useMemo(
    () =>
      Object.keys(data.members).sort((a, b) => {
        const na = data.users.find((u) => u.id === a)?.name ?? "";
        const nb = data.users.find((u) => u.id === b)?.name ?? "";
        return na.localeCompare(nb, "ru");
      }),
    [data.members, data.users],
  );

  const globalAdmins = useMemo(
    () => data.users.filter((u) => u.globalRole === "admin"),
    [data.users],
  );

  const nonMembers = useMemo(
    () => data.users.filter((u) => u.globalRole !== "admin" && !(u.id in data.members)),
    [data.users, data.members],
  );

  const counts = useMemo(() => {
    const byRole: Record<AccessRole, number> = { admin: globalAdmins.length, manager: 0, employee: 0, viewer: 0 };
    for (const r of Object.values(data.members)) byRole[r] += 1;
    return ROLE_ORDER.map((r) => ({ role: r, n: byRole[r] }));
  }, [data.members, globalAdmins.length]);

  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("employee");
  const doAdd = () => {
    if (!addUser) return;
    setMemberRole(addUser, addRole);
    setAddUser("");
    setAddRole("employee");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] px-6 py-5">
        <div className="anim-fadeup">
          <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Права доступа</h1>
          <p className="mt-0.5 text-[11.5px] text-faint">
            Проект {data.project.key}: роль назначается участнику проекта, глобальный администратор ресурса имеет полный доступ. Проверки — и в интерфейсе, и на сервере.
          </p>
        </div>

        {/* текущий пользователь + переключение */}
        <div className="anim-fadeup mt-4 grid gap-4 lg:grid-cols-[340px_1fr]" style={{ animationDelay: "50ms" }}>
          <div className="rounded-xl border border-line bg-panel p-4 shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
            <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-sub">
              <IcShield size={14} className="text-accent" /> Текущая сессия
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Avatar user={me} size={44} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold text-ink">{me.name}</p>
                <p className="text-[11.5px] text-faint">{me.role} · {data.project.name}</p>
                <div className="mt-1"><RoleBadge role={me.accessRole} size="sm" /></div>
              </div>
            </div>
            <p className="mt-3 rounded-md bg-canvas/80 p-2.5 text-[11.5px] leading-relaxed text-sub">{meta.desc}</p>
            <p className="mt-3 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
              <IcUsers size={12} /> Просмотр интерфейса от лица другой роли
            </p>
            <div className="mt-2 space-y-1.5">
              {data.users.filter((u) => u.id !== me.id).map((u) => {
                const r = effRole(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => switchUser(u.id)}
                    className="flex w-full items-center gap-2.5 rounded-md border border-linesoft bg-white px-2.5 py-1.5 text-left transition-all hover:border-accent hover:shadow-[0_2px_10px_rgba(11,95,217,0.12)]"
                  >
                    <Avatar user={u} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">{u.name}</span>
                    </span>
                    {r ? <RoleBadge role={r} size="sm" /> : <span className="text-[10px] text-faint">не в проекте</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-faint">
              Дев-инструмент (только localhost): подменяет роль в интерфейсе. Запросы к API идут под вашим входом — для настоящей проверки серверных прав входите под нужным пользователем.
            </p>
          </div>

          {/* состав проекта */}
          <div className="rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
            <p className="border-b border-linesoft bg-canvas/60 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-sub">
              Участники проекта · {memberIds.length}
              {canManage && <span className="ml-2 font-medium normal-case text-faint">— вы можете менять состав</span>}
            </p>
            <div className="divide-y divide-linesoft">
              {memberIds.map((id) => {
                const u = data.users.find((x) => x.id === id);
                const role = data.members[id];
                const mine = id === me.id;
                return (
                  <div key={id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${mine ? "bg-accentsoft/50" : "hover:bg-canvas/50"}`}>
                    <Avatar user={u ?? { id, name: "?", initials: "?", color: "#94a3b8", role: "", globalRole: "member", accessRole: "viewer" }} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        {u?.name ?? id}
                        {mine && <span className="rounded bg-accent px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-white">вы</span>}
                        {u?.globalRole === "admin" && <span className="rounded bg-[#B42318] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-white">админ ресурса</span>}
                      </p>
                      {u?.role && <p className="text-[11px] text-faint">{u.role}</p>}
                    </div>
                    {canManage ? (
                      <select
                        value={role}
                        onChange={(e) => setMemberRole(id, e.target.value as ProjectRole)}
                        className="rounded-md border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-sub focus:border-accent focus:outline-none"
                      >
                        {PROJECT_ROLES.map((r) => (
                          <option key={r} value={r}>{roleMeta(r).name}</option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={role} size="sm" />
                    )}
                    {canManage && (
                      <button
                        onClick={() => removeMember(id)}
                        className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-[#B42318] hover:text-[#B42318]"
                      >
                        Убрать
                      </button>
                    )}
                  </div>
                );
              })}
              {memberIds.length === 0 && (
                <p className="px-4 py-3 text-[11.5px] text-faint">В проекте пока нет участников.</p>
              )}
            </div>

            {canManage && nonMembers.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-linesoft bg-canvas/40 px-4 py-2.5">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-faint">Добавить участника</span>
                <select
                  value={addUser}
                  onChange={(e) => setAddUser(e.target.value)}
                  className="rounded-md border border-line bg-white px-2 py-1 text-[11.5px] text-sub focus:border-accent focus:outline-none"
                >
                  <option value="">— выберите —</option>
                  {nonMembers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as ProjectRole)}
                  className="rounded-md border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-sub focus:border-accent focus:outline-none"
                >
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>{roleMeta(r).name}</option>
                  ))}
                </select>
                <button
                  onClick={doAdd}
                  disabled={!addUser}
                  className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Добавить
                </button>
              </div>
            )}

            {globalAdmins.length > 0 && (
              <div className="border-t border-linesoft px-4 py-2.5">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-faint">Администраторы ресурса</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                  Полный доступ во всех проектах, не входят в состав. {globalAdmins.map((u) => u.name).join(", ")}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-linesoft px-4 py-2.5">
              {counts.map(({ role, n }) => (
                <span key={role} className="flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-semibold text-sub">
                  <span className="h-2 w-2 rounded-full" style={{ background: roleBadgeColors[role] }} />
                  {roleMeta(role).name}: {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* матрица разрешений */}
        <div className="anim-fadeup mt-4 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]" style={{ animationDelay: "110ms" }}>
          <p className="border-b border-linesoft bg-canvas/60 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-sub">
            Матрица разрешений · {PERMISSIONS.length} прав × {ROLE_ORDER.length} роли
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-canvas/40">
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-faint">Разрешение</th>
                  <th className="w-20 px-2 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-faint">Область</th>
                  {ROLE_ORDER.map((r) => (
                    <th key={r} className={`w-[110px] px-2 py-2.5 text-center ${me.accessRole === r ? "bg-accentsoft/70" : ""}`}>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: roleMeta(r).color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleMeta(r).color }} />
                        {roleMeta(r).name.split(" ")[0]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p.id} className="border-b border-linesoft transition-colors last:border-0 hover:bg-canvas/50">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink">{p.name}</p>
                      <p className="mt-0.5 max-w-[440px] text-[11px] leading-snug text-faint">{p.desc}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="rounded bg-[#e8edf4] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sub">{p.scope}</span>
                    </td>
                    {ROLE_ORDER.map((r) => {
                      const ok = roleHas(r, p.id);
                      const ownCol = me.accessRole === r;
                      return (
                        <td key={r} className={`px-2 py-2.5 text-center ${ownCol ? "bg-accentsoft/40" : ""}`}>
                          {ok ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-oksoft text-ok"><IcCheck size={11} /></span>
                          ) : (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#eef1f6] text-[#a4b0c2]"><IcX size={10} /></span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-linesoft bg-canvas/40 px-4 py-2.5 text-[11px] text-faint">
            * «Редактирование задач» для Сотрудника сужается на уровне задачи: доступны только задачи, где он исполнитель или автор. «Управление доступом» и «Изменение workflow» — только у администратора ресурса. Подсветка колонки — ваша текущая роль.
          </p>
        </div>

        {/* как это работает */}
        <div className="anim-fadeup mt-4 grid gap-4 pb-8 md:grid-cols-3" style={{ animationDelay: "170ms" }}>
          {[
            { t: "Проверка на сервере", d: "Каждая мутация проходит через requirePerm() в API: роль резолвится по членству в проекте (project_members) либо по глобальной роли admin.", i: <IcShield size={16} /> },
            { t: "Блокировка интерфейса", d: "Клиент дублирует проверку для мгновенной обратной связи: недоступные роли кнопки скрыты или показаны с замком и подсказкой.", i: <IcEye size={16} /> },
            { t: "Схема workflow поверх прав", d: "Даже администратор не перетащит задачу против схемы переходов: права и workflow проверяются независимо друг от друга.", i: <IcCheck size={16} /> },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-line bg-panel p-4 shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accentsoft text-accent">{c.i}</span>
              <p className="mt-2.5 text-[13px] font-bold text-ink">{c.t}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-sub">{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
