import { useT } from "../i18n";
import { useStore } from "../store";
import { UserAvatarGroup } from "./UserAvatar";

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
