/** Настройки проекта → «Сроки и вехи» (ТЗ 5.15): даты начала и цели, вехи, проекты, которых этот ждёт — то, что
 *  рисует роадмап. Видят все участники; меняет роль с editRoadmap (администратор и менеджер), сервер проверяет
 *  право сам. Цикл зависимостей отклоняет сервер (409) — здесь показывается его объяснение. */
import { useCallback, useEffect, useState } from "react";
import type { RoadmapDto } from "../../../server/src/contract";
import { ApiError, roadmapApi } from "../../api";
import { useStore } from "../../store";
import { useT } from "../../i18n";
import { Button, Combobox, DatePicker, EmptyState, Input } from "../../ds";
import { IcFlag, IcPlus, IcTrash } from "../../icons";
import { ProjectMark } from "../../ui";
import { parseDay } from "../../roadmapLayout";
import { LIMITS } from "../../validation";
import { SettingRow, SettingsCard, SettingsPage } from "./parts";

export function ProjectRoadmap() {
  const { t, lang } = useT();
  const { data, toast, can, setView } = useStore();
  const projectId = data.currentProjectId;
  const editable = can("editRoadmap");
  const [rm, setRm] = useState<RoadmapDto | null | Error>(null);
  const reload = useCallback(() => {
    roadmapApi.get().then(setRm, (e: unknown) => setRm(e instanceof Error ? e : new Error(String(e))));
  }, []);
  useEffect(reload, [reload, projectId]);

  const [name, setName] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await job();
      if (ok) toast("success", ok);
      reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : t("roadmap.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const title = t("settings.project.roadmap");
  if (rm === null)
    return (
      <SettingsPage title={title} desc={t("settings.desc.roadmap")}>
        <div className="ds-sk h-24 w-full" aria-busy="true" />
      </SettingsPage>
    );
  if (rm instanceof Error)
    return (
      <SettingsPage title={title} desc={t("settings.desc.roadmap")}>
        <EmptyState icon={<IcFlag size={22} tone="teal" />} title={t("roadmap.loadError")} sub={rm.message} action={<Button size="sm" variant="secondary" onClick={reload}>{t("common.retry")}</Button>} />
      </SettingsPage>
    );
  const p = rm.projects.find((x) => x.id === projectId);
  if (!p) return null;

  const fmt = (s: string) => parseDay(s).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" });
  const setDates = (patch: { startDate?: string | null; targetDate?: string | null }) => void run(() => roadmapApi.setDates(p.id, patch));
  const waits = rm.dependencies.filter((d) => d.dependentId === p.id).map((d) => rm.projects.find((x) => x.id === d.sourceId)).filter((x) => !!x);
  const candidates = rm.projects.filter((x) => x.id !== p.id && !waits.some((w) => w.id === x.id));
  const addMilestone = () => {
    if (!name.trim() || !date) return;
    void run(async () => {
      await roadmapApi.addMilestone(p.id, { name: name.trim(), date });
      setName("");
      setDate(null);
    });
  };

  return (
    <SettingsPage title={title} desc={t("settings.desc.roadmap")}>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" iconLeft={<IcFlag size={14} tone="teal" />} onClick={() => setView("roadmap")}>
          {t("roadmap.open")}
        </Button>
      </div>
      <SettingsCard title={t("roadmap.dates")} footer={editable ? t("roadmap.datesHint") : t("roadmap.readOnly")}>
        <SettingRow label={t("roadmap.start")}>
          {editable ? (
            <DatePicker markOverdue={false} label={t("roadmap.start")} lang={lang} value={p.startDate} placeholder={t("roadmap.notSet")} clearLabel={t("roadmap.clearDate")} onChange={(v) => setDates({ startDate: v })} />
          ) : (
            <span className="text-[13px] text-sub">{p.startDate ? fmt(p.startDate) : t("roadmap.notSet")}</span>
          )}
        </SettingRow>
        <SettingRow label={t("roadmap.target")}>
          {editable ? (
            <DatePicker markOverdue={p.done < p.total} label={t("roadmap.target")} lang={lang} value={p.targetDate} placeholder={t("roadmap.notSet")} clearLabel={t("roadmap.clearDate")} onChange={(v) => setDates({ targetDate: v })} />
          ) : (
            <span className="text-[13px] text-sub">{p.targetDate ? fmt(p.targetDate) : t("roadmap.notSet")}</span>
          )}
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("roadmap.milestones")}>
        {p.milestones.length === 0 && <p className="px-5 py-4 text-[12.5px] text-faint">{t("roadmap.noMilestones")}</p>}
        {p.milestones.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-5 py-2.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rotate-45 rounded-[1px] bg-accent" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{m.name}</span>
            <span className="shrink-0 text-[12.5px] tabular text-sub">{fmt(m.date)}</span>
            {editable && (
              <Button size="sm" variant="ghost" aria-label={t("roadmap.removeMilestone", { name: m.name })} disabled={busy} onClick={() => void run(() => roadmapApi.removeMilestone(p.id, m.id))}>
                <IcTrash size={13} />
              </Button>
            )}
          </div>
        ))}
        {editable && (
          <form
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              addMilestone();
            }}
          >
            <div className="min-w-0 flex-1">
              <Input label={t("roadmap.milestoneName")} value={name} maxLength={LIMITS.milestone.name.max} onChange={(e) => setName(e.target.value)} />
            </div>
            <DatePicker markOverdue={false} label={t("roadmap.milestoneDate")} lang={lang} value={date} placeholder={t("roadmap.pickDate")} clearLabel={t("roadmap.clearDate")} onChange={setDate} />
            <Button type="submit" variant="secondary" iconLeft={<IcPlus size={13} />} disabled={!name.trim() || !date} loading={busy}>
              {t("roadmap.addMilestone")}
            </Button>
          </form>
        )}
      </SettingsCard>

      <SettingsCard title={t("roadmap.deps")} footer={t("roadmap.depsHint")}>
        {waits.length === 0 && <p className="px-5 py-4 text-[12.5px] text-faint">{t("roadmap.noDeps")}</p>}
        {waits.map((w) => (
          <div key={w.id} className="flex items-center gap-3 px-5 py-2.5">
            <ProjectMark projectKey={w.key} icon={w.icon} color={w.color} size={18} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{w.name}</span>
            <span className="shrink-0 text-[12px] tabular text-faint">{w.targetDate ? fmt(w.targetDate) : t("roadmap.notSet")}</span>
            {editable && (
              <Button size="sm" variant="ghost" aria-label={t("roadmap.removeDep", { name: w.name })} disabled={busy} onClick={() => void run(() => roadmapApi.removeDependency(p.id, w.id))}>
                <IcTrash size={13} />
              </Button>
            )}
          </div>
        ))}
        {editable && candidates.length > 0 && (
          <div className="px-5 py-4">
            <Combobox
              label={t("roadmap.addDep")}
              placeholder={t("roadmap.pickProject")}
              emptyText={t("roadmap.noProjectsFound")}
              load={async (q) => {
                const s = q.trim().toLowerCase();
                return candidates
                  .filter((c) => !s || c.name.toLowerCase().includes(s) || c.key.toLowerCase().includes(s))
                  .slice(0, 20)
                  .map((c) => ({ id: c.id, label: c.name, description: c.key, icon: <ProjectMark projectKey={c.key} icon={c.icon} color={c.color} size={16} /> }));
              }}
              onSelect={(o) => void run(() => roadmapApi.addDependency(p.id, o.id))}
            />
          </div>
        )}
      </SettingsCard>
    </SettingsPage>
  );
}
