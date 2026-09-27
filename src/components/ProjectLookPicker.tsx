/** Выбор внешнего вида проекта (ТЗ 5.10: мастер, шаги 2 и 4; настройки проекта → Общее): иконка, цвет, фон.
 *  Все три — radiogroup: стрелки не нужны, но выбранный пункт читается скринридером. */
import { useT } from "../i18n";
import { BG_PRESETS, effectiveTheme } from "../theme";
import { ProjectMark, projectTone } from "../ui";
import { PROJECT_BG_IDS, PROJECT_COLOR_IDS, PROJECT_ICON_IDS, type ProjectBackground, type ProjectColor, type ProjectIcon } from "../projectLook";

export function IconPicker({ projectKey, color, value, onChange }: { projectKey: string; color: ProjectColor | null; value: ProjectIcon | null; onChange: (v: ProjectIcon | null) => void }) {
  const { t } = useT();
  const items: (ProjectIcon | null)[] = [null, ...PROJECT_ICON_IDS];
  return (
    <div role="radiogroup" aria-label={t("look.icon")} className="flex flex-wrap gap-1.5">
      {items.map((id) => (
        <button
          key={id ?? "letter"}
          type="button"
          role="radio"
          aria-checked={value === id}
          aria-label={id ? t(`look.icon.${id}`) : t("look.letter")}
          title={id ? t(`look.icon.${id}`) : t("look.letter")}
          onClick={() => onChange(id)}
          className="look-choice ds-focus rounded-lg p-1"
        >
          <ProjectMark projectKey={projectKey || "?"} icon={id} color={color} size={30} />
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({ projectKey, value, onChange }: { projectKey: string; value: ProjectColor | null; onChange: (v: ProjectColor | null) => void }) {
  const { t } = useT();
  const auto = projectTone(projectKey || "?");
  return (
    <div role="radiogroup" aria-label={t("look.color")} className="flex flex-wrap items-center gap-1.5">
      <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)} className="look-choice ds-focus flex h-8 items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-[12px] font-medium text-sub" title={t("look.autoHint")}>
        <span className={`tk-tone-${auto} h-5 w-5 rounded-full bg-current`} aria-hidden="true" />
        {t("look.auto")}
      </button>
      {PROJECT_COLOR_IDS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t(`look.color.${c}`)} title={t(`look.color.${c}`)} onClick={() => onChange(c)} className="look-choice ds-focus flex h-8 w-8 items-center justify-center rounded-full">
          <span className={`tk-tone-${c} h-5 w-5 rounded-full bg-current`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function BackgroundPicker({ value, onChange }: { value: ProjectBackground | null; onChange: (v: ProjectBackground | null) => void }) {
  const { t } = useT();
  const dark = effectiveTheme() === "dark";
  const presets = PROJECT_BG_IDS.map((id) => BG_PRESETS.find((p) => p.id === id)!).filter(Boolean);
  return (
    <div role="radiogroup" aria-label={t("look.background")} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)} className="theme-choice ds-focus flex flex-col gap-1.5 rounded-xl p-1.5 text-left">
        <span className="look-bg-personal flex h-12 items-center justify-center rounded-lg text-[11px] font-medium text-faint ring-1 ring-inset ring-line/60">{t("look.bgPersonalShort")}</span>
        <span className="px-1 text-[12px] font-semibold text-ink">{t("look.bgPersonal")}</span>
      </button>
      {presets.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={value === p.id} onClick={() => onChange(p.id as ProjectBackground)} className="theme-choice ds-focus flex flex-col gap-1.5 rounded-xl p-1.5 text-left">
          <span className="h-12 rounded-lg ring-1 ring-inset ring-line/60" style={{ backgroundImage: dark ? p.dark : p.light }} />
          <span className="px-1 text-[12px] font-semibold text-ink">{p.name}</span>
        </button>
      ))}
    </div>
  );
}
