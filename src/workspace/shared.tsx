export { DateField, Disclosure, FileUpload } from "./controls";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Button } from "../ds/Button";
import { Input, Textarea, Checkbox } from "../ds/Field";
import { Select } from "../ds/Select";
import { Dialog } from "../ds/Dialog";
import { workspaceCopy } from "../i18n/workspace";
import { projectModulesCopy } from "../i18n/projectModules";
import { issuesApi } from "../api";
import { workspaceApi } from "./api";
import { useAction, useResource } from "./hooks";
import type {
  EntityRef,
  WorkspaceModules,
  LibraryItem,
  Conditions,
} from "../../server/src/workspaceContract";
export function useWorkspace() {
  const { data, can } = useStore();
  const { lang } = useT();
  return {
    data,
    c: workspaceCopy(lang),
    lang,
    projectId: data.currentProjectId,
    writeDocs: can("writeDocuments"),
    writeObjects: can("writeObjects"),
    manage: can("manageWorkspace"),
    manageProcesses: can("manageProcesses"),
    managePlans: can("managePlans"),
  };
}
export function ErrorNotice({ message }: { message?: string | null }) {
  return message ? (
    <p className="workspace-error" role="alert">
      {message}
    </p>
  ) : null;
}
export function Frame({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="workspace-page">
      <header className="workspace-page-header">
        <div>
          <h1>{title}</h1>
          {hint && <p>{hint}</p>}
        </div>
        <div className="workspace-actions">{actions}</div>
      </header>
      {children}
    </section>
  );
}
export function Loading() {
  const { c } = useWorkspace();
  return (
    <p role="status" className="workspace-empty">
      {c.loading}
    </p>
  );
}
export function Empty({ children }: { children?: ReactNode }) {
  const { c } = useWorkspace();
  return (
    <div className="workspace-empty">
      <h2>{c.empty}</h2>
      <p>{children ?? c.emptyHint}</p>
    </div>
  );
}
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
}) {
  return (
    <div className="workspace-tabs" role="group">
      {items.map((i) => (
        <Button
          key={i.value}
          size="sm"
          variant={i.value === value ? "primary" : "ghost"}
          aria-pressed={i.value === value}
          onClick={() => onChange(i.value)}
        >
          {i.label}
        </Button>
      ))}
    </div>
  );
}
export function UserSelect({
  value,
  onChange,
  label,
  nullable = true,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  nullable?: boolean;
}) {
  const { data, c } = useWorkspace();
  return (
    <div className="ds-field">
      <span className="ds-label">{label}</span>
      <Select
        aria-label={label}
        value={value ?? ""}
        onChange={(v) => onChange(v || null)}
        options={[
          ...(nullable ? [{ value: "", label: c.none }] : []),
          ...data.users
            .filter((u) => u.authSource !== "service")
            .map((u) => ({ value: u.id, label: u.name })),
        ]}
      />
    </div>
  );
}
export function UserChecks({
  value,
  onChange,
  label,
  membersOnly = false,
}: {
  membersOnly?: boolean;
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const { data } = useWorkspace();
  return (
    <fieldset className="workspace-checks">
      <legend>{label}</legend>
      {data.users
        .filter(
          (u) =>
            u.authSource !== "service" &&
            (!membersOnly || !!data.members[u.id]),
        )
        .map((u) => (
          <Checkbox
            key={u.id}
            label={u.name}
            checked={value.includes(u.id)}
            onChange={(checked) =>
              onChange(
                checked ? [...value, u.id] : value.filter((id) => id !== u.id),
              )
            }
          />
        ))}
    </fieldset>
  );
}
export function useSelected(key: string) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const selected = new URLSearchParams(search).get(key);
  return [
    selected,
    (id: string | null) => {
      const p = new URLSearchParams(window.location.search);
      if (id) p.set(key, id);
      else p.delete(key);
      navigate(`${window.location.pathname}${p.size ? `?${p}` : ""}`);
    },
  ] as const;
}
export function materialPath(item: { ref: EntityRef; projectKey: string }) {
  const base = `/p/${encodeURIComponent(item.projectKey)}`;
  const { kind, id } = item.ref;
  return kind === "issue"
    ? `${base}/issue/${id}`
    : kind === "document"
      ? `${base}/documents?document=${id}`
      : kind === "object"
        ? `${base}/objects?object=${id}`
        : `${base}/processes?run=${id}`;
}
export function ModuleBanner({ module }: { module: keyof WorkspaceModules }) {
  const { projectId, c, manage, data, lang } = useWorkspace();
  const [, navigate] = useLocation();
  const copy = projectModulesCopy(lang);
  const resource = useResource(
    (s) => workspaceApi.modules(projectId, s),
    [projectId],
  );
  useModuleEvents(resource.reload);
  if (!resource.data || resource.data[module])
    return <ErrorNotice message={resource.error} />;
  return (
    <aside className="workspace-banner">
      <span>{module === "files" ? copy.filesDisabled : c.disabled}</span>
      {manage && (
        <Button
          size="sm"
          onClick={() =>
            navigate(
              `/p/${encodeURIComponent(data.project.key)}/settings/modules`,
            )
          }
        >
          {copy.settings}
        </Button>
      )}
    </aside>
  );
}
export function useModuleEnabled(module: keyof WorkspaceModules) {
  const { projectId } = useWorkspace();
  const r = useResource((s) => workspaceApi.modules(projectId, s), [projectId]);
  useModuleEvents(r.reload);
  return r.data?.[module] ?? false;
}
export function useModuleEvents(reload: () => void) {
  useEffect(() => {
    window.addEventListener("taskira:workspace-modules", reload);
    return () =>
      window.removeEventListener("taskira:workspace-modules", reload);
  }, [reload]);
}
export function MaterialLinks({
  source,
  editable,
  kind,
  hideWhenEmpty = false,
  title,
}: {
  source: EntityRef;
  editable: boolean;
  kind?: EntityRef["kind"];
  hideWhenEmpty?: boolean;
  title?: string;
}) {
  const { projectId, c, data } = useWorkspace();
  const { openIssue } = useStore();
  const [, navigate] = useLocation();
  const r = useResource(
    (s) => workspaceApi.links(projectId, source, s),
    [projectId, source.kind, source.id],
  );
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const candidates = useResource(
    (s) => workspaceApi.library(search, s, { projectId, kind }),
    [search, open],
  );
  const a = useAction();
  if (hideWhenEmpty && !editable && !r.data?.items.length && !r.error)
    return null;
  return (
    <section className="workspace-section">
      <h2>{title ?? c.links}</h2>
      <ErrorNotice message={r.error ?? a.error} />
      {r.data?.items
        .filter((l) => !kind || l.target.kind === kind)
        .map((l) => (
          <div className="workspace-row" key={l.id}>
            <button
              className="workspace-text-link"
              onClick={() => {
                if (l.target.kind === "issue")
                  void a.run(
                    () => issuesApi.get(projectId, l.target.id),
                    (issue) => openIssue(issue.id, "panel"),
                  );
                else
                  navigate(
                    materialPath({
                      ref: l.target,
                      projectKey: data.project.key,
                    }),
                  );
              }}
            >
              {l.title}
            </button>
            <small>
              {c[l.target.kind]}
              {l.archived ? ` · ${c.archived}` : ""}
            </small>
            {editable && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void a.run(
                    () => workspaceApi.unlink(projectId, l.id),
                    r.reload,
                  )
                }
              >
                {c.remove}
              </Button>
            )}
          </div>
        ))}
      {editable && (
        <Button size="sm" onClick={() => setOpen(true)}>
          {c.linkMaterial}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={c.linkMaterial}>
        <Input
          label={c.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ErrorNotice message={candidates.error ?? a.error} />
        <div className="workspace-picker">
          {candidates.data?.items
            .filter(
              (i) =>
                (!kind || i.ref.kind === kind) &&
                i.projectId === projectId &&
                !(i.ref.kind === source.kind && i.ref.id === source.id),
            )
            .map((i) => (
              <Button
                key={`${i.ref.kind}:${i.ref.id}`}
                variant="ghost"
                disabled={a.busy}
                onClick={() =>
                  void a.run(
                    () => workspaceApi.link(projectId, source, i.ref),
                    () => {
                      r.reload();
                      setOpen(false);
                    },
                  )
                }
              >
                {c[i.ref.kind]} · {i.title}
              </Button>
            ))}
        </div>
      </Dialog>
    </section>
  );
}
export function ConditionsEditor({
  value,
  onChange,
}: {
  value: Conditions;
  onChange: (v: Conditions) => void;
}) {
  const { c } = useWorkspace();
  return (
    <fieldset className="workspace-form">
      <legend>{c.conditions}</legend>
      <Select
        aria-label={c.conditions}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: "all", label: c.allConditions },
          { value: "any", label: c.anyConditions },
        ]}
      />
      {value.items.map((item, index) => (
        <div key={index} className="workspace-condition">
          <Input
            label={c.conditionField}
            value={item.field}
            onChange={(e) =>
              onChange({
                ...value,
                items: value.items.map((v, i) =>
                  i === index ? { ...v, field: e.target.value } : v,
                ),
              })
            }
          />
          <Select
            aria-label={c.operator}
            value={item.op}
            onChange={(op) =>
              onChange({
                ...value,
                items: value.items.map((v, i) =>
                  i === index ? { ...v, op } : v,
                ),
              })
            }
            options={(["eq", "neq", "includes", "isSet"] as const).map((v) => ({
              value: v,
              label: c[v],
            }))}
          />
          <Input
            label={c.value}
            value={String(item.value ?? "")}
            onChange={(e) =>
              onChange({
                ...value,
                items: value.items.map((v, i) =>
                  i === index ? { ...v, value: e.target.value } : v,
                ),
              })
            }
          />
          <Button
            variant="ghost"
            onClick={() =>
              onChange({
                ...value,
                items: value.items.filter((_, i) => i !== index),
              })
            }
          >
            {c.remove}
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        onClick={() =>
          onChange({
            ...value,
            items: [
              ...value.items,
              { field: "priorityId", op: "eq", value: "high" },
            ],
          })
        }
      >
        {c.add}
      </Button>
    </fieldset>
  );
}
export { Button, Input, Textarea, Select, Dialog, Checkbox };

export function exportMaterial(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
