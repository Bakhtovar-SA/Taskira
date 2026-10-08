/** Подсказка при первой встрече с функцией (ТЗ 5.11): одна строка в интерфейсе, закрывается крестиком,
 *  никогда не блокирует работу и не возвращается после закрытия (закрытые id хранит сервер). */
import type { ReactNode } from "react";
import { useT } from "../i18n";
import { dismissHint, useHintVisible } from "../onboarding";
import { IcSparkle, IcX } from "../icons";

export function Hint({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const { t } = useT();
  if (!useHintVisible(id)) return null;
  return (
    <p role="note" className={`hint-line flex items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-1 text-[13.5px] text-sub ${className}`}>
      <IcSparkle size={15} tone="violet" />
      <span className="min-w-0 flex-1">{children}</span>
      <button type="button" onClick={() => dismissHint(id)} aria-label={t("hint.dismiss")} title={t("hint.dismiss")} className="ds-focus grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink">
        <IcX size={13} />
      </button>
    </p>
  );
}
