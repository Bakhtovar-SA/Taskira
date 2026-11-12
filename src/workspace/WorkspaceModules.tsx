import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { MODULE_IDS, projectModulesCopy } from "../i18n/projectModules";
import { Button } from "../ds/Button";
import { Switch } from "../ds/Field";
import { workspaceApi } from "./api";
import { useAction, useResource } from "./hooks";
import { applicationsCopy } from "../i18n/applications";

export default function WorkspaceModules() {
  const { data, can, applications } = useStore(),
    { lang } = useT(),
    copy = projectModulesCopy(lang);
  const projectId = data.currentProjectId;
  const resource = useResource(
    (signal) => workspaceApi.modules(projectId, signal),
    [projectId, data.currentUserId],
  );
  const action = useAction(),
    [saved, setSaved] = useState(false);
  const editable = can("manageWorkspace");
  if (!resource.data)
    return (
      <div className="border-t border-linesoft px-5 py-4" role="status">
        {resource.error ? (
          <>
            <p role="alert" className="text-[13px] text-danger">
              {resource.error}
            </p>
            <Button size="sm" onClick={resource.reload}>
              {copy.retry}
            </Button>
          </>
        ) : (
          <p className="text-[13px] text-faint">{copy.loading}</p>
        )}
      </div>
    );
  return (
    <>
      {MODULE_IDS.map((key) => {
        const description = copy.modules[key];
        const owner = key === "documents" ? "knowledge" : key === "objects" ? "objects" : key === "files" ? null : "work";
        const appCopy = applicationsCopy(lang);
        const appDisabled = owner && applications?.applications.find((app) => app.id === owner)?.enabled === false;
        return (
          <div key={key} className="border-t border-linesoft px-5 py-4">
            <Switch
              labelFirst
              label={description.name}
              description={
                <>
                  {description.purpose}
                  <span className="mt-1 block">{description.example}</span>
                  {owner && <span className="mt-1 block text-sub">{appCopy.apps[owner].name}{appDisabled ? ` · ${appCopy.unavailable}` : ""}</span>}
                </>
              }
              checked={resource.data![key]}
              disabled={!editable || action.busy}
              onChange={(checked) => {
                if (!editable || action.busy) return;
                const previous = resource.data!,
                  next = { ...previous, [key]: checked };
                setSaved(false);
                resource.setData(next);
                void action.run(
                  async () => {
                    try {
                      return await workspaceApi.setModules(projectId, next);
                    } catch (error) {
                      resource.setData(previous);
                      throw error;
                    }
                  },
                  (result) => {
                    resource.setData(result);
                    setSaved(true);
                    window.dispatchEvent(
                      new Event("taskira:workspace-modules"),
                    );
                  },
                );
              }}
            />
          </div>
        );
      })}
      <div className="border-t border-linesoft px-5 py-4 text-[13px] leading-relaxed text-faint">
        <p className="mb-2">{copy.readOnly}</p>
        <p>{copy.disabled}</p>
        <p className="mt-2">{copy.filesDisabled}</p>
        <p className="mt-2" role="status" aria-live="polite">
          {action.busy
            ? copy.saving
            : action.error
              ? ""
              : saved
                ? copy.saved
                : ""}
        </p>
        {action.error && (
          <p role="alert" className="mt-2 text-danger">
            {action.error}
          </p>
        )}
      </div>
    </>
  );
}
