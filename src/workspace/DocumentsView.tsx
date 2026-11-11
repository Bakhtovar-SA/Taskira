import { DateField, FileUpload, Checkbox } from "./shared";
import { lazy, Suspense, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useStore } from "../store";
import type {
  Document,
  DocumentVersion,
} from "../../server/src/workspaceContract";
import { workspaceApi } from "./api";
import { useResource, useAction } from "./hooks";
import {
  Frame,
  ModuleBanner,
  useWorkspace,
  useModuleEnabled,
  useSelected,
  Button,
  Input,
  Textarea,
  Select,
  Dialog,
  UserSelect,
  MaterialLinks,
  ErrorNotice,
  Empty,
  Loading,
  Tabs,
} from "./shared";
import "./workspace.css";
const DocumentEditor = lazy(() => import("./DocumentEditor"));
export default function DocumentsView() {
  const { projectId, c, writeDocs } = useWorkspace();
  const enabled = useModuleEnabled("documents");
  const [selected, select] = useSelected("document");
  const list = useResource(
    (s) => workspaceApi.documents(projectId, s),
    [projectId],
  );
  const [search, setSearch] = useState(""),
    [archives, setArchives] = useState(false),
    [create, setCreate] = useState(false);
  const action = useAction();
  const items =
    list.data?.items.filter(
      (d) =>
        (archives || !d.archived) &&
        d.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? [];
  const depth = (d: Document) => {
    let n = 0,
      p = d.parentId;
    const seen = new Set<string>();
    while (p && n < 10 && !seen.has(p)) {
      seen.add(p);
      n++;
      p = list.data?.items.find((i) => i.id === p)?.parentId ?? null;
    }
    return n;
  };
  const ordered = [...items].sort((a, b) => {
    const path = (d: Document) => {
      let p = d.parentId;
      const names = [d.title];
      for (let n = 0; p && n < 10; n++) {
        const parent = list.data?.items.find((i) => i.id === p);
        if (!parent) break;
        names.unshift(parent.title);
        p = parent.parentId;
      }
      return names.join("/");
    };
    return path(a).localeCompare(path(b));
  });
  return (
    <Frame
      title={c.documents}
      hint={c.documentsHint}
      actions={
        writeDocs &&
        enabled && (
          <Button variant="primary" onClick={() => setCreate(true)}>
            {c.newDocument}
          </Button>
        )
      }
    >
      <ModuleBanner module="documents" />
      <ErrorNotice message={list.error ?? action.error} />
      <div className="workspace-split">
        <aside>
          <Input
            label={c.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="workspace-row">
            <Checkbox
              label={c.archived}
              checked={archives}
              onChange={(checked) => setArchives(checked)}
            />
          </div>
          <div className="workspace-list">
            {ordered.map((d) => (
              <button
                key={d.id}
                aria-current={d.id === selected}
                onClick={() => select(d.id)}
              >
                {"› ".repeat(depth(d))}
                {d.title}
                {d.archived ? ` · ${c.archived}` : ""}
              </button>
            ))}
          </div>
        </aside>
        <div>
          {selected ? (
            <DocumentDetail
              key={`${projectId}:${selected}`}
              id={selected}
              enabled={enabled}
              onChange={list.reload}
            />
          ) : list.loading ? (
            <Loading />
          ) : (
            <Empty>{c.documentHint}</Empty>
          )}
        </div>
      </div>
      <NewDocument
        open={create}
        onClose={() => setCreate(false)}
        documents={list.data?.items ?? []}
        onCreated={(d) => {
          list.reload();
          select(d.id);
          setCreate(false);
        }}
      />
    </Frame>
  );
}
function NewDocument({
  open,
  onClose,
  documents,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  documents: Document[];
  onCreated: (d: Document) => void;
}) {
  const { projectId, c, data } = useWorkspace();
  const [title, setTitle] = useState(""),
    [template, setTemplate] = useState("blank"),
    [parent, setParent] = useState(""),
    [owner, setOwner] = useState<string | null>(data.currentUserId);
  const a = useAction();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={c.newDocument}
      footer={
        <Button
          variant="primary"
          loading={a.busy}
          disabled={!title.trim()}
          onClick={() =>
            void a.run(
              () =>
                workspaceApi.createDocument(projectId, {
                  title,
                  template,
                  parentId: parent || null,
                  ownerId: owner,
                }),
              onCreated,
            )
          }
        >
          {c.create}
        </Button>
      }
    >
      <div className="workspace-form">
        <Input
          label={c.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={240}
        />
        <div className="ds-field">
          <span className="ds-label">{c.template}</span>
          <Select
            aria-label={c.template}
            value={template}
            onChange={setTemplate}
            options={(
              [
                "blank",
                "instruction",
                "minutes",
                "decision",
                "regulation",
              ] as const
            ).map((t) => ({ value: t, label: c[t] }))}
          />
        </div>
        <Select
          aria-label={c.parent}
          value={parent}
          onChange={setParent}
          options={[
            { value: "", label: c.none },
            ...documents
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.title })),
          ]}
        />
        <UserSelect label={c.owner} value={owner} onChange={setOwner} />
        <ErrorNotice message={a.error} />
      </div>
    </Dialog>
  );
}
function DocumentDetail({
  id,
  enabled,
  onChange,
}: {
  id: string;
  enabled: boolean;
  onChange: () => void;
}) {
  const { projectId, c, data, writeDocs, manage } = useWorkspace();
  const { openIssue } = useStore();
  const r = useResource(
    (s) => workspaceApi.document(projectId, id, s),
    [projectId, id],
  );
  const versions = useResource(
    (s) => workspaceApi.versions(projectId, id, 0, s),
    [projectId, id],
  );
  const comments = useResource(
    (s) => workspaceApi.comments(projectId, id, s),
    [projectId, id],
  );
  const files = useResource(
    (s) => workspaceApi.files(projectId, id, s),
    [projectId, id],
  );
  const contextLinks = useResource(
    (signal) => workspaceApi.links(projectId, { kind: "document", id }, signal),
    [projectId, id],
  );
  const [taskObject, setTaskObject] = useState(""),
    [taskRun, setTaskRun] = useState("");
  const [panel, setPanel] = useState<
      "comments" | "versions" | "links" | "properties"
    >("comments"),
    [comment, setComment] = useState(""),
    [selection, setSelection] = useState({
      text: "",
      blockId: null as string | null,
    }),
    [taskOpen, setTaskOpen] = useState(false),
    [taskTitle, setTaskTitle] = useState(""),
    [taskText, setTaskText] = useState(""),
    [name, setName] = useState(""),
    [validUntil, setValidUntil] = useState(""),
    [versionPreview, setVersionPreview] = useState<DocumentVersion | null>(
      null,
    ),
    [rename, setRename] = useState(""),
    [newOwner, setNewOwner] = useState<string | null>(null),
    [editing, setEditing] = useState(false),
    [restoreVersion, setRestoreVersion] = useState<DocumentVersion | null>(
      null,
    );
  const editor = useRef<Editor | null>(null),
    requestId = useRef(crypto.randomUUID());
  const a = useAction();
  const d = r.data?.document;
  const writable = enabled && writeDocs && !d?.archived;
  if (!d) return r.loading ? <Loading /> : <ErrorNotice message={r.error} />;
  const status = d.verifiedVersionId
    ? d.verifiedContentRevision !== d.contentRevision
      ? c.needsReview
      : d.validUntil && d.validUntil < new Date().toISOString().slice(0, 10)
        ? c.expired
        : c.verified
    : c.notVerified;
  const save = () => {
    r.reload();
    versions.reload();
    onChange();
  };
  const plain = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { text?: string; content?: unknown[] };
    return [n.text ?? "", ...(n.content ?? []).map(plain)]
      .filter(Boolean)
      .join("\n");
  };
  return (
    <>
      <div className="workspace-actions">
        <h2 className="font-semibold text-lg">{d.title}</h2>
        <small className="workspace-muted">
          {d.archived ? c.archived : status}
        </small>
        {writable && (
          <Button
            size="sm"
            onClick={() => {
              setRename(d.title);
              setNewOwner(d.ownerId);
              setEditing(true);
            }}
          >
            {c.edit}
          </Button>
        )}
        {manage && enabled && (
          <Button
            size="sm"
            onClick={() =>
              void a.run(
                () =>
                  workspaceApi.patchDocument(projectId, id, {
                    revision: d.revision,
                    archived: !d.archived,
                  }),
                save,
              )
            }
          >
            {d.archived ? c.unarchive : c.archive}
          </Button>
        )}
        <Button
          size="sm"
          onClick={() =>
            void a.run(() => workspaceApi.exportDocument(projectId, id))
          }
        >
          {c.export}
        </Button>
        {writable && (
          <Button
            size="sm"
            disabled={!selection.text.trim()}
            onClick={() => {
              requestId.current = crypto.randomUUID();
              const objects =
                  contextLinks.data?.items.filter(
                    (l) => l.target.kind === "object",
                  ) ?? [],
                runs =
                  contextLinks.data?.items.filter(
                    (l) => l.target.kind === "process",
                  ) ?? [];
              setTaskObject(objects.length === 1 ? objects[0].target.id : "");
              setTaskRun(runs.length === 1 ? runs[0].target.id : "");
              setTaskTitle(selection.text.trim().slice(0, 240));
              setTaskText(selection.text);
              setTaskOpen(true);
            }}
          >
            {c.createTask}
          </Button>
        )}
      </div>
      <ErrorNotice message={r.error ?? a.error} />
      <div className="workspace-document-layout">
        <div>
          <Suspense fallback={<Loading />}>
            <DocumentEditor
              document={d}
              editable={writable}
              files={files.data?.items ?? []}
              onSelection={(text, blockId) => setSelection({ text, blockId })}
              onPersist={() => {
                void workspaceApi
                  .document(projectId, id)
                  .then((value) => r.setData(value))
                  .catch(() => undefined);
              }}
              onEditor={(value) => {
                editor.current = value;
              }}
            />
          </Suspense>
          <section className="workspace-section">
            <h3>{c.files}</h3>
            {files.data?.items.map((f) => (
              <div key={f.id} className="workspace-row">
                <a
                  className="workspace-text-link"
                  href={workspaceApi.fileUrl(projectId, id, f.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {f.filename}
                </a>
                <small>{Math.ceil(f.size / 1024)} KB</small>
              </div>
            ))}
            {writable && (
              <FileUpload
                busy={a.busy}
                onFile={(file) =>
                  a.run(
                    () => workspaceApi.upload(projectId, id, file),
                    files.reload,
                  )
                }
              />
            )}
            <ErrorNotice message={files.error} />
          </section>
        </div>
        <aside>
          <Tabs
            value={panel}
            onChange={setPanel}
            items={(
              ["comments", "versions", "links", "properties"] as const
            ).map((v) => ({ value: v, label: c[v] }))}
          />
          {panel === "comments" && (
            <section className="workspace-section">
              <h3>{c.comments}</h3>
              <ErrorNotice message={comments.error} />
              {comments.data?.items.map((item) => (
                <div
                  className="workspace-comment"
                  key={item.id}
                  data-resolved={item.resolved}
                >
                  <strong>{item.authorName}</strong>
                  {item.blockId && (
                    <button
                      className="workspace-text-link"
                      onClick={() => {
                        const el = Array.from(
                          window.document.querySelectorAll("[data-block-id]"),
                        ).find(
                          (e) =>
                            e.getAttribute("data-block-id") === item.blockId,
                        );
                        el?.scrollIntoView({
                          block: "center",
                          behavior: window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches
                            ? "auto"
                            : "smooth",
                        });
                      }}
                    >
                      {c.block}
                    </button>
                  )}
                  <p>{item.body}</p>
                  {writable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void a.run(
                          () =>
                            workspaceApi.resolve(
                              projectId,
                              id,
                              item.id,
                              !item.resolved,
                            ),
                          comments.reload,
                        )
                      }
                    >
                      {item.resolved ? c.reopen : c.resolve}
                    </Button>
                  )}
                </div>
              ))}
              {writable && (
                <div className="workspace-form">
                  <Textarea
                    label={c.comment}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={10000}
                  />
                  <small>{selection.blockId ? c.block : c.wholeDocument}</small>
                  <Button
                    size="sm"
                    disabled={!comment.trim()}
                    loading={a.busy}
                    onClick={() =>
                      void a.run(
                        () =>
                          workspaceApi.comment(projectId, id, {
                            body: comment,
                            blockId: selection.blockId,
                            parentId: null,
                          }),
                        () => {
                          setComment("");
                          comments.reload();
                        },
                      )
                    }
                  >
                    {c.addComment}
                  </Button>
                </div>
              )}
            </section>
          )}
          {panel === "versions" && (
            <section className="workspace-section">
              <h3>{c.versions}</h3>
              {writable && (
                <div className="workspace-form">
                  <Input
                    label={c.versionName}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Button
                    loading={a.busy}
                    onClick={() =>
                      void a.run(
                        () => workspaceApi.checkpoint(projectId, id, name),
                        () => {
                          setName("");
                          save();
                        },
                      )
                    }
                  >
                    {c.checkpoint}
                  </Button>
                </div>
              )}
              {versions.data?.items.map((v) => (
                <div className="workspace-comment" key={v.id}>
                  <button
                    className="workspace-text-link"
                    onClick={() => setVersionPreview(v)}
                  >
                    {v.name || new Date(v.createdAt).toLocaleString()}
                  </button>
                  <small className="workspace-muted">
                    {" "}
                    · {v.contentRevision}
                  </small>
                  {manage && writable && (
                    <div className="workspace-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRestoreVersion(v)}
                      >
                        {c.restore}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void a.run(
                            () =>
                              workspaceApi.verify(
                                projectId,
                                id,
                                v.id,
                                validUntil || null,
                              ),
                            save,
                          )
                        }
                      >
                        {c.verify}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {manage && writable && (
                <DateField
                  label={c.validUntil}
                  value={validUntil}
                  onChange={(value) => setValidUntil(value)}
                />
              )}
              <ErrorNotice message={versions.error} />
            </section>
          )}
          {panel === "links" && (
            <MaterialLinks
              source={{ kind: "document", id }}
              editable={writable}
            />
          )}{" "}
          {panel === "properties" && (
            <section className="workspace-section">
              <h3>{c.properties}</h3>
              <p>
                {c.owner}:{" "}
                {data.users.find((u) => u.id === d.ownerId)?.name ?? c.none}
              </p>
              <p className="workspace-muted">
                {status}
                {d.validUntil ? ` · ${d.validUntil}` : ""}
              </p>
            </section>
          )}
        </aside>
      </div>
      <Dialog
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        title={c.createTask}
        footer={
          <Button
            variant="primary"
            loading={a.busy}
            disabled={!taskTitle.trim()}
            onClick={() =>
              void a.run(
                () =>
                  workspaceApi.taskFromDocument(projectId, id, {
                    title: taskTitle,
                    description: taskText,
                    blockId: selection.blockId,
                    requestId: requestId.current,
                    objectId: taskObject || null,
                    runId: taskRun || null,
                  }),
                (issue) => {
                  if (editor.current) {
                    const pos = editor.current.state.selection.to;
                    editor.current
                      .chain()
                      .focus()
                      .insertContentAt(pos, [
                        {
                          type: "taskReference",
                          attrs: { issueId: issue.id, label: issue.key },
                        },
                      ])
                      .run();
                  }
                  setTaskOpen(false);
                  openIssue(issue.id, "panel");
                },
              )
            }
          >
            {c.create}
          </Button>
        }
      >
        <div className="workspace-form">
          <Input
            label={c.taskTitle}
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
          />
          {(["object", "process"] as const).map((kind) => (
            <Select
              key={kind}
              aria-label={c[kind]}
              value={kind === "object" ? taskObject : taskRun}
              onChange={kind === "object" ? setTaskObject : setTaskRun}
              options={[
                { value: "", label: c.none },
                ...(contextLinks.data?.items ?? [])
                  .filter((l) => l.target.kind === kind)
                  .map((l) => ({ value: l.target.id, label: l.title })),
              ]}
            />
          ))}
          <Textarea
            label={c.taskDescription}
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
          />
          <ErrorNotice message={a.error} />
        </div>
      </Dialog>
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={c.edit}
        footer={
          <Button
            loading={a.busy}
            onClick={() =>
              void a.run(
                () =>
                  workspaceApi.patchDocument(projectId, id, {
                    revision: d.revision,
                    title: rename,
                    ownerId: newOwner,
                  }),
                () => {
                  setEditing(false);
                  save();
                },
              )
            }
          >
            {c.save}
          </Button>
        }
      >
        <div className="workspace-form">
          <Input
            label={c.title}
            value={rename}
            onChange={(e) => setRename(e.target.value)}
          />
          <UserSelect label={c.owner} value={newOwner} onChange={setNewOwner} />
          <ErrorNotice message={a.error} />
        </div>
      </Dialog>
      <Dialog
        open={!!versionPreview}
        onClose={() => setVersionPreview(null)}
        title={c.versionContent}
      >
        <pre className="workspace-version-preview">
          {plain(versionPreview?.content)}
        </pre>
      </Dialog>
      <Dialog
        open={!!restoreVersion}
        onClose={() => setRestoreVersion(null)}
        title={c.restore}
        description={c.restoreHint}
        footer={
          <Button
            variant="primary"
            loading={a.busy}
            onClick={() => {
              if (restoreVersion)
                void a.run(
                  () => workspaceApi.restore(projectId, id, restoreVersion.id),
                  () => {
                    setRestoreVersion(null);
                    save();
                  },
                );
            }}
          >
            {c.restore}
          </Button>
        }
      >
        <ErrorNotice message={a.error} />
      </Dialog>
    </>
  );
}
