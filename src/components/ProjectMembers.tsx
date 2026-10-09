import { useT } from "../i18n";
import { useStore } from "../store";
import type { User } from "../types";
import { Menu } from "../ds/LazyOverlay";
import { UserAvatar, UserAvatarGroup } from "./UserAvatar";

export function ProjectMembers({ selectedUserId, onSelectUser, extraUsers = [] }: {
  selectedUserId?: string | null;
  onSelectUser?: (userId: string) => void;
  extraUsers?: User[];
} = {}) {
  const { t } = useT();
  const { data, idx } = useStore();
  const members = Object.keys(data.members).flatMap(id => {
    const user = idx.users.get(id);
    return user ? [user] : [];
  });
  if (onSelectUser) {
    // The board used to list active assignees inside its Filters panel. Keep
    // those candidates available when the visible project avatars become the filter.
    const candidates = [...new Map([...members, ...extraUsers].map(user => [user.id, user])).values()];
    if (candidates.length === 0) return null;
    const selected = candidates.find(user => user.id === selectedUserId);
    const visible = candidates.slice(0, 4);
    if (selected && !visible.some(user => user.id === selected.id)) visible[3] = selected;
    const visibleIds = new Set(visible.map(user => user.id));
    const overflow = candidates.filter(user => !visibleIds.has(user.id));
    return <span className="project-members" role="group" aria-label={t("field.assignee")}>
      <span className="ds-av-group">
        {visible.map(user => <button key={user.id} type="button"
          className={`board-member-filter ds-focus flex rounded-full ${selected && selected.id !== user.id ? "opacity-50" : ""}`}
          aria-label={t("board.filterUserAria", { name: user.name })}
          aria-pressed={selectedUserId === user.id}
          title={t("board.filterUserAria", { name: user.name })}
          onClick={() => onSelectUser(user.id)}>
          <UserAvatar user={user} size={26} ring />
        </button>)}
        {overflow.length > 0 && <Menu label={t("board.moreAssignees")} placement="bottom-end"
          trigger={props => <button {...props} type="button" className="board-member-more ds-focus flex rounded-full"
            aria-label={t("board.moreAssignees")} title={t("board.moreAssignees")}>
            <span className="ds-av ds-av-more" data-size="28">+{overflow.length}</span>
          </button>}
          items={overflow.map(user => ({ id: user.id, label: user.name, icon: <UserAvatar user={user} size={20} />, onSelect: () => onSelectUser(user.id) }))} />}
      </span>
    </span>;
  }
  return members.length > 0 ? <span className="project-members" role="group" aria-label={t("topbar.membersAria")}>
    <UserAvatarGroup users={members} size={26} max={4} interactive />
  </span> : null;
}
