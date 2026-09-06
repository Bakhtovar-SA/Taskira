import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { ProjectSummary } from "../types";
import { LIMITS } from "../validation";
import { IcInbox, IcLock, IcPlus, IcTrash } from "../icons";

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** Инлайн-переименование: input выглядит как текст, сохраняет по blur/Enter. */
function EditableName({ value, onSave, maxLength }: { value: string; onSave: (v: string) => void; maxLength: number }) {
  return (
    <input
      key={value}
      defaultValue={value}
      maxLength={maxLength}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = value;
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== value) onSave(v);
        else e.target.value = value;
      }}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] font-semibold text-ink hover:border-linesoft focus:border-accent focus:bg-white focus:outline-none"
    />
  );
}

export default function AdminView() {
  const {
    data,
    can,
    createDepartment,
    renameDepartment,
    deleteDepartment,
    createProject,
    patchProject,
    deleteProject,
    switchProject,
  } = useStore();
  const canManage = can("manageAccess");

  const byDept = useMemo(() => {
    const m: Record<string, ProjectSummary[]> = {};
    for (const p of data.projects) (m[p.departmentId] ??= []).push(p);
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.key.localeCompare(b.key));
    return m;
  }, [data.projects]);

  const [newDept, setNewDept] = useState("");
  const [forms, setForms] = useState<Record<string, { key: string; name: string }>>({});
  const form = (id: string) => forms[id] ?? { key: "", name: "" };
  const setForm = (id: string, patch: Partial<{ key: string; name: string }>) =>
    setForms((s) => ({ ...s, [id]: { ...form(id), ...patch } }));

  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <IcLock size={15} /> Раздел доступен только администратору ресурса.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-6 py-5">
        <div className="anim-fadeup">
          <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Департаменты и проекты</h1>
          <p className="mt-0.5 text-[11.5px] text-faint">
            Отдел = группа проектов. Проект по умолчанию виден только своим участникам; «общий» — видят все.
          </p>
        </div>

        {/* новый отдел */}
        <div className="anim-fadeup mt-4 flex items-center gap-2 rounded-xl border border-line bg-panel p-3 shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
          <input
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newDept.trim() && (createDepartment(newDept.trim()), setNewDept(""))}
            placeholder="Название нового отдела"
            maxLength={LIMITS.department.name.max}
            className="min-w-0 flex-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-[12.5px] focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => {
              createDepartment(newDept.trim());
              setNewDept("");
            }}
            disabled={!newDept.trim()}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <IcPlus size={13} /> Отдел
          </button>
        </div>

        {/* список отделов */}
        <div className="anim-fadeup mt-4 space-y-3" style={{ animationDelay: "60ms" }}>
          {data.departments.map((d) => {
            const projs = byDept[d.id] ?? [];
            const f = form(d.id);
            return (
              <section key={d.id} className="rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
                <header className="flex items-center gap-2 border-b border-linesoft bg-canvas/50 px-3 py-2">
                  <IcInbox size={15} className="shrink-0 text-accent" />
                  <EditableName value={d.name} onSave={(v) => renameDepartment(d.id, v)} maxLength={LIMITS.department.name.max} />
                  <span className="shrink-0 text-[11px] text-faint">{projs.length} проект(ов)</span>
                  <button
                    onClick={() =>
                      projs.length === 0 &&
                      window.confirm(`Удалить отдел «${d.name}»?`) &&
                      deleteDepartment(d.id)
                    }
                    disabled={projs.length > 0}
                    title={projs.length > 0 ? "Сначала удалите или перенесите проекты" : "Удалить отдел"}
                    className="shrink-0 rounded-md border border-line bg-white p-1.5 text-sub transition-colors hover:border-[#B42318] hover:text-[#B42318] disabled:opacity-30 disabled:hover:border-line disabled:hover:text-sub"
                  >
                    <IcTrash size={13} />
                  </button>
                </header>

                <div className="divide-y divide-linesoft">
                  {projs.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="w-16 shrink-0 rounded bg-[#e8edf4] px-1.5 py-0.5 text-center font-mono text-[10.5px] font-bold text-sub">
                        {p.key}
                      </span>
                      <EditableName value={p.name} onSave={(v) => patchProject(p.id, { name: v })} maxLength={LIMITS.project.name.max} />
                      <label className="flex shrink-0 items-center gap-1 text-[11px] text-sub">
                        <input
                          type="checkbox"
                          checked={p.isShared}
                          onChange={(e) => patchProject(p.id, { isShared: e.target.checked })}
                        />
                        общий
                      </label>
                      <button
                        onClick={() => switchProject(p.id)}
                        disabled={p.id === data.currentProjectId}
                        className="shrink-0 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                      >
                        {p.id === data.currentProjectId ? "открыт" : "Открыть"}
                      </button>
                      <button
                        onClick={() =>
                          window.confirm(`Удалить проект ${p.key} со всеми задачами? Действие необратимо.`) &&
                          deleteProject(p.id)
                        }
                        className="shrink-0 rounded-md border border-line bg-white p-1.5 text-sub transition-colors hover:border-[#B42318] hover:text-[#B42318]"
                      >
                        <IcTrash size={13} />
                      </button>
                    </div>
                  ))}

                  {/* новый проект в этом отделе */}
                  <div className="flex flex-wrap items-center gap-2 bg-canvas/40 px-3 py-2">
                    <input
                      value={f.key}
                      onChange={(e) => setForm(d.id, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                      placeholder="КЛЮЧ"
                      maxLength={10}
                      className="w-20 rounded-md border border-line bg-white px-2 py-1 font-mono text-[11px] uppercase focus:border-accent focus:outline-none"
                    />
                    <input
                      value={f.name}
                      onChange={(e) => setForm(d.id, { name: e.target.value })}
                      placeholder="Название проекта"
                      maxLength={LIMITS.project.name.max}
                      className="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-1 text-[11.5px] focus:border-accent focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        if (!KEY_RE.test(f.key) || !f.name.trim()) return;
                        createProject({ key: f.key, name: f.name.trim(), departmentId: d.id });
                        setForm(d.id, { key: "", name: "" });
                      }}
                      disabled={!KEY_RE.test(f.key) || !f.name.trim()}
                      className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      <IcPlus size={12} /> Проект
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
          {data.departments.length === 0 && (
            <p className="rounded-xl border border-dashed border-line bg-panel px-4 py-6 text-center text-[12px] text-faint">
              Отделов пока нет — создайте первый выше.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
