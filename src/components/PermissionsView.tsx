import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { ApiError, usersApi } from "../api";
import { PERMISSIONS, ROLE_ORDER, roleHas, roleMeta } from "../permissions";
import type { AccessRole, ProjectRole } from "../types";
import { IcCheck, IcEye, IcShield, IcX } from "../icons";
import { Avatar, RoleBadge, roleBadgeColors } from "../ui";
import { useT } from "../i18n";

const PROJECT_ROLES: ProjectRole[] = ["manager", "employee", "viewer"];

export default function PermissionsView() {
  const { t, lang } = useT();
  const { data, me, can, setMemberRole, removeMember } = useStore();
  const canManage = can("manageAccess");

  const memberIds = useMemo(
    () =>
      Object.keys(data.members).sort((a, b) => {
        const na = data.users.find((u) => u.id === a)?.name ?? "";
        const nb = data.users.find((u) => u.id === b)?.name ?? "";
        return na.localeCompare(nb, lang === "ru" ? "ru" : "en");
      }),
    [data.members, data.users, lang],
  );

  const globalAdmins = useMemo(
    () => data.users.filter((u) => u.globalRole === "admin"),
    [data.users],
  );

  // Полный список пользователей ресурса (для «добавить участника») — только у
  // админа ресурса; в bootstrap приходят лишь участники проекта.
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; globalRole: string }[]>([]);
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    usersApi
      .list()
      .then((us) => {
        if (!cancelled) setAllUsers(us.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name, globalRole: u.globalRole })));
      })
      .catch((e) => {
        if (!(e instanceof ApiError)) throw e;
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const nonMembers = useMemo(
    () => allUsers.filter((u) => u.globalRole !== "admin" && !(u.id in data.members)),
    [allUsers, data.members],
  );

  const counts = useMemo(() => {
    const byRole: Record<AccessRole, number> = { admin: globalAdmins.length, manager: 0, employee: 0, viewer: 0 };
    for (const r of Object.values(data.members)) byRole[r] += 1;
    return ROLE_ORDER.map((r) => ({ role: r, n: byRole[r] }));
  }, [data.members, globalAdmins.length]);

  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("employee");
  const roleName = (role: AccessRole) => t(`role.${role}.name`);
  const doAdd = () => {
    if (!addUser) return;
    setMemberRole(addUser, addRole);
    setAddUser("");
    setAddRole("employee");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] min-[1536px]:max-w-[1320px] min-[1920px]:max-w-[1600px] px-6 py-5">
        <div className="anim-fadeup">
          <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t("access.title")}</h1>
          <p className="mt-0.5 text-[11.5px] text-faint">
            {t("access.subtitle", { key: data.project.key })}
          </p>
        </div>

        {/* текущий пользователь + переключение */}
        <div className="anim-fadeup mt-4 grid gap-4 lg:grid-cols-[340px_1fr]" style={{ animationDelay: "50ms" }}>
          <div className="surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-sub">
              <IcShield size={14} className="text-accent" /> {t("access.currentSession")}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Avatar user={me} size={44} interactive />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">{me.name}</p>
                <p className="text-[11.5px] text-faint">{me.role} · {data.project.name}</p>
                <div className="mt-1"><RoleBadge role={me.accessRole} size="sm" /></div>
              </div>
            </div>
            <p className="mt-3 rounded-md bg-sunken p-2.5 text-[11.5px] leading-relaxed text-sub">{t(`role.${me.accessRole}.desc`)}</p>
          </div>

          {/* состав проекта */}
          <div className="surface-raised rounded-xl ring-1 ring-inset ring-line/70">
            <p className="border-b border-linesoft bg-sunken px-4 py-2.5 text-[13px] font-medium text-sub">
              {t("access.membersCount", { count: memberIds.length })}
              {canManage && <span className="ml-2 font-medium normal-case text-faint">{t("access.canManage")}</span>}
            </p>
            <div className="divide-y divide-linesoft">
              {memberIds.map((id) => {
                const u = data.users.find((x) => x.id === id);
                const role = data.members[id];
                const mine = id === me.id;
                return (
                  <div key={id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${mine ? "bg-accentsoft/50" : "hover:bg-hover"}`}>
                    <Avatar user={u ?? { name: "?", initials: "?", color: "var(--gray-9)" }} size={30} interactive />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        {u?.name ?? id}
                        {mine && <span className="rounded bg-accent px-1.5 py-px text-[11px] font-medium text-onaccent">{t("access.you")}</span>}
                        {u?.globalRole === "admin" && <span className="rounded bg-danger px-1.5 py-px text-[11px] font-medium text-onaccent">{t("access.resourceAdmin")}</span>}
                      </p>
                      {u?.role && <p className="text-[11px] text-faint">{u.role}</p>}
                    </div>
                    {canManage ? (
                      <select
                        value={role}
                        onChange={(e) => setMemberRole(id, e.target.value as ProjectRole)}
                        className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] font-semibold text-sub focus:border-accent focus:shadow-focus focus:outline-none"
                      >
                        {PROJECT_ROLES.map((r) => (
                          <option key={r} value={r}>{roleName(r)}</option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={role} size="sm" />
                    )}
                    {canManage && (
                      <button
                        onClick={() => removeMember(id)}
                        className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-danger hover:text-danger"
                      >
                        {t("access.remove")}
                      </button>
                    )}
                  </div>
                );
              })}
              {memberIds.length === 0 && (
                <p className="px-4 py-3 text-[11.5px] text-faint">{t("access.noMembers")}</p>
              )}
            </div>

            {canManage && nonMembers.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-linesoft bg-sunken px-4 py-2.5">
                <span className="text-[12px] font-medium text-faint">{t("access.addMember")}</span>
                <select
                  value={addUser}
                  onChange={(e) => setAddUser(e.target.value)}
                  className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-sub focus:border-accent focus:shadow-focus focus:outline-none"
                >
                  <option value="">{t("access.select")}</option>
                  {nonMembers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as ProjectRole)}
                  className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] font-semibold text-sub focus:border-accent focus:shadow-focus focus:outline-none"
                >
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>{roleName(r)}</option>
                  ))}
                </select>
                <button
                  onClick={doAdd}
                  disabled={!addUser}
                  className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-onaccent transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {t("common.create")}
                </button>
              </div>
            )}

            {globalAdmins.length > 0 && (
              <div className="border-t border-linesoft px-4 py-2.5">
                <p className="text-[12px] font-medium text-faint">{t("access.resourceAdmins")}</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                  {t("access.resourceAdminsHint")} {globalAdmins.map((u) => u.name).join(", ")}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-linesoft px-4 py-2.5">
              {counts.map(({ role, n }) => (
                <span key={role} className="flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-semibold text-sub">
                  <span className="h-2 w-2 rounded-full" style={{ background: roleBadgeColors[role] }} />
                  {roleName(role)}: {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* матрица разрешений */}
        <div className="anim-fadeup mt-4 overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70" style={{ animationDelay: "110ms" }}>
          <p className="border-b border-linesoft bg-sunken px-4 py-2.5 text-[13px] font-medium text-sub">
            {t("access.matrix", { permissions: PERMISSIONS.length, roles: ROLE_ORDER.length })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-sunken">
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-faint">{t("access.permission")}</th>
                  <th className="w-20 px-2 py-2.5 text-left text-[12px] font-medium text-faint">{t("access.scope")}</th>
                  {ROLE_ORDER.map((r) => (
                    <th key={r} className={`w-[110px] px-2 py-2.5 text-center ${me.accessRole === r ? "bg-accentsoft/70" : ""}`}>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: roleMeta(r).color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleMeta(r).color }} />
                        {roleName(r).split(" ")[0]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p.id} className="border-b border-linesoft transition-colors last:border-0 hover:bg-hover">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink">{t(`permission.${p.id}.name`)}</p>
                      <p className="mt-0.5 max-w-[440px] text-[11px] leading-snug text-faint">{t(`permission.${p.id}.desc`)}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="rounded bg-linesoft px-1.5 py-0.5 text-[11.5px] font-medium text-sub">{t(`scope.${p.scope}`)}</span>
                    </td>
                    {ROLE_ORDER.map((r) => {
                      const ok = roleHas(r, p.id);
                      const ownCol = me.accessRole === r;
                      return (
                        <td key={r} className={`px-2 py-2.5 text-center ${ownCol ? "bg-accentsoft/40" : ""}`}>
                          {ok ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-oksoft text-ok"><IcCheck size={11} /></span>
                          ) : (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-linesoft text-faint"><IcX size={10} /></span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-linesoft bg-sunken px-4 py-2.5 text-[11px] text-faint">
            {t("access.matrixHint")}
          </p>
        </div>

        {/* как это работает */}
        <div className="anim-fadeup mt-4 grid gap-4 pb-8 md:grid-cols-3" style={{ animationDelay: "170ms" }}>
          {[
            { t: t("access.card.server"), d: t("access.card.serverDesc"), i: <IcShield size={16} /> },
            { t: t("access.card.ui"), d: t("access.card.uiDesc"), i: <IcEye size={16} /> },
            { t: t("access.card.workflow"), d: t("access.card.workflowDesc"), i: <IcCheck size={16} /> },
          ].map((c) => (
            <div key={c.t} className="surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accentsoft text-accent">{c.i}</span>
              <p className="mt-2.5 text-[13px] font-semibold text-ink">{c.t}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-sub">{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
