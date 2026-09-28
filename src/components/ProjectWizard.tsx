/** Мастер создания проекта (ТЗ 5.10): шаблон с превью → название, ключ, иконка и цвет → доступ → фон и проверка.
 *  Проект, шаблон, участники и внешний вид создаются одним запросом и одной транзакцией на сервере
 *  (POST /api/projects с templateId, members, icon/color/background). Иконку предлагает шаблон; фон на последнем
 *  шаге сразу виден за окном мастера — и возвращается как был, если мастер закрыть. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { projectTemplatesApi, usersApi, type ProjectRole } from "../api";
import type { ProjectTemplateDto } from "../../server/src/contract";
import { Avatar, Button, Combobox, Dialog, Input, Switch, Tag, Textarea, type ComboOption } from "../ds";
import { StatusGlyph, IcX } from "../icons";
import { ProjectMark } from "../ui";
import { LIMITS } from "../validation";
import { projectBackground, setProjectBackground } from "../theme";
import type { ProjectBackground, ProjectColor, ProjectIcon } from "../projectLook";
import { BackgroundPicker, ColorPicker, IconPicker } from "./ProjectLookPicker";

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const TRANSLIT: Record<string, string> = { а: "A", б: "B", в: "V", г: "G", д: "D", е: "E", ё: "E", ж: "Z", з: "Z", и: "I", й: "I", к: "K", л: "L", м: "M", н: "N", о: "O", п: "P", р: "R", с: "S", т: "T", у: "U", ф: "F", х: "H", ц: "C", ч: "C", ш: "S", щ: "S", ы: "Y", э: "E", ю: "U", я: "Y" };

/** Ключ из названия: первые буквы слов (латиницей), для одного слова — его начало. «Найм и адаптация» → «NA». */
export function suggestKey(name: string, taken: Set<string>): string {
  const words = name
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((w) => w.length > 1 || /\d/.test(w));
  const lat = (w: string) => [...w].map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c.toUpperCase() : "")).join("");
  let base = words.length >= 2 ? words.slice(0, 4).map((w) => lat(w)[0] ?? "").join("") : lat(words[0] ?? "").slice(0, 4);
  base = base.replace(/^[0-9]+/, "");
  if (base.length < 2) base = (base + lat(words.join("")).slice(1, 4)).slice(0, 4);
  if (!KEY_RE.test(base)) return "";
  let key = base;
  for (let i = 2; taken.has(key) && i < 100; i++) key = `${base}${i}`.slice(0, 10);
  return key;
}

type Member = { userId: string; name: string; role: ProjectRole };
const STEPS = ["template", "name", "access", "review"] as const;

export default function ProjectWizard({ departmentId: initialDept, onClose }: { departmentId?: string; onClose: () => void }) {
  const { t } = useT();
  const { data, createProject, switchProject, setView } = useStore();
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<ProjectTemplateDto[] | null>(null);
  const [tplId, setTplId] = useState("builtin:blank");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [desc, setDesc] = useState("");
  const [dept, setDept] = useState(initialDept ?? data.departments[0]?.id ?? "");
  const [shared, setShared] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [icon, setIcon] = useState<ProjectIcon | null>(null);
  const [iconTouched, setIconTouched] = useState(false);
  const [color, setColor] = useState<ProjectColor | null>(null);
  const [bg, setBg] = useState<ProjectBackground | null>(null);

  useEffect(() => {
    projectTemplatesApi.list().then(setTemplates, () => setTemplates([]));
  }, []);
  const taken = useMemo(() => new Set(data.projects.map((p) => p.key)), [data.projects]);
  useEffect(() => {
    if (!keyTouched) setKey(suggestKey(name, taken));
  }, [name, keyTouched, taken]);

  const tpl = templates?.find((x) => x.id === tplId) ?? null;
  useEffect(() => {
    if (!iconTouched) setIcon(tpl?.spec.icon ?? null);
  }, [tpl, iconTouched]);

  // Живое превью фона за окном мастера; при закрытии — фон, который был до мастера.
  const bgBefore = useRef(projectBackground());
  useEffect(() => {
    const before = bgBefore.current;
    return () => setProjectBackground(before);
  }, []);
  useEffect(() => {
    setProjectBackground(step === 3 && bg ? bg : bgBefore.current);
  }, [step, bg]);
  const keyErr = !key ? undefined : !KEY_RE.test(key) ? t("wizard.keyFormat") : taken.has(key) ? t("wizard.keyTaken") : undefined;
  const canNext = [!!tpl, !!name.trim() && KEY_RE.test(key) && !taken.has(key), !!dept, true][step];

  const create = async () => {
    if (!tpl) return;
    setBusy(true);
    const p = await createProject({
      key,
      name: name.trim(),
      description: desc.trim(),
      departmentId: dept,
      isShared: shared,
      templateId: tpl.id,
      members: members.map((m) => ({ userId: m.userId, role: m.role })),
      icon,
      color,
      background: bg,
    });
    setBusy(false);
    if (!p) return;
    onClose();
    setView(p.defaultView ?? "board");
    switchProject(p.id);
  };

  const stepTitle = t(`wizard.step.${STEPS[step]}`);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      dismissable={false}
      title={t("wizard.title")}
      description={
        <span className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <span key={s} className={`flex items-center gap-1.5 ${i === step ? "font-semibold text-ink" : i < step ? "text-accenttext" : "text-faint"}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${i === step ? "bg-accent text-onaccent" : i < step ? "bg-accentsoft text-accenttext" : "bg-active text-faint"}`}>{i + 1}</span>
              <span className={i === step ? "" : "max-sm:hidden"}>{t(`wizard.step.${s}`)}</span>
              {i < STEPS.length - 1 && <span className="text-line2">—</span>}
            </span>
          ))}
        </span>
      }
      footer={
        <>
          <span className="mr-auto self-center text-[12px] text-faint">{t("wizard.stepOf", { n: step + 1, total: STEPS.length, title: stepTitle })}</span>
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              {t("wizard.back")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" disabled={canNext ? false : t("wizard.fillStep")} onClick={() => setStep(step + 1)}>
              {t("wizard.next")}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={() => void create()}>
              {t("wizard.create")}
            </Button>
          )}
        </>
      }
    >
      {step === 0 && (
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <div role="radiogroup" aria-label={t("wizard.step.template")} className="flex flex-col gap-1.5">
            {templates === null
              ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="ds-sk h-14" />)
              : templates.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="radio"
                    aria-checked={x.id === tplId}
                    onClick={() => setTplId(x.id)}
                    className="theme-choice ds-focus flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                  >
                    <ProjectMark projectKey={x.name} icon={x.spec.icon ?? null} color={x.id === tplId ? color : null} size={28} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        <span className="truncate">{x.name}</span>
                        {!x.builtin && (
                          <Tag tone="violet" size="sm">
                            {t("wizard.orgTemplate")}
                          </Tag>
                        )}
                      </span>
                      <span className="text-[11.5px] text-faint">{t("wizard.statusCount", { n: x.spec.statuses.length, fields: x.spec.customFields.length })}</span>
                    </span>
                  </button>
                ))}
          </div>
          {tpl && <TemplatePreview tpl={tpl} />}
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
          <Input label={t("settings.project.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.project.name.max} placeholder={tpl?.builtin && tpl.id !== "builtin:blank" ? tpl.name : t("wizard.namePlaceholder")} data-autofocus />
          <Input
            label={t("settings.project.key")}
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10));
            }}
            error={keyErr}
            hint={keyErr ? undefined : t("wizard.keyHint", { key: key || "KEY" })}
            right={<ProjectMark projectKey={key || "?"} icon={icon} color={color} size={18} />}
          />
          <div className="sm:col-span-2">
            <Textarea label={t("settings.project.description")} value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxChars={LIMITS.project.description.max} placeholder={t("settings.project.descriptionPlaceholder")} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="ds-label">{t("look.icon")}</span>
            <IconPicker
              projectKey={key}
              color={color}
              value={icon}
              onChange={(v) => {
                setIconTouched(true);
                setIcon(v);
              }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="ds-label">{t("look.color")}</span>
            <ColorPicker projectKey={key} value={color} onChange={setColor} />
          </div>
        </div>
      )}

      {step === 2 && <Access dept={dept} setDept={setDept} shared={shared} setShared={setShared} members={members} setMembers={setMembers} />}

      {step === 3 && tpl && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl bg-sunken/60 p-4 ring-1 ring-inset ring-linesoft">
            <ProjectMark projectKey={key} icon={icon} color={color} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-disp text-[17px] font-bold text-ink">{name.trim()}</p>
              <p className="text-[12.5px] text-faint">
                {key} · {data.departments.find((d) => d.id === dept)?.name}
                {shared && ` · ${t("settings.project.shared").toLowerCase()}`}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="ds-label">
              {t("look.background")} <span className="font-normal text-faint">· {t("wizard.optional")}</span>
            </span>
            <BackgroundPicker value={bg} onChange={setBg} />
            <span className="ds-hint">{t("look.bgHint")}</span>
          </div>
          <TemplatePreview tpl={tpl} compact />
          <p className="text-[12.5px] text-sub">{members.length ? t("wizard.membersSummary", { n: members.length, names: members.map((m) => m.name).join(", ") }) : t("wizard.noMembers")}</p>
        </div>
      )}
    </Dialog>
  );
}

function TemplatePreview({ tpl, compact }: { tpl: ProjectTemplateDto; compact?: boolean }) {
  const { t } = useT();
  const s = tpl.spec;
  const typeLabel = (x: string) => t(`wizard.fieldType.${x}` as "wizard.fieldType.text");
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl bg-sunken/50 p-4 ring-1 ring-inset ring-linesoft">
      {!compact && (
        <div>
          <p className="font-disp text-[16px] font-bold text-ink">{tpl.name}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-sub">{tpl.description}</p>
        </div>
      )}
      <div>
        <p className="ds-label mb-2">{t("wizard.statuses")}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {s.statuses.map((st, i) => (
            <span key={st.sid} className="flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-[12px] font-medium text-ink ring-1 ring-inset ring-linesoft">
              <StatusGlyph category={st.category} position={s.statuses.length > 1 ? i / (s.statuses.length - 1) : 0.5} size={12} />
              {st.name}
            </span>
          ))}
        </div>
      </div>
      {s.customFields.length > 0 && (
        <div>
          <p className="ds-label mb-2">{t("wizard.fields")}</p>
          <div className="flex flex-wrap gap-1.5">
            {s.customFields.map((f) => (
              <Tag key={f.name} tone="indigo" size="sm">
                {f.name} · {typeLabel(f.fieldType)}
              </Tag>
            ))}
          </div>
        </div>
      )}
      {s.issueTemplates.length > 0 && (
        <div>
          <p className="ds-label mb-2">{t("wizard.issueTemplates")}</p>
          <p className="text-[12.5px] text-sub">{s.issueTemplates.map((x) => x.name).join(" · ")}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-sub">
        <span>
          {t("wizard.opensOn")} <b className="font-semibold text-ink">{t(`sidebar.nav.${s.defaultView}` as "sidebar.nav.board")}</b>
        </span>
        {s.labels.length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            {t("wizard.labels")}
            {s.labels.map((l) => (
              <Tag key={l} tone="gray" size="sm" dot>
                {l}
              </Tag>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function Access({
  dept,
  setDept,
  shared,
  setShared,
  members,
  setMembers,
}: {
  dept: string;
  setDept: (v: string) => void;
  shared: boolean;
  setShared: (v: boolean) => void;
  members: Member[];
  setMembers: (m: Member[]) => void;
}) {
  const { t } = useT();
  const { data } = useStore();
  const load = useMemo(
    () => async (q: string): Promise<ComboOption[]> => {
      if (q.trim().length < 2) return [];
      const list = await usersApi.pickable(q.trim());
      return list.filter((u) => !members.some((m) => m.userId === u.id)).map((u) => ({ id: u.id, label: u.name, description: u.jobRole, icon: <Avatar person={{ name: u.name }} size={20} /> }));
    },
    [members],
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="ds-field">
          <span className="ds-label">{t("settings.project.department")}</span>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="ds-input ds-focus cursor-pointer text-[13px] font-medium">
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <span className="ds-hint">{t("settings.project.departmentHint")}</span>
        </label>
        <div className="pt-6">
          <Switch checked={shared} onChange={setShared} label={t("settings.project.shared")} description={t("settings.project.sharedHint")} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Combobox label={t("wizard.addMember")} placeholder={t("wizard.addMemberPlaceholder")} minChars={2} load={load} onSelect={(o) => setMembers([...members, { userId: o.id, name: o.label, role: "employee" }])} />
        {members.length > 0 && (
          <div className="mt-1 flex flex-col divide-y divide-linesoft rounded-xl ring-1 ring-inset ring-linesoft">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-3 py-2">
                <Avatar person={{ name: m.name }} size={24} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{m.name}</span>
                <select
                  aria-label={t("wizard.roleFor", { name: m.name })}
                  value={m.role}
                  onChange={(e) => setMembers(members.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as ProjectRole } : x)))}
                  className="ds-input ds-focus h-8 cursor-pointer text-[12.5px] font-medium"
                >
                  {(["manager", "employee", "viewer"] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}.name`)}
                    </option>
                  ))}
                </select>
                <button type="button" aria-label={t("wizard.removeMember", { name: m.name })} onClick={() => setMembers(members.filter((x) => x.userId !== m.userId))} className="ds-focus grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink">
                  <IcX size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="ds-hint">{t("wizard.membersHint")}</p>
      </div>
    </div>
  );
}
