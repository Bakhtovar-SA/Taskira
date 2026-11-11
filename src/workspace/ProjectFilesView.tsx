import { useState } from "react";
import { useLocation } from "wouter";
import type {
  ProjectFile,
  ProjectFilesQuery,
} from "../../server/src/workspaceContract";
import { useStore } from "../store";
import { IcDownload } from "../icons";
import { projectFilesCopy } from "../i18n/workspace";
import { workspaceApi } from "./api";
import { useAction, useResource } from "./hooks";
import {
  Frame,
  Input,
  Select,
  Button,
  ErrorNotice,
  Empty,
  Loading,
  ModuleBanner,
  useWorkspace,
} from "./shared";
import "./workspace.css";

export default function ProjectFilesView() {
  const { projectId, data, c, lang } = useWorkspace(),
    copy = projectFilesCopy(lang),
    { openIssue } = useStore();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState(""),
    [source, setSource] = useState<ProjectFilesQuery["source"]>("all"),
    [sort, setSort] = useState<ProjectFilesQuery["sort"]>("newest"),
    [offset, setOffset] = useState(0);
  const limit = 50;
  const files = useResource(
    (signal) =>
      workspaceApi.projectFiles(
        projectId,
        { q: search, source, sort, offset, limit },
        signal,
      ),
    [projectId, search, source, sort, offset],
  );
  const action = useAction();
  const size = (bytes: number) => {
    const units = copy.units.split("|"),
      index = Math.min(
        3,
        Math.max(0, Math.floor(Math.log(bytes || 1) / Math.log(1024))),
      );
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
  };
  const openSource = (file: ProjectFile) => {
    if (file.source.kind === "issue") openIssue(file.source.id, "page");
    else
      navigate(
        `/p/${encodeURIComponent(data.project.key)}/documents?document=${file.source.id}`,
      );
  };
  return (
    <Frame
      title={copy.title}
      hint={copy.hint}
      actions={
        <Button onClick={files.reload} disabled={files.loading}>
          {copy.refresh}
        </Button>
      }
    >
      <ModuleBanner module="files" />
      <div className="workspace-file-filters">
        <Input
          label={c.search}
          placeholder={copy.searchHint}
          maxLength={200}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <div className="ds-field">
          <span className="ds-label">{copy.source}</span>
          <Select
            aria-label={copy.source}
            value={source}
            onChange={(v) => {
              setSource(v);
              setOffset(0);
            }}
            options={[
              { value: "all", label: copy.all },
              { value: "issue", label: copy.tasks },
              { value: "document", label: copy.documents },
            ]}
          />
        </div>
        <div className="ds-field">
          <span className="ds-label">{c.sort}</span>
          <Select
            aria-label={c.sort}
            value={sort}
            onChange={(v) => {
              setSort(v);
              setOffset(0);
            }}
            options={[
              { value: "newest", label: copy.newest },
              { value: "oldest", label: copy.oldest },
              { value: "name", label: c.name },
              { value: "size", label: copy.size },
            ]}
          />
        </div>
      </div>
      <ErrorNotice message={files.error ?? action.error} />
      <p className="workspace-muted" role="status">
        {files.data
          ? `${copy.total}: ${files.data.total} · ${size(files.data.totalBytes)}`
          : c.loading}
      </p>
      {files.loading && !files.data ? (
        <Loading />
      ) : !files.data?.items.length ? (
        <Empty>
          {search || source !== "all" ? copy.noMatches : copy.empty}
        </Empty>
      ) : (
        <div className="workspace-table-wrap workspace-files-table">
          <table className="workspace-table">
            <caption className="sr-only">{copy.title}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.filename}</th>
                <th scope="col">{copy.source}</th>
                <th scope="col">{copy.size}</th>
                <th scope="col">{copy.uploaded}</th>
                <th scope="col">
                  <span className="sr-only">{c.download}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {files.data.items.map((file) => (
                <tr key={`${file.source.kind}:${file.id}`}>
                  <td>
                    <span
                      className="workspace-file-extension"
                      aria-hidden="true"
                    >
                      {file.filename.includes(".")
                        ? file.filename
                            .split(".")
                            .pop()
                            ?.slice(0, 8)
                            .toUpperCase()
                        : copy.file}
                    </span>
                    <button
                      className="workspace-text-link"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(() =>
                          workspaceApi.downloadProjectFile(projectId, file),
                        )
                      }
                    >
                      {file.filename}
                    </button>
                  </td>
                  <td>
                    <span className="workspace-file-origin">
                      {file.source.kind === "issue" ? c.issue : c.document}
                      {file.source.archived ? ` · ${c.archived}` : ""}
                    </span>
                    <button
                      className="workspace-text-link"
                      onClick={() => openSource(file)}
                    >
                      {file.source.key ? `${file.source.key} · ` : ""}
                      {file.source.title}
                    </button>
                  </td>
                  <td className="workspace-file-size" data-label={copy.size}>
                    {size(file.size)}
                  </td>
                  <td>
                    <time dateTime={file.createdAt}>
                      {new Date(file.createdAt).toLocaleDateString(lang)}
                    </time>
                    <p className="workspace-muted">
                      {file.uploaderName ?? copy.unknownAuthor}
                    </p>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${c.download}: ${file.filename}`}
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(() =>
                          workspaceApi.downloadProjectFile(projectId, file),
                        )
                      }
                    >
                      <IcDownload size={18} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {files.data && files.data.total > limit && (
        <nav
          className="workspace-actions workspace-pagination"
          aria-label={copy.pages}
        >
          <Button
            disabled={!offset || files.loading}
            onClick={() => setOffset((v) => Math.max(0, v - limit))}
          >
            {c.previous}
          </Button>
          <span>
            {Math.floor(offset / limit) + 1} /{" "}
            {Math.ceil(files.data.total / limit)}
          </span>
          <Button
            disabled={offset + limit >= files.data.total || files.loading}
            onClick={() => setOffset((v) => v + limit)}
          >
            {c.next}
          </Button>
        </nav>
      )}
      <p className="workspace-muted workspace-file-help">{copy.addHint}</p>
    </Frame>
  );
}
