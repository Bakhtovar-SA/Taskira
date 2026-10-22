import { recurrenceText } from "../recurrenceText";
import { IcRepeat } from "../icons";
import { useT } from "../i18n";
import type { IssueRepeatDto } from "../../server/src/contract";

/** Метка повторяющейся задачи для карточки доски и строки списка. Со сроком (`solo=false`) — значок рядом с ним;
 *  без срока (`solo`) — расписание на месте срока. Приостановленное правило приглушено и названо в подсказке. */
export function RepeatMark({ repeat, solo, className }: { repeat: IssueRepeatDto; solo: boolean; className: string }) {
  const { t, tn } = useT();
  const text = recurrenceText(repeat.schedule, t, tn);
  const tip = t("board.repeatTip", { schedule: text }) + (repeat.paused ? ` — ${t("board.repeatPaused")}` : "");
  return (
    <span className={className} data-paused={repeat.paused || undefined} data-solo={solo || undefined} title={tip} {...(solo ? {} : { role: "img", "aria-label": tip })}>
      <IcRepeat size={14} />
      {solo && <><span className="sr-only">{t("board.repeatTip", { schedule: "" })}</span><span>{text}</span></>}
    </span>
  );
}
