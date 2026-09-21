/* Участники проекта, департаменты, проекты и LDAP-ресинк (админские действия): действия стора. Вынесено из
 * store.tsx без изменений поведения (ТЗ 2.3, шаг 3). `bootstrap` нужен deleteProject — приходит из провайдера. */
import { useCallback } from "react";
import type { ProjectRole } from "../types";
import { ldapApi, departmentsApi, membersApi, projectsApi } from "../api";
import { mapUser, readLastProject, writeLastProject } from "./mappers";
import type { StoreCtx } from "./ctx";

export function useOrgActions(
  { setData, dataRef, pid, toast, handleApiError, requirePerm, local }: StoreCtx,
  { bootstrap }: { bootstrap: () => Promise<void> },
) {
  const setMemberRole = useCallback(
    (userId: string, role: ProjectRole) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          const res = await membersApi.set(pid(), userId, role);
          setData((prev) => ({ ...prev, members: { ...prev.members, [res.userId]: res.role } }));
          toast("success", local("Роль участника обновлена", "Member role updated"));
        } catch (err) {
          handleApiError(err, local("Не удалось изменить роль участника", "Couldn't update the member role"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeMember = useCallback(
    (userId: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await membersApi.remove(pid(), userId);
          setData((prev) => {
            const members = { ...prev.members };
            delete members[userId];
            return { ...prev, members };
          });
          toast("info", local("Участник удалён из проекта", "Member removed from the project"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить участника", "Couldn't remove the member"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /** Пересобрать состав + профили ОТКРЫТОГО проекта из bootstrap. Оптимистичного
   *  патча data.members мало: только что добавленный участник отсутствует в
   *  data.users (bootstrap-состав = «участники ∪ глоб. админы»), из-за чего в
   *  PermissionsView он рендерится сырым UUID, а в пикере исполнителя его нет. */
  const syncCurrentMembers = useCallback(async (projectId: string) => {
    const boot = await projectsApi.get(projectId);
    const members: Record<string, ProjectRole> = {};
    for (const m of boot.members) members[m.userId] = m.role;
    setData((prev) =>
      prev.currentProjectId === projectId
        ? { ...prev, members, users: boot.users.map((u) => mapUser(u, members)) }
        : prev,
    );
  }, []);

  /** Изменить/добавить участника ЛЮБОГО проекта (не только текущего) — из AdminView.
   *  Сервер разрешает это глобальному admin для любого проекта. Если правится
   *  открытый проект — ресинк data.members + data.users, чтобы me/PermissionsView/
   *  пикер исполнителя не отстали. */
  const setProjectMember = useCallback(
    async (projectId: string, userId: string, role: ProjectRole): Promise<void> => {
      if (!requirePerm("manageAccess")) return;
      try {
        await membersApi.set(projectId, userId, role);
        if (projectId === dataRef.current.currentProjectId) await syncCurrentMembers(projectId);
        toast("success", local("Роль участника обновлена", "Member role updated"));
      } catch (err) {
        handleApiError(err, local("Не удалось изменить участника проекта", "Couldn't update the project member"));
        throw err;
      }
    },
    [requirePerm, toast, handleApiError, syncCurrentMembers],
  );

  const removeProjectMember = useCallback(
    async (projectId: string, userId: string): Promise<void> => {
      if (!requirePerm("manageAccess")) return;
      try {
        await membersApi.remove(projectId, userId);
        if (projectId === dataRef.current.currentProjectId) await syncCurrentMembers(projectId);
        toast("info", local("Участник удалён из проекта", "Member removed from the project"));
      } catch (err) {
        handleApiError(err, local("Не удалось удалить участника проекта", "Couldn't remove the project member"));
        throw err;
      }
    },
    [requirePerm, toast, handleApiError, syncCurrentMembers],
  );

  /* -------- админ: департаменты и проекты (manageAccess = глобальный admin) -------- */

  /** Перезагрузка списков проектов и департаментов после мутаций оргструктуры. */
  const refreshOrg = useCallback(async () => {
    const [list, deps] = await Promise.all([projectsApi.list(), departmentsApi.list().catch(() => [])]);
    setData((prev) => ({
      ...prev,
      projects: list.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        departmentId: p.departmentId,
        isShared: p.isShared,
        sprintsEnabled: p.sprintsEnabled,
      })),
      departments: deps,
    }));
  }, []);

  const createDepartment = useCallback(
    (name: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.create(name);
          await refreshOrg();
          toast("success", local(`Отдел «${name}» создан`, `Department “${name}” created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать отдел", "Couldn't create the department"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const renameDepartment = useCallback(
    (id: string, name: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.patch(id, { name });
          await refreshOrg();
        } catch (err) {
          handleApiError(err, local("Не удалось переименовать отдел", "Couldn't rename the department"));
        }
      })();
    },
    [requirePerm, handleApiError, refreshOrg],
  );

  /** Привязать/очистить LDAP-группу отдела (только AUTH_MODE=ldap). */
  const setDepartmentLdapGroup = useCallback(
    (id: string, ldapGroupDn: string | null) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.patch(id, { ldapGroupDn });
          await refreshOrg();
          toast("success", ldapGroupDn ? local("LDAP-группа привязана", "LDAP group linked") : local("Привязка LDAP-группы снята", "LDAP group unlinked"));
        } catch (err) {
          handleApiError(err, local("Не удалось сохранить LDAP-группу", "Couldn't save the LDAP group"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  /** Ручной ресинк членства в департаментах из LDAP (до фонового воркера). */
  const resyncLdap = useCallback(() => {
    if (!requirePerm("manageAccess")) return;
    void (async () => {
      try {
        const r = await ldapApi.resync();
        const ruTail =
          (r.notFound.length ? ` · не найдено в LDAP: ${r.notFound.length}` : "") +
          (r.errors.length ? ` · ошибок: ${r.errors.length}` : "");
        const enTail =
          (r.notFound.length ? ` · not found in LDAP: ${r.notFound.length}` : "") +
          (r.errors.length ? ` · errors: ${r.errors.length}` : "");
        toast(r.errors.length ? "error" : "success", local(`Ресинк: ${r.synced}/${r.total}${ruTail}`, `Resync: ${r.synced}/${r.total}${enTail}`));
      } catch (err) {
        handleApiError(err, local("Ресинк LDAP не удался", "LDAP resync failed"));
      }
    })();
  }, [requirePerm, toast, handleApiError]);

  const deleteDepartment = useCallback(
    (id: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.remove(id);
          await refreshOrg();
          toast("info", local("Отдел удалён", "Department deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить отдел", "Couldn't delete the department"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const createProject = useCallback(
    (input: { key: string; name: string; departmentId: string; isShared?: boolean; sprintsEnabled?: boolean }) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          const p = await projectsApi.create(input);
          await refreshOrg();
          toast("success", local(`Проект ${p.key} создан`, `Project ${p.key} created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать проект", "Couldn't create the project"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const patchProject = useCallback(
    (
      id: string,
      patch: { name?: string; description?: string; departmentId?: string; isShared?: boolean; sprintsEnabled?: boolean },
    ) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await projectsApi.patch(id, patch);
          await refreshOrg();
          // открытый проект: патчим все переданные поля (name/description/isShared/…),
          // иначе шапка/бейдж покажут устаревшее до следующего switchProject/bootstrap
          if (id === dataRef.current.currentProjectId) {
            setData((prev) => ({ ...prev, project: { ...prev.project, ...patch } }));
          }
        } catch (err) {
          handleApiError(err, local("Не удалось изменить проект", "Couldn't update the project"));
        }
      })();
    },
    [requirePerm, handleApiError, refreshOrg],
  );

  const deleteProject = useCallback(
    (id: string) => {
      if (!requirePerm("manageAccess")) return;
      const wasCurrent = id === dataRef.current.currentProjectId;
      void (async () => {
        try {
          await projectsApi.remove(id);
          toast("info", local("Проект удалён", "Project deleted"));
          if (wasCurrent) {
            if (readLastProject() === id) writeLastProject("");
            await bootstrap();
          } else {
            await refreshOrg();
          }
        } catch (err) {
          handleApiError(err, local("Не удалось удалить проект", "Couldn't delete the project"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg, bootstrap],
  );

  return {
    setMemberRole,
    removeMember,
    setProjectMember,
    removeProjectMember,
    createDepartment,
    renameDepartment,
    setDepartmentLdapGroup,
    resyncLdap,
    deleteDepartment,
    createProject,
    patchProject,
    deleteProject,
  };
}
