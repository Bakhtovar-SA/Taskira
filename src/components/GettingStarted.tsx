/** «Начало работы» (ТЗ 5.11): 5 шагов без модального тура. Шаги отмечает сервер по реальным действиям,
 *  карточка только показывает прогресс и ведёт туда, где шаг делается. Скрывается навсегда (на сервере). */
import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { STEPS, hideOnboarding, useOnboarding } from "../onboarding";
import { ProgressRing } from "../ds";
import { IcCheck, IcX } from "../icons";
import type { OnboardingStep } from "../../server/src/contract";
import type { ViewId } from "../types";

/** `navigate` — как перейти к месту шага; по умолчанию setView. На главной (вне проекта) HomeView сначала входит
 *  в проект, иначе представление некуда показать. */
export function GettingStarted({ compact = false, navigate, className = "" }: { compact?: boolean; navigate?: (view: ViewId, section?: string) => void; className?: string }) {
  const { t } = useT();
  const { setView: storeSetView } = useStore();
  const setView = navigate ?? storeSetView;
  const o = useOnboarding();
  // Компактная версия (боковая панель) свёрнута до строки с прогрессом — список шагов по щелчку.
  const [open, setOpen] = useState(!compact);
  if (!o || o.hidden) return null;
  const done = new Set(o.done);
  const n = STEPS.filter((s) => done.has(s)).length;
  const finished = n === STEPS.length;
  const go: Partial<Record<OnboardingStep, () => void>> = {
    open_issue: () => setView("my"),
    change_status: () => setView("board"),
    comment: () => setView("my"),
    notifications: () => setView("settings", "notifications"),
    theme: () => setView("settings", "appearance"),
  };

  return (
    <section aria-labelledby="gs-title" className={`surface-raised relative rounded-xl ring-1 ring-inset ring-line/70 ${compact ? "p-3.5" : "p-5"} ${className}`}>
      <button type="button" onClick={hideOnboarding} aria-label={t("onboarding.hide")} title={t("onboarding.hide")} className="ds-focus absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink">
        <IcX size={12} />
      </button>
      <div
        className={`flex items-center gap-3 pr-8 ${compact ? "ds-focus -m-1 cursor-pointer rounded-lg p-1" : ""}`}
        {...(compact ? { role: "button", tabIndex: 0, "aria-expanded": open, onClick: () => setOpen(!open), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(!open)) } : {})}
      >
        <ProgressRing value={(n / STEPS.length) * 100} size={compact ? 30 : 36} label={t("onboarding.progress", { n, total: STEPS.length })} />
        <div className="min-w-0">
          <h2 id="gs-title" className={`${compact ? "text-[13px]" : "text-[14px]"} font-semibold text-ink`}>
            {finished ? t("onboarding.doneTitle") : t("onboarding.title")}
          </h2>
          <p className="text-[12px] text-faint">{finished ? t("onboarding.doneSub") : t("onboarding.progress", { n, total: STEPS.length })}</p>
        </div>
      </div>
      {!finished && open && (
        <ol className={`flex flex-col ${compact ? "mt-2.5 gap-0.5" : "mt-4 gap-1"}`}>
          {STEPS.map((s) => {
            const ok = done.has(s);
            const action = go[s];
            return (
              <li key={s} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5" data-done={ok || undefined}>
                <span className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${ok ? "bg-[var(--status-done)] text-onaccent" : "ring-[1.5px] ring-inset ring-line2"}`} aria-hidden="true">
                  {ok && <IcCheck size={11} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] ${ok ? "text-faint line-through decoration-line2" : "font-medium text-ink"}`}>{t(`onboarding.step.${s}`)}</span>
                  {!ok && !compact && <span className="block text-[12px] text-faint">{t(`onboarding.step.${s}.hint`)}</span>}
                </span>
                {!ok && action && (
                  <button type="button" onClick={action} className="ds-focus shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold text-accenttext hover:bg-accentsoft">
                    {t(`onboarding.step.${s}.go`)}
                  </button>
                )}
                <span className="sr-only">{ok ? t("onboarding.stepDone") : t("onboarding.stepTodo")}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
