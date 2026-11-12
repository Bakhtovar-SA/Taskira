import { useState } from "react";
import { useLocation } from "wouter";
import { issuesApi } from "../api";
import { useStore } from "../store";
import { projectAvailable } from "../applications/navigation";
import { workspaceApi } from "./api";
import { useResource, useAction } from "./hooks";
import {
  Frame,
  useWorkspace,
  Input,
  Select,
  Empty,
  Loading,
  ErrorNotice,
  materialPath,
} from "./shared";
import "./workspace.css";
export default function LibraryView() {
  const { c, data } = useWorkspace();
  const { application = "work", applications } = useStore();
  const fixedKind = application === "knowledge" ? "document" : application === "objects" ? "object" : null;
  const projects = data.projects.filter((p) => projectAvailable(application, p.id, applications));
  const [search, setSearch] = useState(""),
    [chosenKind, setKind] = useState("all"),
    [project, setProject] = useState("all");
  const kind = fixedKind ?? chosenKind;
  const [, navigate] = useLocation();
  const a = useAction();
  const r = useResource(
    (s) =>
      workspaceApi.library(search, s, {
        projectId: project === "all" ? undefined : project,
        kind:
          kind === "all"
            ? undefined
            : (kind as "issue" | "document" | "object" | "process"),
      }),
    [search, project, kind],
  );
  const items =
    r.data?.items.filter(
      (i) =>
        (kind === "all" || i.ref.kind === kind) &&
        (project === "all" || i.projectId === project) && projects.some((p) => p.id === i.projectId),
    ) ?? [];
  return (
    <Frame title={c.library} hint={c.libraryHint}>
      <div className="workspace-actions">
        <Input
          label={c.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!fixedKind && <Select
          aria-label={c.materialKind}
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: c.all },
            ...(["document", "object", "process", "issue"] as const).map(
              (v) => ({ value: v, label: c[v] }),
            ),
          ]}
        />}
        <Select
          aria-label={c.type}
          value={project}
          onChange={setProject}
          options={[
            { value: "all", label: c.all },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>
      <ErrorNotice message={r.error ?? a.error} />
      {r.loading && !r.data ? (
        <Loading />
      ) : !items.length ? (
        <Empty />
      ) : (
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th scope="col">{c.title}</th>
                <th scope="col">{c.materialKind}</th>
                <th scope="col">{c.type}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.ref.kind}:${i.ref.id}`}>
                  <td>
                    <button
                      className="workspace-text-link"
                      onClick={() => {
                        if (i.ref.kind === "issue")
                          void a.run(
                            () => issuesApi.get(i.projectId, i.ref.id),
                            (issue) =>
                              navigate(
                                `/p/${encodeURIComponent(i.projectKey)}/issue/${encodeURIComponent(issue.key)}`,
                              ),
                          );
                        else navigate(materialPath(i));
                      }}
                    >
                      {i.title}
                    </button>
                    <p className="workspace-muted">{i.text.slice(0, 180)}</p>
                  </td>
                  <td>{c[i.ref.kind]}</td>
                  <td>{i.projectName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.data?.truncated && <p className="workspace-muted">{c.truncated}</p>}
    </Frame>
  );
}
