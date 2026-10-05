/** Открыть дом настроек сразу на первом разделе, доступном этому человеку (ТЗ 5.9) — чтобы ссылка
 *  «Настройки проекта» у сотрудника вела в «Процесс», а у администратора — в «Общее». */
import { useCallback } from "react";
import { useStore } from "../store";
import { firstSection } from "./access";
import { DEFAULT_SECTION, type SettingsHome } from "./sections";

export function useOpenSettings(): (home: SettingsHome) => void {
  const { me, data, setView, bootStatus, enterProject } = useStore();
  const isAdmin = me.globalRole === "admin";
  const hasProject = !!data.currentProjectId;
  return useCallback(
    (home: SettingsHome) => {
      setView(home, firstSection(home, { isAdmin, hasProject: hasProject || data.projects.length > 0 }) ?? DEFAULT_SECTION[home]);
      if (bootStatus === "home") enterProject(data.currentProjectId || data.projects[0]?.id);
    },
    [isAdmin, hasProject, setView, bootStatus, enterProject, data.currentProjectId, data.projects],
  );
}
