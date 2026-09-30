import { Button, IconButton } from "../ds/Button";
import { Input, Textarea } from "../ds/Field";
import { StatusTag } from "./settings/parts";
import { useState } from "react";
import { useStore } from "../store";
import { NO_ISSUE_FILTERS, useIssueCounts, useIssuesRevision } from "../issuePages";
import type { CustomFieldType, IssueTypeId, PriorityId, Transition } from "../types";
import { IcChevR, IcFlow, IcLock, IcPencil, IcPlus, IcTrash, IcUndo, StatusGlyph } from "../icons";

import { useT } from "../i18n";
import { LIMITS } from "../validation";
import { workflowStatusName } from "../workflowStatus";
import { layoutWorkflow } from "../workflowLayout";

/* POS/PATHS — заготовленная схема для 4 дефолтных статусов (ключи — стабильные sid, не uuid).
   Любой другой набор статусов раскладывает workflowLayout.ts. */
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

type Box = { x: number; y: number; w: number; h: number; lines?: string[] };
type Layout = { standard: boolean; boxes: Map<string, Box>; viewBox: string; edge?: (from: string, to: string) => string };

/** Стандартные четыре статуса — заготовленная схема как в Jira; свои статусы (проект из шаблона) —
 *  послойная раскладка из workflowLayout.ts. */
function layoutFor(statuses: { id: string; sid: string; name: string; category: "todo" | "inprogress" | "done" }[], transitions: Transition[], nameOf: (s: (typeof statuses)[number]) => string): Layout {
  const standard = statuses.length === 4 && statuses.every((s) => POS[s.sid]);
  if (standard) return { standard, boxes: new Map(statuses.map((s) => [s.id, POS[s.sid]])), viewBox: "0 -62 980 422" };
  const l = layoutWorkflow(statuses.map((s) => ({ ...s, name: nameOf(s) })), transitions);
  return { standard, ...l };
}

function edgePath(t: Transition, sidOf: (id: string) => string, layout: Layout) {
  if (layout.edge) return layout.edge(t.from, t.to);
  return PATHS[`${sidOf(t.from)}>${sidOf(t.to)}`] ?? "";
}

export default function WorkflowView({ part = "workflow" }: { part?: "workflow" | "templates" | "fields" }) {
  const { t } = useT();
  const {
    data,
    addTransition,
    removeTransition,
    resetWorkflow,
    addIssueTemplate,
    updateIssueTemplateAction,
    removeIssueTemplate,
    addCustomField,
    renameCustomField,
    removeCustomField,
    toast,
    can,
    setView,
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
  /** Шаблон, открытый на правку в той же форме (INVENTORY 1.2 №12); null — форма создаёт новый. */
  const [tplEditId, setTplEditId] = useState<string | null>(null);
  /** Поле, переименовываемое прямо в строке списка (INVENTORY 1.2 №13). */
  const [fieldEdit, setFieldEdit] = useState<{ id: string; name: string } | null>(null);

  const sidById = new Map(statuses.map((s) => [s.id, s.sid]));
  const sidOf = (id: string) => sidById.get(id) ?? "";
  const layout = layoutFor(statuses, data.workflow.transitions, (s) => workflowStatusName(s, t));
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

  const resetTemplateForm = () => {
    setTplEditId(null);
    setTplName("");
    setTplType("task");
    setTplPriority("medium");
    setTplTitle("");
    setTplDescription("");
    setTplStatusId("");
  };
  const editTemplate = (id: string) => {
    const tpl = data.issueTemplates.find((x) => x.id === id);
    if (!tpl) return;
    setTplEditId(id);
    setTplName(tpl.name);
    setTplType(tpl.typeId);
    setTplPriority(tpl.priorityId);
    setTplTitle(tpl.title);
    setTplDescription(tpl.description);
    setTplStatusId(tpl.statusId ?? "");
  };
  const submitTemplate = () => {
    if (!tplName.trim()) return;
    const input = {
      name: tplName,
      typeId: tplType,
      priorityId: tplPriority,
      title: tplTitle,
      description: tplDescription,
      statusId: tplStatusId || null,
    };
    if (tplEditId) updateIssueTemplateAction(tplEditId, input);
    else addIssueTemplate(input);
    resetTemplateForm();
  };
  const saveFieldName = () => {
    if (!fieldEdit) return;
    const f = data.customFields.find((x) => x.id === fieldEdit.id);
    const name = fieldEdit.name.trim();
    if (f && name && name !== f.name) renameCustomField(f.id, name);
    setFieldEdit(null);
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
            <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t(part === "workflow" ? "workflow.title" : part === "templates" ? "settings.project.templates" : "settings.project.fields")}</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {t("workflow.subtitle", { key: data.project.key, count: data.workflow.transitions.length })}
            </p>
          </div>
          {canEditWf && part === "workflow" && layout.standard && (
            <Button variant="secondary" size="sm" onClick={resetWorkflow} className="ml-auto h-8 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
              <IcUndo size={13} /> {t("workflow.reset")}
            </Button>
          )}
        </div>

        {part === "workflow" && (<>
        {/* граф */}
        <div className="mt-4 overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70">
          <div className="flex items-center gap-2 border-b border-linesoft bg-sunken px-4 py-2.5">
            <IcFlow size={14} className="text-accent" />
            <span className="text-[13px] font-medium text-sub">{t("workflow.map")}</span>
            <span className="ml-auto text-[11px] text-faint">{t("workflow.mapHint")}</span>
          </div>
          <svg viewBox={layout.viewBox} className="block w-full">
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
                    d={edgePath(t, sidOf, layout)}
                    fill="none"
                    className={`wf-edge ${active ? "is-on" : ""}`}
                    markerEnd={`url(#${active ? "arrA" : "arr"})`}
                  />
                );
              })}
            </g>
            {data.workflow.statuses.map((s, i, all) => {
              const p = layout.boxes.get(s.id);
              if (!p) return null;
              const on = active2(hover, data.workflow.transitions, s.id);
              return (
                <g key={s.id} className={`wf-node wf-${s.category} ${on ? "is-on" : ""}`}>
                  <rect className="wf-node-box" x={p.x} y={p.y} width={p.w} height={p.h} rx="14" />
                  <rect className="wf-node-wash" x={p.x} y={p.y} width={p.w} height={p.h} rx="14" fill={`url(#wf-wash-${s.category})`} />
                  <g transform={`translate(${p.x + 18} ${p.y + (p.lines && p.lines.length > 1 ? 13 : 20)})`}>
                    <StatusGlyph category={s.category} position={all.length > 1 ? i / (all.length - 1) : 0.5} size={16} />
                  </g>
                  {p.lines ? (
                    <>
                      {p.lines.map((line, li) => (
                        <text key={li} x={p.x + 44} y={p.y + (p.lines!.length > 1 ? 25 : 31) + li * 17} className="wf-node-name">{line}</text>
                      ))}
                      <text x={p.x + 44} y={p.y + (p.lines.length > 1 ? 60 : 51)} className="wf-node-count">{t("workflow.issueCount", { count: countBy(s.id) })}</text>
                    </>
                  ) : (
                    <>
                      <text x={p.x + 44} y={p.y + 33} className="wf-node-name">{workflowStatusName(s, t)}</text>
                      <text x={p.x + 44} y={p.y + 54} className="wf-node-count">{t("workflow.issueCount", { count: countBy(s.id) })}</text>
                    </>
                  )}
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
                  <StatusTag status={a} size="sm" />
                  <IcChevR size={13} className={hover === transition.id ? "text-accent" : "text-faint"} />
                  <StatusTag status={b} size="sm" />
                  <span className="ml-auto tabular text-[10.5px] text-faint">{countBy(transition.from)} → {countBy(transition.to)}</span>
                  {canEditWf && (
                    <IconButton variant="ghost" size="sm" label={t("workflow.deleteTransition")}
                      onClick={() => removeTransition(transition.id)}
                      className="h-6 w-6"

                    >
                      <IcTrash size={13} />
                    </IconButton>
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
              <Button variant="primary" size="sm"
                onClick={submit}
                className="w-full [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
              >
                <IcPlus size={13} /> {t("workflow.addTransition")}
              </Button>
              <Button variant="ghost" size="sm"
                onClick={() => setView("docs")}
                className="w-full [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
              >
                {t("workflow.how")}
              </Button>
            </div>
            </>
            )}
          </div>
        </div>

        </>)}
        {part === "templates" && (<>
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
                  <IconButton variant="ghost" size="sm" label={t("workflow.editTemplate", { name: template.name })}
                    onClick={() => editTemplate(template.id)}
                    aria-pressed={tplEditId === template.id}
                    className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-hover hover:text-ink ${tplEditId === template.id ? "text-accent" : "text-faint"}`}

                  >
                    <IcPencil size={13} />
                  </IconButton>
                )}
                {canEditWf && (
                  <IconButton variant="ghost" size="sm" label={t("workflow.deleteTemplate")}
                    onClick={() => {
                      if (tplEditId === template.id) resetTemplateForm();
                      removeIssueTemplate(template.id);
                    }}
                    className="h-6 w-6 shrink-0"

                  >
                    <IcTrash size={13} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>

          {canEditWf && (
            <div className="h-fit surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-4">
              <p className="text-[13px] font-medium text-sub">{tplEditId ? t("workflow.editingTemplate") : t("workflow.newTemplate")}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{tplEditId ? t("workflow.editingTemplateHint") : t("workflow.newTemplateHint")}</p>
              <div className="mt-3 space-y-2.5">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.templateName")}</span>
                  <div className="w-full"><Input aria-label={t("workflow.templateNamePlaceholder")}
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder={t("workflow.templateNamePlaceholder")}

                  /></div>
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
                  <div className="w-full"><Input aria-label={t("workflow.defaultTitlePlaceholder")} maxLength={LIMITS.title.max}
                    value={tplTitle}
                    onChange={(e) => setTplTitle(e.target.value)}
                    placeholder={t("workflow.defaultTitlePlaceholder")}

                  /></div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-faint">{t("workflow.defaultDescription")}</span>
                  <div className="w-full"><Textarea maxChars={LIMITS.description.max} maxLength={LIMITS.description.max}
                    value={tplDescription}
                    onChange={(e) => setTplDescription(e.target.value)}
                    rows={3}

                  /></div>
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
                <Button variant="primary" size="sm"
                  onClick={submitTemplate}
                  disabled={!tplName.trim()}
                  className="w-full [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                >
                  {tplEditId ? t("workflow.saveTemplate") : <><IcPlus size={13} /> {t("workflow.addTemplate")}</>}
                </Button>
                {tplEditId && (
                  <Button variant="ghost" size="sm" onClick={resetTemplateForm} className="w-full [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
                    {t("common.cancel")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        </>)}
        {part === "fields" && (<>
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
                {fieldEdit?.id === f.id ? (
                  <div className="min-w-0 max-w-[260px] flex-1"><Input
                    autoFocus
                    value={fieldEdit.name}
                    maxLength={LIMITS.customField.name.max}
                    aria-label={t("workflow.renameField", { name: f.name })}
                    onChange={(e) => setFieldEdit({ id: f.id, name: e.target.value })}
                    onBlur={saveFieldName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveFieldName();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setFieldEdit(null);
                      }
                    }}

                  /></div>
                ) : (
                  <span className="text-[13px] font-medium text-ink">{f.name}</span>
                )}
                <span className="rounded-md bg-sunken px-1.5 py-0.5 tabular text-[11.5px] text-sub ring-1 ring-inset ring-linesoft">
                  {t(`fieldType.${f.fieldType}`)}
                </span>
                {f.fieldType === "select" && f.options.length > 0 && (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{f.options.join(", ")}</span>
                )}
                {canEditWf && fieldEdit?.id !== f.id && (
                  <IconButton variant="ghost" size="sm" label={t("workflow.renameField", { name: f.name })}
                    onClick={() => setFieldEdit({ id: f.id, name: f.name })}
                    className="ml-auto h-6 w-6 shrink-0"

                  >
                    <IcPencil size={13} />
                  </IconButton>
                )}
                {canEditWf && (
                  <IconButton variant="ghost" size="sm" label={t("workflow.deleteField")}
                    onClick={() => removeCustomField(f.id)}
                    className="h-6 w-6 shrink-0"

                  >
                    <IcTrash size={13} />
                  </IconButton>
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
                  <div className="w-full"><Input aria-label={t("workflow.fieldNamePlaceholder")}
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    placeholder={t("workflow.fieldNamePlaceholder")}

                  /></div>
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
                    <div className="w-full"><Input aria-label={t("workflow.optionsPlaceholder")}
                      value={fieldOptions}
                      onChange={(e) => setFieldOptions(e.target.value)}
                      placeholder={t("workflow.optionsPlaceholder")}

                    /></div>
                  </label>
                )}
                <Button variant="primary" size="sm"
                  onClick={submitField}
                  disabled={!fieldName.trim() || (fieldType === "select" && !fieldOptions.trim())}
                  className="w-full [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
                >
                  <IcPlus size={13} /> {t("workflow.addField")}
                </Button>
              </div>
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}

function active2(hover: string | null, trs: Transition[], sid: string) {
  if (!hover) return false;
  const t = trs.find((x) => x.id === hover);
  return !!t && (t.from === sid || t.to === sid);
}
