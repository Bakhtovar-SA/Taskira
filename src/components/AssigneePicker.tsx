import { useState } from "react";
import type { Data, User } from "../types";
import { useT } from "../i18n";
import { IcCheck } from "../icons";
import { UserAvatar } from "./UserAvatar";

export function projectAssignees(data: Pick<Data, "users" | "members">, selected: string[], query: string): User[] {
  const term = query.trim().toLocaleLowerCase();
  return data.users.filter(user => (Object.prototype.hasOwnProperty.call(data.members, user.id) || selected.includes(user.id)) &&
    (!term || `${user.name} ${user.username ?? ""} ${user.role}`.toLocaleLowerCase().includes(term)));
}

/** Only project members can be added; former assignees remain visible for removal. */
export default function AssigneePicker({ data, selected, onChange }: {
  data: Pick<Data, "users" | "members">; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const candidates = projectAssignees(data, selected, query);
  return <div className="flex flex-col">
    <div className="sticky top-0 z-10 bg-panel p-2">
      <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)}
        aria-label={t("assignee.search")} placeholder={t("assignee.search")}
        className="ds-input ds-focus w-full" />
    </div>
    {candidates.map(user => <button key={user.id} type="button" aria-pressed={selected.includes(user.id)}
      className="ds-menu-item" onClick={() => onChange(selected.includes(user.id) ? selected.filter(id => id !== user.id) : [...selected, user.id])}>
      <UserAvatar user={user} size={18} interactive={false} />
      <span className="min-w-0 flex-1 truncate">{user.name}</span>
      {selected.includes(user.id) && <IcCheck size={12} className="text-accent" />}
    </button>)}
    {!candidates.length && <p className="px-3 py-2 text-[12px] text-faint">{t("assignee.empty")}</p>}
  </div>;
}
