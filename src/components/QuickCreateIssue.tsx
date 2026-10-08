import { useState } from "react";
import type { Status } from "../types";
import { useStore } from "../store";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { IcCheck, IcX } from "../icons";

export default function QuickCreate({ status, onDone }: { status: Status; onDone: () => void }) {
  const { t } = useT();
  const { createIssue } = useStore();
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return onDone();
    createIssue({
      title: text,
      description: "",
      typeId: "task",
      priorityId: "medium",
      assigneeIds: [],
      epicId: null,
      labels: [],
      complexity: null,
      statusId: status.id,
    });
    setText("");
  };
  return (
    <div className="anim-fadeup rounded-lg border border-accent bg-panel p-2.5 shadow-focus">
      <textarea
        autoFocus
        aria-label={t("board.quickCreatePlaceholder", { status: workflowStatusName(status, t) })}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onDone();
        }}
        placeholder={t("board.quickCreatePlaceholder", { status: workflowStatusName(status, t) })}
        rows={2}
        className="w-full resize-none bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-1.5">
        <button onClick={submit} className="btn-primary flex items-center gap-1 rounded-lg px-2.5 py-1 text-[13px] font-medium">
          <IcCheck size={14} /> {t("board.addButton")}
        </button>
        <button onClick={onDone} className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink" aria-label={t("common.cancel")}>
          <IcX size={15} />
        </button>
      </div>
    </div>
  );
}
