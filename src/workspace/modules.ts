import { useEffect } from "react";
import { useStore } from "../store";
import { workspaceApi } from "./api";
import { useResource } from "./hooks";
import type { WorkspaceModules } from "../../server/src/workspaceContract";
export function useProjectModules() {
  const { data } = useStore();
  const r = useResource(
    (s) => workspaceApi.modules(data.currentProjectId, s),
    [data.currentProjectId, data.currentUserId],
  );
  useEffect(() => {
    window.addEventListener("taskira:workspace-modules", r.reload);
    return () =>
      window.removeEventListener("taskira:workspace-modules", r.reload);
  }, [r.reload]);
  return r.data;
}
export function isWorkspaceModule(
  view: string,
): view is keyof WorkspaceModules {
  return ["documents", "objects", "processes", "planning", "files"].includes(view);
}
