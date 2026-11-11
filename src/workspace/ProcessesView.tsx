import { Disclosure, Checkbox } from "./shared";
import { workspaceHistoryText } from "../i18n/workspace";
import { ProcessGraph } from "./ProcessGraph";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type {
  ProcessTemplate,
  ProcessTemplateBody,
  ProcessStep,
  Conditions,
  AutomationRuleBody,
  AutomationRule,
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
  Textarea,
  Select,
  Dialog,
  UserSelect,
  UserChecks,
  MaterialLinks,
  ErrorNotice,
  Empty,
  Loading,
  Tabs,
  ConditionsEditor,
} from "./shared";
import "./workspace.css";
const emptyStep = (n: number): ProcessStep => ({
  key: `step_${n}`,
  title: "",
  description: "",
  dependsOn: [],
  complexity: null,
  dueInDays: null,
  assigneeIds: [],
  reviewerId: null,
  documentVersionId: null,
  when: { mode: "all", items: [] },
});
export default function ProcessesView() {
  const { projectId, c, manageProcesses } = useWorkspace();
  const enabled = useModuleEnabled("processes"),
    [runId, selectRun] = useSelected("run");
  const [tab, setTab] = useState<"templates" | "runs" | "rules">("templates"),
    [designer, setDesigner] = useState<{
      template: ProcessTemplate | null;
    } | null>(null),
    [start, setStart] = useState<ProcessTemplate | null>(null);
  const templates = useResource(
    (s) => workspaceApi.templates(projectId, s),
    [projectId],
  );
  const runs = useResource((s) => workspaceApi.runs(projectId, s), [projectId]);
  const a = useAction();
  return (
    <Frame
      title={c.processes}
      hint={c.processesHint}
      actions={
        manageProcesses &&
        enabled && (
          <Button
            variant="primary"
            onClick={() => setDesigner({ template: null })}
          >
            {c.newProcess}
          </Button>
        )
      }
    >
      <ModuleBanner module="processes" />
      <Tabs
        value={tab}
        onChange={setTab}
        items={(["templates", "runs", "rules"] as const).map((value) => ({
          value,
          label: c[value],
        }))}
      />
      <ErrorNotice message={templates.error ?? runs.error ?? a.error} />
      {runId ? (
        <RunDetail
          key={runId}
          id={runId}
          enabled={enabled}
          onClose={() => selectRun(null)}
        />
      ) : tab === "templates" ? (
        templates.loading ? (
          <Loading />
        ) : !templates.data?.items.length ? (
          <Empty>{c.noTemplates}</Empty>
        ) : (
          <div className="workspace-list">
            {templates.data.items.map((t) => (
              <section className="workspace-section" key={t.id}>
                <div className="workspace-actions">
                  <h2>{t.name}</h2>
                  <small>{t.publishedVersionId ? c.published : c.draft}</small>
                </div>
                <p className="workspace-muted">{t.draft.description}</p>
                <p className="workspace-muted">
                  {c.steps}: {t.draft.steps.length}
                </p>
                {manageProcesses && enabled && (
                  <div className="workspace-actions">
                    <Button onClick={() => setDesigner({ template: t })}>
                      {c.edit}
                    </Button>
                    <Button
                      disabled={!t.publishedVersionId || t.archived}
                      onClick={() => setStart(t)}
                    >
                      {c.start}
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </div>
        )
      ) : tab === "runs" ? (
        <div className="workspace-list">
          {runs.data?.items.map((r) => (
            <button key={r.id} onClick={() => selectRun(r.id)}>
              {r.title} · {c[r.state]}
              {r.error ? ` · ${r.error}` : ""}
            </button>
          ))}
          {!runs.data?.items.length && <Empty />}
        </div>
      ) : (
        <Rules enabled={enabled} />
      )}
      {designer && (
        <ProcessDesigner
          initial={designer.template}
          onClose={() => setDesigner(null)}
          onSave={() => templates.reload()}
        />
      )}{" "}
      {start && (
        <StartProcess
          template={start}
          onClose={() => setStart(null)}
          onStarted={(id) => {
            setStart(null);
            runs.reload();
            selectRun(id);
          }}
        />
      )}
    </Frame>
  );
}
function InstructionVersion({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { projectId, c } = useWorkspace();
  const docs = useResource(
    (s) => workspaceApi.documents(projectId, s),
    [projectId],
  );
  const [doc, setDoc] = useState("");
  const versions = useResource(
    (s) =>
      doc
        ? workspaceApi.versions(projectId, doc, 0, s)
        : Promise.resolve({ items: [] }),
    [projectId, doc],
  );
  return (
    <div className="workspace-form">
      <Select
        aria-label={c.document}
        value={doc}
        onChange={setDoc}
        options={[
          { value: "", label: c.none },
          ...(docs.data?.items ?? [])
            .filter((d) => !d.archived)
            .map((d) => ({ value: d.id, label: d.title })),
        ]}
      />
      <Select
        aria-label={c.instructionVersion}
        value={value ?? ""}
        onChange={(v) => onChange(v || null)}
        options={[
          { value: "", label: c.none },
          ...(versions.data?.items ?? []).map((v) => ({
            value: v.id,
            label: v.name || new Date(v.createdAt).toLocaleString(),
          })),
          ...(value && !versions.data?.items.some((v) => v.id === value)
            ? [{ value, label: c.instructionVersion }]
            : []),
        ]}
      />
    </div>
  );
}
function ProcessDesigner({
  initial,
  onClose,
  onSave,
}: {
  initial: ProcessTemplate | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { projectId, c } = useWorkspace();
  const [current, setCurrent] = useState(initial),
    [spec, setSpec] = useState<ProcessTemplateBody>(
      initial?.draft ?? { name: "", description: "", steps: [emptyStep(1)] },
    ),
    [selected, setSelected] = useState(0),
    [preview, setPreview] = useState(false);
  const a = useAction();
  const step = spec.steps[selected];
  const update = (patch: Partial<ProcessStep>) =>
    setSpec((s) => ({
      ...s,
      steps: s.steps.map((v, i) => (i === selected ? { ...v, ...patch } : v)),
    }));
  const save = async () => {
    const saved = await workspaceApi.saveTemplate(
      projectId,
      current?.id ?? null,
      spec,
      current?.revision,
    );
    setCurrent(saved);
    onSave();
    return saved;
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={spec.name || c.newProcess}
      size="xl"
      footer={
        <>
          <Button onClick={() => setPreview(!preview)}>{c.preview}</Button>
          <Button loading={a.busy} onClick={() => void a.run(save)}>
            {c.save}
          </Button>
          <Button
            variant="primary"
            loading={a.busy}
            onClick={() =>
              void a.run(
                async () => {
                  const saved = await save();
                  await workspaceApi.publish(projectId, saved.id);
                  return (await workspaceApi.templates(projectId)).items.find(
                    (t) => t.id === saved.id,
                  )!;
                },
                (saved) => {
                  setCurrent(saved);
                  onSave();
                },
              )
            }
          >
            {c.publish}
          </Button>
        </>
      }
    >
      <div className="workspace-form">
        <Input
          label={c.name}
          value={spec.name}
          onChange={(e) => setSpec({ ...spec, name: e.target.value })}
        />
        <Textarea
          label={c.description}
          value={spec.description}
          onChange={(e) => setSpec({ ...spec, description: e.target.value })}
        />
        <ErrorNotice message={a.error} />
        <ProcessGraph
          steps={spec.steps}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="workspace-split">
          <div>
            <div className="workspace-step-list">
              {spec.steps.map((s, i) => (
                <button
                  className="workspace-step"
                  key={i}
                  aria-current={i === selected}
                  onClick={() => setSelected(i)}
                >
                  <strong>
                    {i + 1}. {s.title || s.key}
                  </strong>
                  <small>{s.dependsOn.join(", ") || c.start}</small>
                </button>
              ))}
            </div>
            <Button
              onClick={() => {
                const n = spec.steps.length + 1;
                setSpec({ ...spec, steps: [...spec.steps, emptyStep(n)] });
                setSelected(n - 1);
              }}
            >
              {c.addStep}
            </Button>
          </div>
          {step && (
            <section className="workspace-section workspace-form">
              <Input
                label={c.title}
                value={step.title}
                onChange={(e) => update({ title: e.target.value })}
              />
              <Input
                label={c.stepKey}
                value={step.key}
                onChange={(e) => {
                  const previous = step.key,
                    next = e.target.value;
                  setSpec({
                    ...spec,
                    steps: spec.steps.map((v, i) =>
                      i === selected
                        ? { ...v, key: next }
                        : {
                            ...v,
                            dependsOn: v.dependsOn.map((k) =>
                              k === previous ? next : k,
                            ),
                          },
                    ),
                  });
                }}
              />
              <Textarea
                label={c.description}
                value={step.description}
                onChange={(e) => update({ description: e.target.value })}
              />
              <fieldset className="workspace-checks">
                <legend>{c.dependsOn}</legend>
                {spec.steps
                  .filter((_, i) => i !== selected)
                  .map((s) => (
                    <Checkbox
                      key={s.key}
                      label={s.title || s.key}
                      checked={step.dependsOn.includes(s.key)}
                      onChange={(checked) =>
                        update({
                          dependsOn: checked
                            ? [...step.dependsOn, s.key]
                            : step.dependsOn.filter((k) => k !== s.key),
                        })
                      }
                    />
                  ))}
              </fieldset>
              <Select
                aria-label={c.complexity}
                value={step.complexity ?? ""}
                onChange={(v) => update({ complexity: v || null })}
                options={[
                  { value: "", label: c.unestimated },
                  ...(["simple", "medium", "hard"] as const).map((v) => ({
                    value: v,
                    label: c[v],
                  })),
                ]}
              />
              <Input
                type="number"
                min="0"
                max="365"
                label={c.dueInDays}
                value={step.dueInDays ?? ""}
                onChange={(e) =>
                  update({
                    dueInDays:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <UserChecks
                label={c.assignees}
                membersOnly
                value={step.assigneeIds}
                onChange={(v) => update({ assigneeIds: v })}
              />
              <UserSelect
                label={c.reviewer}
                value={step.reviewerId}
                onChange={(v) => update({ reviewerId: v })}
              />
              <InstructionVersion
                value={step.documentVersionId}
                onChange={(v) => update({ documentVersionId: v })}
              />
              <ConditionsEditor
                value={step.when}
                onChange={(when) => update({ when })}
              />
              {spec.steps.length > 1 && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setSpec({
                      ...spec,
                      steps: spec.steps
                        .filter((_, i) => i !== selected)
                        .map((s) => ({
                          ...s,
                          dependsOn: s.dependsOn.filter((k) => k !== step.key),
                        })),
                    });
                    setSelected(0);
                  }}
                >
                  {c.remove}
                </Button>
              )}
            </section>
          )}
        </div>
        {preview && (
          <section className="workspace-section">
            <h2>{c.preview}</h2>
            <ol className="workspace-step-list">
              {spec.steps.map((s) => (
                <li key={s.key} className="workspace-step">
                  <h3>{s.title}</h3>
                  <p>{s.description}</p>
                  <small>
                    {c.dependsOn}: {s.dependsOn.join(", ") || c.none} ·{" "}
                    {c.complexity}:{" "}
                    {s.complexity ? c[s.complexity] : c.unestimated}
                  </small>
                  {s.reviewerId && <small>{c.reviewer}</small>}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </Dialog>
  );
}
function StartProcess({
  template,
  onClose,
  onStarted,
}: {
  template: ProcessTemplate;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const { projectId, c, data } = useWorkspace();
  const [title, setTitle] = useState(template.name),
    [objectId, setObjectId] = useState(""),
    [assignees, setAssignees] = useState<string[]>(
      data.members[data.currentUserId] ? [data.currentUserId] : [],
    ),
    [parameters, setParameters] = useState<{ key: string; value: string }[]>(
      [],
    );
  const [requestId] = useState(() => crypto.randomUUID());
  const objects = useResource(
    (s) => workspaceApi.objects(projectId, {}, s),
    [projectId],
  );
  const published = useResource(
    () => workspaceApi.preview(projectId, template.id),
    [projectId, template.id],
  );
  const a = useAction();
  return (
    <Dialog
      open
      onClose={onClose}
      title={c.start}
      description={c.confirmStart}
      size="lg"
      footer={
        <Button
          variant="primary"
          loading={a.busy}
          disabled={
            !published.data ||
            !!published.error ||
            !!published.data.errors.length
          }
          onClick={() =>
            void a.run(
              () =>
                workspaceApi.startRun(projectId, {
                  templateId: template.id,
                  title,
                  objectId: objectId || null,
                  assigneeIds: assignees,
                  parameters: Object.fromEntries(
                    parameters
                      .filter((p) => p.key)
                      .map((p) => [p.key, p.value]),
                  ),
                  requestId,
                }),
              (run) => onStarted(run.id),
            )
          }
        >
          {c.start}
        </Button>
      }
    >
      <ErrorNotice message={published.error} />
      <div className="workspace-form">
        <Input
          label={c.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Select
          aria-label={c.processObject}
          value={objectId}
          onChange={setObjectId}
          options={[
            { value: "", label: c.none },
            ...(objects.data?.items ?? [])
              .filter((o) => !o.archived)
              .map((o) => ({ value: o.id, label: o.title })),
          ]}
        />
        <UserChecks
          label={c.assignees}
          membersOnly
          value={assignees}
          onChange={setAssignees}
        />
        <section>
          <h3>{c.parameters}</h3>
          {parameters.map((p, i) => (
            <div key={i} className="workspace-condition">
              <Input
                label={c.parameterKey}
                value={p.key}
                onChange={(e) =>
                  setParameters(
                    parameters.map((p, n) =>
                      n === i ? { ...p, key: e.target.value } : p,
                    ),
                  )
                }
              />
              <Input
                label={c.parameterValue}
                value={p.value}
                onChange={(e) =>
                  setParameters(
                    parameters.map((p, n) =>
                      n === i ? { ...p, value: e.target.value } : p,
                    ),
                  )
                }
              />
              <Button
                onClick={() =>
                  setParameters(parameters.filter((_, n) => n !== i))
                }
              >
                {c.remove}
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              setParameters([...parameters, { key: "", value: "" }])
            }
          >
            {c.add}
          </Button>
        </section>
        <ol className="workspace-step-list">
          {(published.data?.steps ?? []).map((s, i) => (
            <li key={s.key} className="workspace-step">
              <h3>
                {i + 1}. {s.title}
              </h3>
              <small>
                {c.dependsOn}: {s.dependsOn.join(", ") || c.none}
              </small>
            </li>
          ))}
        </ol>
        <ErrorNotice message={a.error} />
      </div>
    </Dialog>
  );
}
function RunDetail({
  id,
  enabled,
  onClose,
}: {
  id: string;
  enabled: boolean;
  onClose: () => void;
}) {
  const { projectId, c, lang, manageProcesses, data } = useWorkspace();
  const { openIssue } = useStore();
  const r = useResource(
    (s) => workspaceApi.run(projectId, id, s),
    [projectId, id],
  );
  const a = useAction();
  const [review, setReview] = useState<{
      stepId: string;
      action: "approve" | "return";
    } | null>(null),
    [reason, setReason] = useState("");
  useEffect(() => {
    const timer = setInterval(r.reload, 5000);
    return () => clearInterval(timer);
  }, [r.reload]);
  const run = r.data;
  if (!run)
    return (
      <>
        <ErrorNotice message={r.error} />
        <Loading />
      </>
    );
  return (
    <>
      <div className="workspace-actions">
        <Button onClick={() => exportMaterial(run, `process-${id}.json`)}>
          {c.export}
        </Button>
        <Button onClick={onClose}>{c.back}</Button>
        <h2>{run.title}</h2>
        <span>{c[run.state]}</span>
        {manageProcesses &&
          enabled &&
          run.state !== "completed" &&
          run.state !== "cancelled" && (
            <>
              <Button
                loading={a.busy}
                onClick={() =>
                  void a.run(
                    () =>
                      workspaceApi.controlRun(
                        projectId,
                        id,
                        run.state === "paused" ? "resume" : "pause",
                      ),
                    r.reload,
                  )
                }
              >
                {run.state === "paused" ? c.resume : c.pause}
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  void a.run(
                    () => workspaceApi.controlRun(projectId, id, "cancel"),
                    r.reload,
                  )
                }
              >
                {c.stop}
              </Button>
            </>
          )}
      </div>
      <p className="workspace-muted">{c.runHint}</p>
      <ErrorNotice message={r.error ?? a.error ?? run.error} />
      <div className="workspace-document-layout">
        <ol className="workspace-step-list">
          {run.steps.map((s) => (
            <li className="workspace-step" data-state={s.state} key={s.id}>
              <div className="workspace-actions">
                <h3>{s.title}</h3>
                <span>{c[s.state]}</span>
              </div>
              <small>
                {c.dependsOn}: {s.dependsOn.join(", ") || c.none}
              </small>
              {s.issueId && (
                <button
                  className="workspace-text-link"
                  onClick={() => openIssue(s.issueId, "panel")}
                >
                  {s.issueKey}
                </button>
              )}
              {s.state === "review" &&
                enabled &&
                (manageProcesses || s.reviewerId === data.currentUserId) && (
                  <div className="workspace-actions">
                    <Button
                      onClick={() =>
                        setReview({ stepId: s.id, action: "approve" })
                      }
                    >
                      {c.approve}
                    </Button>
                    <Button
                      onClick={() =>
                        setReview({ stepId: s.id, action: "return" })
                      }
                    >
                      {c.returnWork}
                    </Button>
                  </div>
                )}
            </li>
          ))}
        </ol>
        <aside>
          <MaterialLinks
            source={{ kind: "process", id }}
            editable={manageProcesses && enabled}
          />
          <section className="workspace-section">
            <h3>{c.history}</h3>
            {run.log.map((l) => (
              <div key={l.id} className="workspace-comment">
                <small>{new Date(l.createdAt).toLocaleString()}</small>
                <p>{workspaceHistoryText(l.action, lang)}</p>
                {typeof l.detail.key === "string" && (
                  <small>{l.detail.key}</small>
                )}
              </div>
            ))}
          </section>
        </aside>
      </div>
      <Dialog
        open={!!review}
        onClose={() => setReview(null)}
        title={review?.action === "return" ? c.returnWork : c.approve}
        footer={
          <Button
            loading={a.busy}
            onClick={() => {
              if (review)
                void a.run(
                  () =>
                    workspaceApi.review(
                      projectId,
                      id,
                      review.stepId,
                      review.action,
                      reason,
                    ),
                  () => {
                    setReview(null);
                    setReason("");
                    r.reload();
                  },
                );
            }}
          >
            {c.save}
          </Button>
        }
      >
        <Textarea
          label={c.reason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorNotice message={a.error} />
      </Dialog>
    </>
  );
}
function Rules({ enabled }: { enabled: boolean }) {
  const { projectId, c, manageProcesses } = useWorkspace();
  const r = useResource((s) => workspaceApi.rules(projectId, s), [projectId]);
  const [journal, setJournal] = useState<AutomationRule | null>(null);
  const [editing, setEditing] = useState<{
    rule: AutomationRule | null;
  } | null>(null);
  return (
    <>
      <div className="workspace-actions">
        {manageProcesses && enabled && (
          <Button onClick={() => setEditing({ rule: null })}>
            {c.newRule}
          </Button>
        )}
      </div>
      <ErrorNotice message={r.error} />
      {r.data?.items.map((rule) => (
        <section className="workspace-section" key={rule.id}>
          <h2>{rule.name}</h2>
          <p className="workspace-muted">
            {rule.event} · {rule.enabled ? c.enabled : c.pause}
          </p>
          <ErrorNotice message={rule.error} />
          <Button onClick={() => setJournal(rule)}>{c.history}</Button>
          {manageProcesses && enabled && (
            <Button onClick={() => setEditing({ rule })}>{c.edit}</Button>
          )}
        </section>
      ))}
      {journal && (
        <RuleJournal
          rule={journal}
          enabled={enabled}
          onClose={() => setJournal(null)}
        />
      )}
      {editing && (
        <RuleForm
          initial={editing.rule}
          onClose={() => setEditing(null)}
          onSave={() => {
            r.reload();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
function RuleForm({
  initial,
  onClose,
  onSave,
}: {
  initial: AutomationRule | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { projectId, c } = useWorkspace();
  const [name, setName] = useState(initial?.name ?? ""),
    [event, setEvent] = useState<AutomationRuleBody["event"]>(
      initial?.event ?? "issue.statusChanged",
    ),
    [when, setWhen] = useState<Conditions>(
      initial?.when ?? { mode: "all", items: [] },
    ),
    [actions, setActions] = useState<AutomationRuleBody["actions"]>(
      initial?.actions ?? [
        { type: "createIssue", title: "", complexity: null, assigneeIds: [] },
      ],
    ),
    [enabled, setEnabled] = useState(initial?.enabled ?? false),
    [preview, setPreview] = useState<string | null>(null),
    [testField, setTestField] = useState("priorityId"),
    [testValue, setTestValue] = useState("high");
  const templates = useResource(
    (s) => workspaceApi.templates(projectId, s),
    [projectId],
  );
  const a = useAction();
  const body: AutomationRuleBody = { name, event, when, actions, enabled };
  const eventLabels = {
    "issue.created": c.issueCreated,
    "issue.updated": c.issueUpdated,
    "issue.statusChanged": c.statusChanged,
    "issue.due": c.due,
    "step.completed": c.stepCompleted,
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={c.newRule}
      size="lg"
      footer={
        <Button
          loading={a.busy}
          onClick={() =>
            void a.run(
              () => workspaceApi.saveRule(projectId, initial?.id ?? null, body),
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
        <Select
          aria-label={c.event}
          value={event}
          onChange={setEvent}
          options={Object.entries(eventLabels).map(([value, label]) => ({
            value: value as AutomationRuleBody["event"],
            label,
          }))}
        />
        <ConditionsEditor value={when} onChange={setWhen} />
        {actions.map((action, index) => (
          <fieldset className="workspace-section workspace-form" key={index}>
            <Select
              aria-label={c.action}
              value={action.type}
              onChange={(type) => {
                const next: AutomationRuleBody["actions"][number] =
                  type === "createIssue"
                    ? { type, title: "", complexity: null, assigneeIds: [] }
                    : type === "updateIssue"
                      ? { type, priorityId: "high" }
                      : type === "notify"
                        ? { type, userIds: [], message: "" }
                        : { type, templateId: "", title: "" };
                setActions(actions.map((v, i) => (i === index ? next : v)));
              }}
              options={[
                { value: "createIssue", label: c.createIssueAction },
                { value: "updateIssue", label: c.updateIssueAction },
                { value: "notify", label: c.notifyAction },
                { value: "startProcess", label: c.startProcessAction },
              ]}
            />
            {(action.type === "createIssue" ||
              action.type === "startProcess") && (
              <Input
                label={c.title}
                value={action.title}
                onChange={(e) =>
                  setActions(
                    actions.map((v, i) =>
                      i === index ? { ...action, title: e.target.value } : v,
                    ),
                  )
                }
              />
            )}{" "}
            {action.type === "createIssue" && (
              <UserChecks
                label={c.assignees}
                membersOnly
                value={action.assigneeIds}
                onChange={(assigneeIds) =>
                  setActions(
                    actions.map((v, i) =>
                      i === index ? { ...action, assigneeIds } : v,
                    ),
                  )
                }
              />
            )}{" "}
            {action.type === "updateIssue" && (
              <>
                <Select
                  aria-label={c.priority}
                  value={action.priorityId ?? "medium"}
                  onChange={(priorityId) =>
                    setActions(
                      actions.map((v, i) =>
                        i === index ? { ...action, priorityId } : v,
                      ),
                    )
                  }
                  options={["low", "medium", "high", "critical"].map((v) => ({
                    value: v as "low" | "medium" | "high" | "critical",
                    label: v,
                  }))}
                />
                <UserChecks
                  label={c.assignees}
                  membersOnly
                  value={action.assigneeIds ?? []}
                  onChange={(assigneeIds) =>
                    setActions(
                      actions.map((v, i) =>
                        i === index ? { ...action, assigneeIds } : v,
                      ),
                    )
                  }
                />
              </>
            )}
            {action.type === "notify" && (
              <>
                <Textarea
                  label={c.comment}
                  value={action.message}
                  onChange={(e) =>
                    setActions(
                      actions.map((v, i) =>
                        i === index
                          ? { ...action, message: e.target.value }
                          : v,
                      ),
                    )
                  }
                />
                <UserChecks
                  label={c.assignees}
                  membersOnly
                  value={action.userIds}
                  onChange={(userIds) =>
                    setActions(
                      actions.map((v, i) =>
                        i === index ? { ...action, userIds } : v,
                      ),
                    )
                  }
                />
              </>
            )}
            {action.type === "startProcess" && (
              <Select
                aria-label={c.templates}
                value={action.templateId}
                onChange={(templateId) =>
                  setActions(
                    actions.map((v, i) =>
                      i === index ? { ...action, templateId } : v,
                    ),
                  )
                }
                options={(templates.data?.items ?? [])
                  .filter((t) => t.publishedVersionId)
                  .map((t) => ({ value: t.id, label: t.name }))}
              />
            )}
            <Button
              variant="ghost"
              disabled={actions.length === 1}
              onClick={() => setActions(actions.filter((_, i) => i !== index))}
            >
              {c.remove}
            </Button>
          </fieldset>
        ))}
        <Button
          onClick={() =>
            setActions([
              ...actions,
              {
                type: "createIssue",
                title: "",
                complexity: null,
                assigneeIds: [],
              },
            ])
          }
        >
          {c.add}
        </Button>
        <Checkbox
          label={c.enabled}
          checked={enabled}
          onChange={(checked) => setEnabled(checked)}
        />
        <Disclosure title={c.rulePreview}>
          <Input
            label={c.conditionField}
            value={testField}
            onChange={(e) => setTestField(e.target.value)}
          />
          <Input
            label={c.value}
            value={testValue}
            onChange={(e) => setTestValue(e.target.value)}
          />
          <Button
            onClick={() =>
              void a.run(
                () =>
                  workspaceApi.previewRule(projectId, body, {
                    [testField]: testValue,
                  }),
                (result) =>
                  setPreview(
                    `${result.matches ? c.matches : c.notMatches}: ${result.actions.length}`,
                  ),
              )
            }
          >
            {c.preview}
          </Button>
          {preview && <p role="status">{preview}</p>}
        </Disclosure>
        <ErrorNotice message={a.error} />
      </div>
    </Dialog>
  );
}

function RuleJournal({
  rule,
  enabled,
  onClose,
}: {
  rule: AutomationRule;
  enabled: boolean;
  onClose: () => void;
}) {
  const { projectId, c, manageProcesses } = useWorkspace();
  const r = useResource(
    (s) => workspaceApi.executions(projectId, rule.id, s),
    [projectId, rule.id],
  );
  const a = useAction();
  return (
    <Dialog open title={`${c.history} · ${rule.name}`} onClose={onClose}>
      <ErrorNotice message={r.error ?? a.error} />
      {r.data?.items.map((e) => (
        <section className="workspace-section" key={e.eventId}>
          <strong>{new Date(e.createdAt).toLocaleString()}</strong>
          <p>{e.error ?? (e.processedAt ? c.completed : c.waiting)}</p>
          <ol>
            {e.actions.map((action) => (
              <li key={action.key}>
                {(
                  {
                    createIssue: c.createIssueAction,
                    updateIssue: c.updateIssueAction,
                    notify: c.notifyAction,
                    startProcess: c.startProcessAction,
                  } as Record<string, string>
                )[action.type] ?? c.action}
              </li>
            ))}
          </ol>
          {e.error && enabled && manageProcesses && (
            <Button
              loading={a.busy}
              onClick={() =>
                void a.run(
                  () =>
                    workspaceApi.retryExecution(projectId, rule.id, e.eventId),
                  r.reload,
                )
              }
            >
              {c.retry}
            </Button>
          )}
        </section>
      ))}
      {r.data?.items.length === 0 && <Empty />}
    </Dialog>
  );
}
