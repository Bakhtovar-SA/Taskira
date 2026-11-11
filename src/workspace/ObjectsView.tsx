import { DateField, Disclosure, Checkbox } from "./shared";
import { workspaceHistoryText } from "../i18n/workspace";
import { useState } from "react";
import { useStore } from "../store";
import type {
  ObjectField,
  ObjectType,
  ObjectRecord,
  FieldValue,
} from "../../server/src/workspaceContract";
import { workspaceApi } from "./api";
import { useResource, useAction } from "./hooks";
import {
  Frame,
  exportMaterial,
  ModuleBanner,
  useWorkspace,
  useModuleEnabled,
  useSelected,
  Button,
  Input,
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
export default function ObjectsView() {
  const { projectId, c, manage, writeObjects, data } = useWorkspace();
  const enabled = useModuleEnabled("objects"),
    [selected, select] = useSelected("object");
  const types = useResource(
    (s) => workspaceApi.types(projectId, s),
    [projectId],
  );
  const [typeId, setTypeId] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [ownerFilter, setOwnerFilter] = useState(""),
    [archiveFilter, setArchiveFilter] = useState("false"),
    [fieldFilter, setFieldFilter] = useState(""),
    [fieldValue, setFieldValue] = useState(""),
    [dateBefore, setDateBefore] = useState(""),
    [sort, setSort] = useState("title"),
    [direction, setDirection] = useState("asc"),
    [showType, setShowType] = useState(false),
    [editType, setEditType] = useState<ObjectType | null>(null),
    [showObject, setShowObject] = useState(false),
    [columns, setColumns] = useState<string[] | null>(null);
  const list = useResource(
    (s) =>
      workspaceApi.objects(
        projectId,
        {
          typeId: typeId || undefined,
          q: search,
          offset,
          owner: ownerFilter || undefined,
          archived: archiveFilter,
          field: fieldFilter || undefined,
          value: fieldValue,
          before: dateBefore || undefined,
          sort,
          direction,
        },
        s,
      ),
    [
      projectId,
      typeId,
      search,
      offset,
      ownerFilter,
      archiveFilter,
      fieldFilter,
      fieldValue,
      dateBefore,
      sort,
      direction,
    ],
  );
  const selectedType = types.data?.items.find((t) => t.id === typeId);
  const fields =
    selectedType?.fields.filter(
      (f) => columns === null || columns.includes(f.key),
    ) ?? [];
  return (
    <Frame
      title={c.objects}
      hint={c.objectsHint}
      actions={
        <>
          {manage && enabled && (
            <Button
              onClick={() => {
                setEditType(null);
                setShowType(true);
              }}
            >
              {c.newType}
            </Button>
          )}
          {writeObjects && enabled && (
            <Button
              variant="primary"
              disabled={!types.data?.items.length}
              onClick={() => setShowObject(true)}
            >
              {c.newObject}
            </Button>
          )}
        </>
      }
    >
      <ModuleBanner module="objects" />
      <ErrorNotice message={types.error ?? list.error} />
      <div className="workspace-actions">
        <Input
          label={c.search}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <Select
          aria-label={c.type}
          value={typeId}
          onChange={(v) => {
            setTypeId(v);
            setOffset(0);
            setColumns(null);
            setFieldFilter("");
            setFieldValue("");
            setDateBefore("");
            setSort("title");
          }}
          options={[
            { value: "", label: c.all },
            ...(types.data?.items ?? []).map((t) => ({
              value: t.id,
              label: t.name,
            })),
          ]}
        />
        {selectedType && manage && enabled && (
          <Button
            onClick={() => {
              setEditType(selectedType);
              setShowType(true);
            }}
          >
            {c.configure}
          </Button>
        )}
        {selectedType && (
          <Disclosure title={c.columns}>
            <div className="workspace-checks">
              {selectedType.fields.map((f) => (
                <Checkbox
                  key={f.key}
                  label={f.name}
                  checked={columns === null || columns.includes(f.key)}
                  onChange={(checked) =>
                    setColumns(
                      checked
                        ? [
                            ...(columns ??
                              selectedType.fields.map((f) => f.key)),
                            f.key,
                          ]
                        : (
                            columns ?? selectedType.fields.map((f) => f.key)
                          ).filter((k) => k !== f.key),
                    )
                  }
                />
              ))}
            </div>
          </Disclosure>
        )}
      </div>
      <Disclosure className="workspace-section" title={c.conditions}>
        <div className="workspace-actions">
          <Select
            aria-label={c.owner}
            value={ownerFilter}
            onChange={(v) => {
              setOwnerFilter(v);
              setOffset(0);
            }}
            options={[
              { value: "", label: c.all },
              { value: "none", label: c.noOwner },
              ...data.users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
          <Select
            aria-label={c.archived}
            value={archiveFilter}
            onChange={(v) => {
              setArchiveFilter(v);
              setOffset(0);
            }}
            options={[
              { value: "false", label: c.activeObjects },
              { value: "true", label: c.archived },
              { value: "all", label: c.all },
            ]}
          />
          {selectedType && (
            <>
              <Select
                aria-label={c.fieldName}
                value={fieldFilter}
                onChange={(v) => {
                  setFieldFilter(v);
                  setDateBefore("");
                  setOffset(0);
                }}
                options={[
                  { value: "", label: c.none },
                  ...selectedType.fields.map((f) => ({
                    value: f.key,
                    label: f.name,
                  })),
                ]}
              />
              {fieldFilter && (
                <Input
                  label={c.value}
                  value={fieldValue}
                  onChange={(e) => {
                    setFieldValue(e.target.value);
                    setOffset(0);
                  }}
                />
              )}
              {selectedType.fields.find((f) => f.key === fieldFilter)?.type ===
                "date" && (
                <DateField
                  label={c.dateBefore}
                  value={dateBefore}
                  onChange={(value) => {
                    setDateBefore(value);
                    setOffset(0);
                  }}
                />
              )}
            </>
          )}
          <Select
            aria-label={c.sort}
            value={sort}
            onChange={(v) => {
              setSort(v);
              setOffset(0);
            }}
            options={[
              { value: "title", label: c.title },
              { value: "updatedAt", label: c.updatedAt },
              ...(selectedType?.fields ?? []).map((f) => ({
                value: `field:${f.key}`,
                label: f.name,
              })),
            ]}
          />
          <Select
            aria-label={c.sortDirection}
            value={direction}
            onChange={(v) => {
              setDirection(v);
              setOffset(0);
            }}
            options={[
              { value: "asc", label: c.ascending },
              { value: "desc", label: c.descending },
            ]}
          />
        </div>
      </Disclosure>
      {list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.items.length ? (
        <Empty />
      ) : (
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th scope="col">{c.title}</th>
                <th scope="col">{c.type}</th>
                <th scope="col">{c.owner}</th>
                {fields.map((f) => (
                  <th key={f.key} scope="col">
                    {f.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <button
                      className="workspace-text-link"
                      onClick={() => select(o.id)}
                    >
                      {o.title}
                    </button>
                    {o.archived && <small> · {c.archived}</small>}
                  </td>
                  <td>
                    {types.data?.items.find((t) => t.id === o.typeId)?.name}
                  </td>
                  <td>
                    {data.users.find((u) => u.id === o.ownerId)?.name ?? c.none}
                  </td>
                  {fields.map((f) => (
                    <td key={f.key}>
                      {f.type === "user"
                        ? (data.users.find((u) => u.id === o.values[f.key])
                            ?.name ?? c.none)
                        : f.type === "checkbox"
                          ? o.values[f.key]
                            ? "✓"
                            : "—"
                          : String(o.values[f.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="workspace-actions">
        <Button
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          {c.previous}
        </Button>
        <span className="workspace-muted">
          {offset + 1}–{offset + (list.data?.items.length ?? 0)} /{" "}
          {list.data?.total ?? 0}
        </span>
        <Button
          size="sm"
          disabled={offset + 100 >= (list.data?.total ?? 0)}
          onClick={() => setOffset(offset + 100)}
        >
          {c.next}
        </Button>
      </div>
      {selected && (
        <ObjectDetail
          key={selected}
          id={selected}
          enabled={enabled}
          types={types.data?.items ?? []}
          onClose={() => select(null)}
          onChange={list.reload}
        />
      )}
      {showType && (
        <TypeForm
          initial={editType}
          onClose={() => setShowType(false)}
          onSave={() => {
            types.reload();
            setShowType(false);
          }}
        />
      )}
      {showObject && (
        <ObjectForm
          types={types.data?.items ?? []}
          typeId={typeId}
          onClose={() => setShowObject(false)}
          onSave={(o) => {
            setShowObject(false);
            list.reload();
            select(o.id);
          }}
        />
      )}
    </Frame>
  );
}
function TypeForm({
  initial,
  onClose,
  onSave,
}: {
  initial: ObjectType | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { projectId, c } = useWorkspace();
  const [name, setName] = useState(initial?.name ?? ""),
    [fields, setFields] = useState<ObjectField[]>(initial?.fields ?? []);
  const a = useAction();
  const update = (index: number, patch: Partial<ObjectField>) =>
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial ? c.configure : c.newType}
      size="xl"
      footer={
        <Button
          loading={a.busy}
          disabled={!name.trim()}
          onClick={() =>
            void a.run(
              () =>
                workspaceApi.saveType(projectId, initial?.id ?? null, {
                  name,
                  fields,
                  ...(initial ? { revision: initial.revision } : {}),
                }),
              onSave,
            )
          }
        >
          {c.save}
        </Button>
      }
    >
      <div className="workspace-form">
        <Input
          label={c.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {fields.map((f, i) => (
          <fieldset className="workspace-form" key={i}>
            <div className="workspace-type-field">
              <Input
                label={c.fieldName}
                value={f.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <Input
                label={c.fieldKey}
                value={f.key}
                disabled={!!initial?.fields.some((k) => k.key === f.key)}
                onChange={(e) => update(i, { key: e.target.value })}
              />
              <Select
                aria-label={c.fieldType}
                value={f.type}
                onChange={(type) => update(i, { type })}
                options={(
                  [
                    "text",
                    "number",
                    "date",
                    "select",
                    "checkbox",
                    "user",
                    "reference",
                  ] as const
                ).map((type) => ({ value: type, label: c[type] }))}
              />
              <Button
                variant="ghost"
                onClick={() => setFields(fields.filter((_, n) => n !== i))}
              >
                {c.remove}
              </Button>
            </div>
            {f.type === "select" && (
              <Input
                label={c.options}
                value={f.options.join(", ")}
                onChange={(e) =>
                  update(i, {
                    options: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
            <Checkbox
              label={c.required}
              checked={f.required}
              onChange={(checked) => update(i, { required: checked })}
            />
          </fieldset>
        ))}
        <Button
          onClick={() =>
            setFields([
              ...fields,
              {
                key: `field_${fields.length + 1}`,
                name: "",
                type: "text",
                required: false,
                options: [],
              },
            ])
          }
        >
          {c.add}
        </Button>
        <ErrorNotice message={a.error} />
      </div>
    </Dialog>
  );
}
function ReferenceField({
  field,
  value,
  onChange,
}: {
  field: ObjectField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  const { projectId, c } = useWorkspace();
  const [search, setSearch] = useState("");
  const r = useResource(
    (s) => workspaceApi.objects(projectId, { q: search }, s),
    [projectId, search],
  );
  return (
    <div className="workspace-form">
      <Input
        label={`${field.name} · ${c.search}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Select
        aria-label={field.name}
        value={String(value ?? "")}
        onChange={(v) => onChange(v || null)}
        options={[
          { value: "", label: c.none },
          ...(r.data?.items ?? []).map((o) => ({
            value: o.id,
            label: o.title,
          })),
        ]}
      />
      <ErrorNotice message={r.error} />
    </div>
  );
}
function ObjectForm({
  types,
  typeId,
  initial,
  onClose,
  onSave,
}: {
  types: ObjectType[];
  typeId?: string;
  initial?: ObjectRecord;
  onClose: () => void;
  onSave: (o: ObjectRecord) => void;
}) {
  const { projectId, c, data } = useWorkspace();
  const [selected, setSelected] = useState(
      initial?.typeId || typeId || types[0]?.id || "",
    ),
    [title, setTitle] = useState(initial?.title ?? ""),
    [owner, setOwner] = useState<string | null>(
      initial?.ownerId ?? data.currentUserId,
    ),
    [values, setValues] = useState<Record<string, FieldValue>>(
      initial?.values ?? {},
    );
  const a = useAction();
  const type = types.find((t) => t.id === selected);
  const set = (key: string, value: FieldValue) =>
    setValues((v) => ({ ...v, [key]: value }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial ? c.edit : c.newObject}
      size="lg"
      footer={
        <Button
          variant="primary"
          loading={a.busy}
          disabled={!type || !title.trim()}
          onClick={() =>
            void a.run(
              () =>
                workspaceApi.saveObject(projectId, initial?.id ?? null, {
                  title,
                  ownerId: owner,
                  values,
                  ...(initial
                    ? { revision: initial.revision }
                    : { typeId: selected }),
                }),
              onSave,
            )
          }
        >
          {c.save}
        </Button>
      }
    >
      <div className="workspace-form">
        {!initial && (
          <Select
            aria-label={c.type}
            value={selected}
            onChange={(v) => {
              setSelected(v);
              setValues({});
            }}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
          />
        )}
        <Input
          label={c.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <UserSelect label={c.owner} value={owner} onChange={setOwner} />
        {type?.fields.map((f) =>
          f.type === "checkbox" ? (
            <Checkbox
              key={f.key}
              label={f.name}
              checked={values[f.key] === true}
              onChange={(checked) => set(f.key, checked)}
            />
          ) : f.type === "select" ? (
            <div className="ds-field" key={f.key}>
              <span className="ds-label">{f.name}</span>
              <Select
                aria-label={f.name}
                value={String(values[f.key] ?? "")}
                onChange={(v) => set(f.key, v || null)}
                options={[
                  { value: "", label: c.none },
                  ...f.options.map((v) => ({ value: v, label: v })),
                ]}
              />
            </div>
          ) : f.type === "user" ? (
            <UserSelect
              key={f.key}
              label={f.name}
              value={String(values[f.key] ?? "") || null}
              onChange={(v) => set(f.key, v)}
            />
          ) : f.type === "reference" ? (
            <ReferenceField
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={(v) => set(f.key, v)}
            />
          ) : f.type === "date" ? (
            <DateField
              key={f.key}
              label={f.name + (f.required ? " *" : "")}
              value={String(values[f.key] ?? "")}
              onChange={(value) => set(f.key, value || null)}
            />
          ) : (
            <Input
              key={f.key}
              label={f.name + (f.required ? " *" : "")}
              type={f.type === "number" ? "number" : "text"}
              value={String(values[f.key] ?? "")}
              onChange={(e) =>
                set(
                  f.key,
                  e.target.value === ""
                    ? null
                    : f.type === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                )
              }
            />
          ),
        )}
        <ErrorNotice message={a.error} />
      </div>
    </Dialog>
  );
}
function ObjectDetail({
  id,
  types,
  enabled,
  onClose,
  onChange,
}: {
  id: string;
  types: ObjectType[];
  enabled: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const { projectId, c, lang, writeObjects, manage, data } = useWorkspace();
  const { createIssue, openIssue } = useStore();
  const r = useResource(
    (s) => workspaceApi.object(projectId, id, s),
    [projectId, id],
  );
  const a = useAction();
  const [tab, setTab] = useState<
      "properties" | "links" | "history" | "issues" | "documents" | "processes"
    >("properties"),
    [edit, setEdit] = useState(false),
    [task, setTask] = useState(false),
    [taskTitle, setTaskTitle] = useState("");
  const o = r.data?.object;
  const save = () => {
    r.reload();
    onChange();
  };
  return (
    <Dialog open onClose={onClose} title={o?.title ?? c.loading} size="xl">
      {!o ? (
        <Loading />
      ) : (
        <>
          <div className="workspace-actions">
            <Button onClick={() => exportMaterial(r.data, `object-${id}.json`)}>
              {c.export}
            </Button>
            {writeObjects && enabled && !o.archived && (
              <>
                <Button onClick={() => setEdit(true)}>{c.edit}</Button>
                <Button
                  onClick={() => {
                    setTaskTitle(o.title);
                    setTask(true);
                  }}
                >
                  {c.create}
                </Button>
              </>
            )}
            {manage && enabled && (
              <Button
                onClick={() =>
                  void a.run(
                    () =>
                      workspaceApi.saveObject(projectId, id, {
                        revision: o.revision,
                        archived: !o.archived,
                      }),
                    save,
                  )
                }
              >
                {o.archived ? c.unarchive : c.archive}
              </Button>
            )}
          </div>
          <ErrorNotice message={r.error ?? a.error} />
          <Tabs
            value={tab}
            onChange={setTab}
            items={(
              [
                "properties",
                "issues",
                "documents",
                "processes",
                "links",
                "history",
              ] as const
            ).map((value) => ({ value, label: c[value] }))}
          />
          {tab === "properties" && (
            <div className="workspace-form">
              <p>
                {c.owner}:{" "}
                {data.users.find((u) => u.id === o.ownerId)?.name ?? c.none}
              </p>
              <p>
                {c.openIssues}: {o.openIssues}
              </p>
              <p>
                {c.lastCheck}:{" "}
                {o.lastCheck
                  ? new Date(o.lastCheck).toLocaleDateString()
                  : c.none}
              </p>
              {types
                .find((t) => t.id === o.typeId)
                ?.fields.map((f) => (
                  <div key={f.key}>
                    <strong>{f.name}</strong>
                    <p>
                      {f.type === "user"
                        ? (data.users.find((u) => u.id === o.values[f.key])
                            ?.name ?? c.none)
                        : String(o.values[f.key] ?? c.none)}
                    </p>
                  </div>
                ))}
            </div>
          )}
          {["issues", "documents", "processes"].includes(tab) && (
            <MaterialLinks
              source={{ kind: "object", id }}
              kind={
                tab === "issues"
                  ? "issue"
                  : tab === "documents"
                    ? "document"
                    : "process"
              }
              editable={enabled && writeObjects && !o.archived}
            />
          )}
          {tab === "links" && (
            <MaterialLinks
              source={{ kind: "object", id }}
              editable={enabled && writeObjects && !o.archived}
            />
          )}{" "}
          {tab === "history" &&
            r.data?.history.map((h) => (
              <div key={h.id} className="workspace-comment">
                <small>{new Date(h.createdAt).toLocaleString()}</small>
                <p>{workspaceHistoryText(h.action, lang)}</p>
              </div>
            ))}
          {edit && (
            <ObjectForm
              types={types}
              initial={o}
              onClose={() => setEdit(false)}
              onSave={() => {
                setEdit(false);
                save();
              }}
            />
          )}
          <Dialog
            open={task}
            onClose={() => setTask(false)}
            title={c.taskTitle}
            footer={
              <Button
                loading={a.busy}
                disabled={!taskTitle.trim()}
                onClick={() =>
                  void a.run(
                    async () => {
                      const issue = await createIssue({
                        title: taskTitle,
                        description: "",
                        typeId: "task",
                        priorityId: "medium",
                        assigneeIds: data.members[data.currentUserId]
                          ? [data.currentUserId]
                          : [],
                        complexity: null,
                        labels: [],
                        epicId: null,
                      });
                      if (!issue) throw new Error(c.error);
                      await workspaceApi.link(
                        projectId,
                        { kind: "object", id },
                        { kind: "issue", id: issue.id },
                      );
                      return issue;
                    },
                    (issue) => {
                      setTask(false);
                      r.reload();
                      openIssue(issue.id, "panel");
                    },
                  )
                }
              >
                {c.create}
              </Button>
            }
          >
            <Input
              label={c.title}
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
            <ErrorNotice message={a.error} />
          </Dialog>
        </>
      )}
    </Dialog>
  );
}
