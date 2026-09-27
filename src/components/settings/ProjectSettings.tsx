/** Настройки проекта (IA §3.2): Общее, Модули, Архив и удаление. Раньше: название и «общий» — строкой в
 *  «Департаментах», описание и отдел — только через API, спринты — чекбоксом там же, архив — только по
 *  прямой ссылке, удаление — корзиной в списке отделов. Форма пишет теми же действиями стора, что и раньше
 *  (`patchProject`, `deleteProject`) — поведение настроек не меняется. */
import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { useT } from "../../i18n";
import { LIMITS } from "../../validation";
import { ApiError, issuesApi, projectTemplatesApi } from "../../api";
import { fmtDate } from "../../store/mappers";
import { Button, Dialog, EmptyState, Input, Switch, Textarea } from "../../ds";
import { IcArchive, IcTrash } from "../../icons";
import { SettingRow, SettingsCard, SettingsPage } from "./parts";

export function ProjectSection({ section }: { section: string }) {
  if (section === "modules") return <Modules />;
  if (section === "archive") return <Archive />;
  return <General />;
}

function useCurrentProject() {
  const { data } = useStore();
  const summary = data.projects.find((p) => p.id === data.currentProjectId);
  return { id: data.currentProjectId, key: data.project.key, name: data.project.name, description: data.project.description ?? "", departmentId: summary?.departmentId ?? "", isShared: !!summary?.isShared, sprintsEnabled: !!summary?.sprintsEnabled };
}

function General() {
  const { t } = useT();
  const { data, patchProject, can } = useStore();
  const p = useCurrentProject();
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description);
  useEffect(() => {
    setName(p.name);
    setDesc(p.description);
  }, [p.id, p.name, p.description]);

  const nameErr = !name.trim() ? t("settings.project.nameRequired") : undefined;
  const dirty = name.trim() !== p.name || desc.trim() !== p.description;
  const save = () => {
    if (nameErr || !dirty) return;
    const patch: { name?: string; description?: string } = {};
    if (name.trim() !== p.name) patch.name = name.trim();
    if (desc.trim() !== p.description) patch.description = desc.trim();
    patchProject(p.id, patch);
  };

  return (
    <SettingsPage title={t("settings.project.general")} desc={t("settings.desc.general")}>
      <SettingsCard
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty}
              onClick={() => {
                setName(p.name);
                setDesc(p.description);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={!dirty ? true : nameErr} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-[1fr_160px]">
          <Input label={t("settings.project.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.project.name.max} error={nameErr} />
          <Input label={t("settings.project.key")} value={p.key} readOnly disabled={t("settings.project.keyFixed")} />
          <div className="sm:col-span-2">
            <Textarea label={t("settings.project.description")} value={desc} onChange={(e) => setDesc(e.target.value)} maxChars={LIMITS.project.description.max} rows={4} placeholder={t("settings.project.descriptionPlaceholder")} />
          </div>
        </div>
      </SettingsCard>
      {can("saveProjectTemplate") && <SaveAsTemplate projectId={p.id} projectName={p.name} />}
      <SettingsCard>
        <SettingRow label={t("settings.project.department")} hint={t("settings.project.departmentHint")}>
          <select
            value={p.departmentId}
            onChange={(e) => e.target.value && e.target.value !== p.departmentId && patchProject(p.id, { departmentId: e.target.value })}
            aria-label={t("settings.project.department")}
            className="ds-input ds-focus min-w-[220px] cursor-pointer text-[13px] font-medium"
          >
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t("settings.project.shared")} hint={t("settings.project.sharedHint")}>
          <Switch checked={p.isShared} onChange={(v) => patchProject(p.id, { isShared: v })} />
        </SettingRow>
      </SettingsCard>
    </SettingsPage>
  );
}

function Modules() {
  const { t } = useT();
  const { patchProject } = useStore();
  const p = useCurrentProject();
  return (
    <SettingsPage title={t("settings.project.modules")} desc={t("settings.desc.modules")}>
      <SettingsCard>
        <div className="px-5 py-4">
          <Switch checked={p.sprintsEnabled} onChange={(v) => patchProject(p.id, { sprintsEnabled: v })} label={t("settings.project.sprints")} description={t("settings.project.sprintsDesc")} labelFirst />
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}

type ArchivedRow = { id: string; key: string; title: string; archivedAt: string | null };

function Archive() {
  const { t, lang } = useT();
  const { openIssue, deleteProject } = useStore();
  const p = useCurrentProject();
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");

  const load = (after?: string) =>
    issuesApi
      .list(p.id, { archived: 1, limit: 30, cursor: after })
      .then((res) => {
        const items = res.items.map((i) => ({ id: i.id, key: i.key, title: i.title, archivedAt: i.archivedAt ?? null }));
        setRows((prev) => (after ? [...(prev ?? []), ...items] : items));
        setCursor(res.hasMore ? res.nextCursor : null);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитать при смене проекта
  }, [p.id]);

  return (
    <SettingsPage title={t("settings.project.archive")} desc={t("settings.desc.archive")}>
      <SettingsCard title={t("settings.project.archivedIssues")}>
        {failed ? (
          <p className="px-5 py-6 text-[12.5px] text-[var(--status-danger-fg)]">{t("settings.project.archiveFailed")}</p>
        ) : rows === null ? (
          <div className="flex flex-col gap-2 px-5 py-5" aria-hidden="true">
            <div className="ds-sk h-4 w-2/3" />
            <div className="ds-sk h-4 w-1/2" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<IcArchive size={22} tone="gray" />} title={t("settings.project.archiveEmpty")} sub={t("settings.project.archiveEmptySub")} />
        ) : (
          <>
            {rows.map((r) => (
              <button key={r.id} type="button" onClick={() => openIssue(r.id, "page")} className="ds-focus flex h-11 items-center gap-3 px-5 text-left transition-colors hover:bg-hover/60">
                <span className="w-[76px] shrink-0 font-mono text-[12px] text-faint">{r.key}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{r.title}</span>
                {r.archivedAt && <span className="shrink-0 text-[12px] tabular text-faint">{fmtDate(r.archivedAt.slice(0, 10), lang)}</span>}
              </button>
            ))}
            {cursor && (
              <div className="px-5 py-3">
                <Button size="sm" variant="ghost" onClick={() => void load(cursor)}>
                  {t("settings.project.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </SettingsCard>

      <section className="rounded-xl p-5 ring-1 ring-inset ring-[color-mix(in_oklch,var(--status-danger)_35%,transparent)]">
        <h2 className="text-[13px] font-semibold text-[var(--status-danger-fg)]">{t("settings.project.dangerZone")}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-sub">{t("settings.project.deleteHint")}</p>
          <Button variant="danger" iconLeft={<IcTrash size={14} />} onClick={() => setConfirm(true)}>
            {t("settings.project.delete")}
          </Button>
        </div>
      </section>

      <Dialog
        open={confirm}
        onClose={() => {
          setConfirm(false);
          setTyped("");
        }}
        title={t("settings.project.deleteTitle", { name: p.name })}
        description={t("admin.deleteProjectConfirm", { key: p.key })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" disabled={typed.trim().toUpperCase() !== p.key ? t("settings.project.typeKey", { key: p.key }) : false} onClick={() => deleteProject(p.id)}>
              {t("settings.project.delete")}
            </Button>
          </>
        }
      >
        <Input label={t("settings.project.typeKey", { key: p.key })} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={p.key} autoComplete="off" />
      </Dialog>
    </SettingsPage>
  );
}

/** «Сохранить проект как шаблон» (ТЗ 5.10): статусы, переходы, поля, шаблоны задач, метки и представление по
 *  умолчанию уходят в шаблоны организации; задачи и участники — нет. Право — saveProjectTemplate, проверяет сервер. */
function SaveAsTemplate({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useT();
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await projectTemplatesApi.saveFromProject(projectId, { name: name.trim(), description: desc.trim() });
      toast("success", t("settings.project.templateSaved", { name: name.trim() }));
      setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("settings.org.saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsCard>
      <SettingRow label={t("settings.project.saveAsTemplate")} hint={t("settings.project.saveAsTemplateHint")}>
        <Button
          variant="secondary"
          onClick={() => {
            setName(projectName);
            setDesc("");
            setErr(null);
            setOpen(true);
          }}
        >
          {t("settings.project.saveAsTemplateBtn")}
        </Button>
      </SettingRow>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("settings.project.saveAsTemplate")}
        description={t("settings.project.saveAsTemplateHint")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} disabled={name.trim() ? false : t("settings.project.nameRequired")} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label={t("settings.project.templateName")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={err ?? undefined} data-autofocus />
          <Textarea label={t("settings.project.description")} value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxChars={300} />
        </div>
      </Dialog>
    </SettingsCard>
  );
}

