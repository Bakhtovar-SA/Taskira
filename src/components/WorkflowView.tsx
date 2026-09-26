import { useState } from "react";
import { useStore } from "../store";
import { NO_ISSUE_FILTERS, useIssueCounts, useIssuesRevision } from "../issuePages";
import type { CustomFieldType, IssueTypeId, PriorityId, Transition } from "../types";
import { IcChevR, IcFlow, IcLock, IcPlus, IcTrash, IcUndo, StatusGlyph } from "../icons";
import { Lozenge } from "../ui";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";

/* POS/PATHS рассчитаны ТОЛЬКО на 4 дефолтных статуса (ключи — стабильные sid,
   не uuid). Статус сверх стандартных четырёх просто не отрисуется — если появится
   возможность добавлять свои статусы, эту визуализацию нужно доработать
   (taskira-review §1.4). */
const POS: Record<string, { x: number; y: number; w: number; h: number }> = {
  todo: { x: 40, y: 140, w: 190, h: 76 },
  inprogress: { x: 390, y: 32, w: 190, h: 76 },
  review: { x: 390, y: 248, w: 190, h: 76 },
  done: { x: 750, y: 140, w: 190, h: 76 },
};

/* заранее проложенные маршруты стрелок, чтобы схема читалась как в Jira */
const PATHS: Record<string, string> = {
  "todo>inprogress": "M230,158 C305,140 315,72 384,70",
  "todo>done": "M230,178 L744,178",
  "inprogress>todo": "M388,92 C310,112 292,192 236,192",
  "inprogress>review": "M497,108 C522,150 522,208 497,242",
  "review>inprogress": "M471,248 C447,206 447,148 471,114",
  "review>done": "M580,286 C662,286 682,206 744,196",
  "inprogress>done": "M580,56 C660,42 690,124 744,152",
  // «Готово → В работе» — единственная длинная обратная дуга. Идёт над схемой
  // с запасом (у svg viewBox добавлено 62px сверху, чтобы дуга не жалась к
  // краю и не «терялась») и входит СТРОГО вертикально в верх «В работе»
  // (cp2.x = конечная x) — наконечник садится на кромку блока.
  "done>inprogress": "M814,138 C884,-42 486,-48 486,32",
};

/** t.from/t.to — реальные uuid статусов; POS/PATHS ключуются по sid, поэтому
 *  нужен резолвер uuid→sid. */
function edgePath(t: Transition, sidOf: (id: string) => string) {
  const fromSid = sidOf(t.from);
  const toSid = sidOf(t.to);
  const key = `${fromSid}>${toSid}`;
  if (PATHS[key]) return PATHS[key];
  const a = POS[fromSid] ?? POS.todo;
  const b = POS[toSid] ?? POS.done;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return `M${ax},${ay} Q${(ax + bx) / 2},${Math.min(ay, by) - 60} ${bx},${by}`;
}

export default function WorkflowView() {
  const { t } = useT();
  const {
    data,
    addTransition,
    removeTransition,
    resetWorkflow,
    addIssueTemplate,
    removeIssueTemplate,
    addCustomField,
    removeCustomField,
    toast,
    can,
  } = useStore();
  const canEditWf = can("editWorkflow");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [fieldOptions, setFieldOptions] = useState("");
  const statuses = data.workflow.statuses;
  const bySid = (sid: string) => statuses.find((s) => s.sid === sid)?.id;
  // from/to хранят реальные uuid статусов (значения <option>), не sid.
  const [from, setFrom] = useState(() => bySid("todo") ?? statuses[0]?.id ?? "");
  const [to, setTo] = useState(() => bySid("review") ?? statuses[1]?.id ?? statuses[0]?.id ?? "");
  const [formErr, setFormErr] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  const [tplName, setTplName] = useState("");
  const [tplType, setTplType] = useState<IssueTypeId>("task");
  const [tplPriority, setTplPriority] = useState<PriorityId>("medium");
  const [tplTitle, setTplTitle] = useState("");
  const [tplDescription, setTplDescription] = useState("");
  const [tplStatusId, setTplStatusId] = useState("");

  const sidById = new Map(statuses.map((s) => [s.id, s.sid]));
  const sidOf = (id: string) => sidById.get(id) ?? "";
  // Число задач в статусе — агрегат по проекту (счётчики сервера), а не обход
  // всех задач на клиенте (PERF-06); до ответа — многоточие, а не ложный 0.
  const { counts: statusCounts } = useIssueCounts(data.currentProjectId || null, NO_ISSUE_FILTERS, useIssuesRevision());
  const countBy = (statusId: string): number | string => (statusCounts ? (statusCounts.byStatus[statusId] ?? 0) : "…");
  const stName = (id: string) => statuses.find((s) => s.id === id);

  const submit = () => {
    const err = addTransition(from, to);
    if (err) setFormErr(err);
    else {
      setFormErr("");
      setTo(statuses.find((s) => s.id !== from)?.id ?? from);
    }
  };

  const submitTemplate = () => {
    if (!tplName.trim()) return;
    addIssueTemplate({
      name: tplName,
      typeId: tplType,
      priorityId: tplPriority,
      title: tplTitle,
      description: tplDescription,
      statusId: tplStatusId || null,
    });
    setTplName("");
    setTplTitle("");
    setTplDescription("");
    setTplStatusId("");
  };

  const submitField = () => {
    const options = fieldOptions
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    addCustomField(fieldName, fieldType, options);
    setFieldName("");
    setFieldOptions("");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] min-[1536px]:max-w-[1320px] min-[1920px]:max-w-[1600px] px-6 py-5">
        <div className="flex items-end gap-3">
          <div>
            <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t("workflow.title")}</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {t("workflow.subtitle", { key: data.project.key, count: data.workflow.transitions.length })}
            </p>
          </div>
          {canEditWf && (
            <button onClick={resetWorkflow} className="ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel shadow-e1 px-3 text-[12.5px] font-semibold text-sub transition-colors hover:bg-hover hover:text-ink">
              <IcUndo size={13} /> {t("workflow.reset")}
            </button>
          )}
        </div>

        {/* граф */}
        <div className="mt-4 overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70">
          <div className="flex items-center gap-2 border-b border-linesoft bg-sunken px-4 py-2.5">
            <IcFlow size={14} className="text-accent" />
            <span className="text-[13px] font-medium text-sub">{t("workflow.map")}</span>
            <span className="ml-auto text-[11px] text-faint">{t("workflow.mapHint")}</span>
          </div>
          <svg viewBox="0 -62 980 422" className="block w-full">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M1,1.2 9,5 1,8.8Q2.4,5 1,1.2z" fill="var(--border-strong)" />
              </marker>
              <marker id="arrA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M1,1.2 9,5 1,8.8Q2.4,5 1,1.2z" fill="var(--accent-solid)" />
              </marker>
              {/* Мягкая заливка узла цветом его категории — слева направо, в ноль. */}
              {(["todo", "inprogress", "done"] as const).map((cat) => (
                <linearGradient key={cat} id={`wf-wash-${cat}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor={cat === "done" ? "var(--status-done)" : cat === "inprogress" ? "var(--status-progress)" : "var(--status-todo)"} stopOpacity="0.14" />
                  <stop offset="0.6" stopColor={cat === "done" ? "var(--status-done)" : cat === "inprogress" ? "var(--status-progress)" : "var(--status-todo)"} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            <g className="pointer-events-none">
              {data.workflow.transitions.map((t) => {
                const active = hover === t.id;
                return (
                  <path
                    key={t.id}
                    d={edgePath(t, sidOf)}
                    fill="none"
                    className={`wf-edge ${active ? "is-on" : ""}`}
                    markerEnd={`url(#${active ? "arrA" : "arr"})`}
                  />
                );
              })}
            </g>
            {data.workflow.statuses.map((s, i, all) => {
              const p = POS[s.sid]; // POS ключуется по sid, не uuid (§1.4)
              if (!p) return null;
              const on = active2(hover, data.workflow.transitions, s.id);
              return (
                <g key={s.id} className={`wf-node wf-${s.category} ${on ? "is-on" : ""}`}>
                  <rect className="wf-node-box" x={p.x} y={p.y} width={p.w} height={p.h} rx="14" />
                  <rect className="wf-node-wash" x={p.x} y={p.y} width={p.w} height={p.h} rx="14" fill={`url(#wf-wash-${s.category})`} />
                  <g transform={`translate(${p.x + 18} ${p.y + 20})`}>
                    <StatusGlyph category={s.category} position={all.length > 1 ? i / (all.length - 1) : 0.5} size={16} />
                  </g>
                  <text x={p.x + 44} y={p.y + 33} className="wf-node-name">{workflowStatusName(s, t)}</text>
                  <text x={p.x + 44} y={p.y + 54} className="wf-node-count">{t("workflow.issueCount", { count: countBy(s.id) })}</text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* список переходов */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70">
            <p className="border-b border-linesoft bg-sunken px-4 py-2.5 text-[13px] font-medium text-sub">{t("workflow.allowed")}</p>
            {data.workflow.transitions.length === 0 && (
              <p className="px-4 py-6 text-center text-[12.5px] text-faint">{t("workflow.noTransitions")}</p>
            )}
            {data.workflow.transitions.map((transition) => {
              const a = stName(transition.from);
              const b = stName(transition.to);
              if (!a || !b) return null;
              return (
                <div
                  key={transition.id}
                  onMouseEnter={() => setHover(transition.id)}
                  onMouseLeave={() => setHover(null)}
                  className={`flex items-center gap-3 border-b border-linesoft px-4 py-2.5 transition-colors last:border-0 ${hover === transition.id ? "bg-accentsoft" : "hover:bg-hover"}`}
                >
                  <Lozenge status={a} size="sm" />
                  <IcChevR size={13} className={hover === transition.id ? "text-accent" : "text-faint"} />
                  <Lozenge status={b} size="sm" />
                  <span className="ml-auto tabular text-[10.5px] text-faint">{countBy(transition.from)} → {countBy(transition.to)}</span>
                  {canEditWf && (
                    <button
                      onClick={() => removeTransition(transition.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-dangersoft hover:text-danger"
                      aria-label={t("workflow.deleteTransition")}
                    >
                      <IcTrash size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="h-fit surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-4">
            {!canEditWf ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <IcLock size={22} className="text-faint" />
                <p className="text-[13px] font-semibold text-sub">{t("workflow.readOnly")}</p>
                <p className="text-[11.5px] leading-relaxed text-faint">
                  {t("workflow.readOnlyHint")}
                </p>
              </div>
            ) : (
            <>
            <p className="text-[13px] font-medium text-sub">{t("workflow.newTransition")}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{t("workflow.newTransitionHint")}</p>
            <div className="mt-3 space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.fromStatus")}</span>
                <select value={from} onChange={(e) => setFrom(e.target.value)} className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus">
                  {data.workflow.statuses.map((s) => (
                    <option key={s.id} value={s.id}>{workflowStatusName(s, t)}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.toStatus")}</span>
                <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus">
                  {data.workflow.statuses.map((s) => (
                    <option key={s.id} value={s.id}>{workflowStatusName(s, t)}</option>
                  ))}
                </select>
              </label>
              {formErr && <p className="rounded bg-dangersoft px-2.5 py-1.5 text-[11.5px] font-semibold text-danger">{formErr}</p>}
              <button
                onClick={submit}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg btn-primary px-3 py-2 text-[12.5px] font-medium text-onaccent transition-all active:scale-[0.98]"
              >
                <IcPlus size={13} /> {t("workflow.addTransition")}
              </button>
              <button
                onClick={() => toast("info", t("workflow.helpToast"))}
                className="w-full rounded-md px-3 py-1.5 text-[11.5px] font-semibold text-faint hover:text-accent"
              >
                {t("workflow.how")}
              </button>
            </div>
            </>
            )}
          </div>
        </div>

        {/* шаблоны задач проекта (issue_templates, миграция 022) */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70">
            <p className="border-b border-linesoft bg-sunken px-4 py-2.5 text-[13px] font-medium text-sub">
              {t("workflow.templatesCount", { count: data.issueTemplates.length })}
            </p>
            {data.issueTemplates.length === 0 && (
              <p className="px-4 py-6 text-center text-[12.5px] text-faint">{t("workflow.noTemplates")}</p>
            )}
            {data.issueTemplates.map((template) => (
              <div key={template.id} className="flex items-center gap-3 border-b border-linesoft px-4 py-2.5 last:border-0 hover:bg-hover">
                <span className="text-[13px] font-medium text-ink">{template.name}</span>
                <span className="rounded-md bg-sunken px-1.5 py-0.5 tabular text-[11.5px] text-sub ring-1 ring-inset ring-linesoft">
                  {t(`issueType.${template.typeId}`)}
                </span>
                <span className="rounded-md bg-sunken px-1.5 py-0.5 tabular text-[11.5px] text-sub ring-1 ring-inset ring-linesoft">
                  {t(`priority.${template.priorityId}`)}
                </span>
                {canEditWf && (
                  <button
                    onClick={() => removeIssueTemplate(template.id)}
                    className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-dangersoft hover:text-danger"
                    aria-label={t("workflow.deleteTemplate")}
                  >
                    <IcTrash size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canEditWf && (
            <div className="h-fit surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-4">
              <p className="text-[13px] font-medium text-sub">{t("workflow.newTemplate")}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{t("workflow.newTemplateHint")}</p>
              <div className="mt-3 space-y-2.5">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.templateName")}</span>
                  <input
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder={t("workflow.templateNamePlaceholder")}
                    className="w-full rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-faint">{t("field.type")}</span>
                    <select
                      value={tplType}
                      onChange={(e) => setTplType(e.target.value as IssueTypeId)}
                      className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                    >
                      {(["task", "bug", "request"] as IssueTypeId[]).map((v) => (
                        <option key={v} value={v}>{t(`issueType.${v}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-faint">{t("field.priority")}</span>
                    <select
                      value={tplPriority}
                      onChange={(e) => setTplPriority(e.target.value as PriorityId)}
                      className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                    >
                      {(["critical", "high", "medium", "low"] as PriorityId[]).map((v) => (
                        <option key={v} value={v}>{t(`priority.${v}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.defaultTitle")}</span>
                  <input
                    value={tplTitle}
                    onChange={(e) => setTplTitle(e.target.value)}
                    placeholder={t("workflow.defaultTitlePlaceholder")}
                    className="w-full rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.defaultDescription")}</span>
                  <textarea
                    value={tplDescription}
                    onChange={(e) => setTplDescription(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.startStatus")}</span>
                  <select
                    value={tplStatusId}
                    onChange={(e) => setTplStatusId(e.target.value)}
                    className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                  >
                    <option value="">{t("workflow.asUsual")}</option>
                    {data.workflow.statuses.map((s) => (
                      <option key={s.id} value={s.id}>{workflowStatusName(s, t)}</option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={submitTemplate}
                  disabled={!tplName.trim()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg btn-primary px-3 py-2 text-[12.5px] font-medium text-onaccent transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IcPlus size={13} /> {t("workflow.addTemplate")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* пользовательские поля проекта (custom_fields, миграция 020) */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70">
            <p className="border-b border-linesoft bg-sunken px-4 py-2.5 text-[13px] font-medium text-sub">
              {t("workflow.fieldsCount", { count: data.customFields.length })}
            </p>
            {data.customFields.length === 0 && (
              <p className="px-4 py-6 text-center text-[12.5px] text-faint">{t("workflow.noFields")}</p>
            )}
            {data.customFields.map((f) => (
              <div key={f.id} className="flex items-center gap-3 border-b border-linesoft px-4 py-2.5 last:border-0 hover:bg-hover">
                <span className="text-[13px] font-medium text-ink">{f.name}</span>
                <span className="rounded-md bg-sunken px-1.5 py-0.5 tabular text-[11.5px] text-sub ring-1 ring-inset ring-linesoft">
                  {t(`fieldType.${f.fieldType}`)}
                </span>
                {f.fieldType === "select" && f.options.length > 0 && (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{f.options.join(", ")}</span>
                )}
                {canEditWf && (
                  <button
                    onClick={() => removeCustomField(f.id)}
                    className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-dangersoft hover:text-danger"
                    aria-label={t("workflow.deleteField")}
                  >
                    <IcTrash size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canEditWf && (
            <div className="h-fit surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-4">
              <p className="text-[13px] font-medium text-sub">{t("workflow.newField")}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{t("workflow.newFieldHint")}</p>
              <div className="mt-3 space-y-2.5">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("sprints.name")}</span>
                  <input
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    placeholder={t("workflow.fieldNamePlaceholder")}
                    className="w-full rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("field.type")}</span>
                  <select
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
                    className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                  >
                    {(["text", "number", "select", "checkbox", "date"] as CustomFieldType[]).map((fieldTypeOption) => (
                      <option key={fieldTypeOption} value={fieldTypeOption}>{t(`fieldType.${fieldTypeOption}`)}</option>
                    ))}
                  </select>
                </label>
                {fieldType === "select" && (
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.options")}</span>
                    <input
                      value={fieldOptions}
                      onChange={(e) => setFieldOptions(e.target.value)}
                      placeholder={t("workflow.optionsPlaceholder")}
                      className="w-full rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                    />
                  </label>
                )}
                <button
                  onClick={submitField}
                  disabled={!fieldName.trim() || (fieldType === "select" && !fieldOptions.trim())}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg btn-primary px-3 py-2 text-[12.5px] font-medium text-onaccent transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IcPlus size={13} /> {t("workflow.addField")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function active2(hover: string | null, trs: Transition[], sid: string) {
  if (!hover) return false;
  const t = trs.find((x) => x.id === hover);
  return !!t && (t.from === sid || t.to === sid);
}
