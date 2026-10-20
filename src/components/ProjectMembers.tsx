import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { User } from "../types";
import { Menu } from "../ds/LazyOverlay";
import { UserAvatar, UserAvatarGroup } from "./UserAvatar";
import { IcCheck } from "../icons";
import { cssVars } from "../cssVars";

const placeMemberName = (button: HTMLButtonElement) => {
  const { left, right } = button.getBoundingClientRect();
  const roomRight = window.innerWidth - right - 8;
  const roomLeft = left - 8;
  const side = roomRight >= 168 || roomRight >= roomLeft ? "right" : "left";
  button.dataset.labelSide = side;
  cssVars({ "--member-name-max": `${Math.max(24, Math.min(150, (side === "right" ? roomRight : roomLeft) - 18))}px` })(button);
};

const touchPickerQuery = "(hover: none), (any-pointer: coarse)";
const isTouchPicker = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(touchPickerQuery).matches;

export function BoardAssigneeFilter({ selectedUserId, onSelectUser, extraUsers }: {
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
  extraUsers: User[];
}) {
  const { t } = useT();
  const { idx } = useStore();
  // Controlled: the lazy Menu drops a click made before its chunk arrives, unless the open state lives here.
  const [moreOpen, setMoreOpen] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const [touchPicker, setTouchPicker] = useState(isTouchPicker);
  const listRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const query = window.matchMedia?.(touchPickerQuery);
    const updatePicker = () => setTouchPicker(query?.matches ?? false);
    query?.addEventListener("change", updatePicker);
    const updateNamePosition = () => listRef.current?.querySelectorAll<HTMLButtonElement>(".board-member-filter:is(:hover, :focus-visible)").forEach(placeMemberName);
    window.addEventListener("resize", updateNamePosition);
    return () => {
      query?.removeEventListener("change", updatePicker);
      window.removeEventListener("resize", updateNamePosition);
    };
  }, []);
  // Match the old board filter: active human assignees, not the full directory.
  const selectedUser = selectedUserId ? idx.users.get(selectedUserId) : undefined;
  const candidates = [...new Map([...extraUsers, ...(selectedUser ? [selectedUser] : [])]
    .filter(user => user.authSource !== "service").map(user => [user.id, user])).values()];
  if (candidates.length === 0) return null;
  const selected = candidates.find(user => user.id === selectedUserId);
  const visible = candidates.slice(0, 4);
  const visibleIds = new Set(visible.map(user => user.id));
  const overflow = candidates.filter(user => !visibleIds.has(user.id));
  const overflowSelected = overflow.find(user => user.id === selectedUserId);
  const moreLabel = overflowSelected ? t("board.moreAssigneesActive", { name: overflowSelected.name }) : t("board.moreAssignees");
  const itemForUser = (user: User) => ({ id: user.id, label: user.name, icon: <UserAvatar user={user} size={20} />,
    hint: selectedUserId === user.id ? <IcCheck size={14} /> : undefined,
    onSelect: () => onSelectUser(user.id) });
  return <span className="project-members" role="group" aria-label={t("field.assignee")}>
    {touchPicker ? <span className="board-member-touch-picker">
      <Menu label={t("field.assignee")} placement="bottom-end" open={touchOpen} onOpenChange={setTouchOpen}
        trigger={props => <button {...props} type="button" className="board-member-touch-trigger ds-focus"
          aria-label={selected ? `${t("field.assignee")}: ${selected.name}` : t("field.assignee")}>
          {selected && <UserAvatar user={selected} size={24} showTitle={false} />}
          <span>{selected?.name ?? t("field.assignee")}</span>
        </button>}
        items={candidates.map(itemForUser)} />
    </span> : <span ref={listRef} className="ds-av-group board-member-list">
      {visible.map(user => <button key={user.id} type="button"
        className={`board-member-filter ds-focus flex rounded-full ${selected && selected.id !== user.id ? "opacity-50" : ""}`}
        aria-label={t("board.filterUserAria", { name: user.name })}
        aria-pressed={selectedUserId === user.id}
        onPointerEnter={event => placeMemberName(event.currentTarget)}
        onFocus={event => placeMemberName(event.currentTarget)}
        onClick={() => onSelectUser(user.id)}>
        <UserAvatar user={user} size={26} ring showTitle={false} />
        <span className="board-member-name" aria-hidden="true"><span>{user.name}</span></span>
      </button>)}
      {overflow.length > 0 && <Menu label={t("board.moreAssignees")} placement="bottom-end" open={moreOpen} onOpenChange={setMoreOpen}
        trigger={props => <button {...props} type="button" className="board-member-more ds-focus flex rounded-full"
          data-active={overflowSelected ? "true" : undefined}
          aria-label={moreLabel} title={moreLabel}>
          <span className="ds-av ds-av-more" data-size="28">+{overflow.length}</span>
        </button>}
        items={overflow.map(itemForUser)} />}
    </span>}
  </span>;
}

export function ProjectMembers() {
  const { t } = useT();
  const { data, idx } = useStore();
  const members = Object.keys(data.members).flatMap(id => {
    const user = idx.users.get(id);
    return user ? [user] : [];
  });
  return members.length > 0 ? <span className="project-members" role="group" aria-label={t("topbar.membersAria")}>
    <UserAvatarGroup users={members} size={26} max={4} interactive />
  </span> : null;
}
