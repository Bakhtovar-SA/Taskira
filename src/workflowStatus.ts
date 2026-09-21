import type { TKey } from "./i18n";

type Translate = (key: TKey, params?: Record<string, string | number>) => string;
type StatusLike = { sid?: string | null; name: string };

const DEFAULT_STATUS_KEYS: Record<string, TKey> = {
  todo: "workflow.status.todo",
  inprogress: "workflow.status.inprogress",
  review: "workflow.status.review",
  done: "workflow.status.done",
};

// Cross-project DTOs currently carry statusName but not sid. Match only the
// known built-in names there; objects with an explicit custom sid are never
// translated by name, so user-defined workflow labels remain untouched.
const DEFAULT_NAME_TO_SID: Record<string, keyof typeof DEFAULT_STATUS_KEYS> = {
  "к выполнению": "todo",
  "к работе": "todo",
  "to do": "todo",
  todo: "todo",
  "в работе": "inprogress",
  "in progress": "inprogress",
  "на ревью": "review",
  review: "review",
  готово: "done",
  done: "done",
};

export function workflowStatusName(status: StatusLike, t: Translate): string {
  if (status.sid) {
    const key = DEFAULT_STATUS_KEYS[status.sid];
    return key ? t(key) : status.name;
  }
  const sid = DEFAULT_NAME_TO_SID[status.name.trim().toLowerCase()];
  return sid ? t(DEFAULT_STATUS_KEYS[sid]) : status.name;
}
