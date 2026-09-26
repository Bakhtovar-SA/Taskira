/** «Мои задачи» (ADR-0013 §1, `/my-issues`) — назначенные мне задачи во всех проектах,
 *  сгруппированные по проекту. Та же полоса фокуса и строка, что на Главной (`MyIssues.tsx`). */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { AssignedIssue } from "../types";
import { IcInbox } from "../icons";
import { Empty, ProjectMark } from "../ui";
import { useT } from "../i18n";
import { FOCUS_TEST, FocusChips, TaskRow, useFocusCounts, type Focus } from "./MyIssues";

export default function MyIssuesView() {
  const { t, tn } = useT();
  const { data, refreshAssignedToMe, openIssue, switchProject } = useStore();
  const [focus, setFocus] = useState<Focus>("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void refreshAssignedToMe().finally(() => setLoaded(true));
  }, [refreshAssignedToMe]);

  const counts = useFocusCounts(data.assignedToMe);
  const groups = useMemo(() => {
    const by = new Map<string, AssignedIssue[]>();
    for (const i of data.assignedToMe.filter(FOCUS_TEST[focus])) {
      const arr = by.get(i.projectId) ?? [];
      arr.push(i);
      by.set(i.projectId, arr);
    }
    // Текущий проект — первым, остальные по имени.
    return [...by.values()].sort((a, b) =>
      a[0].projectId === data.currentProjectId ? -1 : b[0].projectId === data.currentProjectId ? 1 : a[0].projectName.localeCompare(b[0].projectName),
    );
  }, [data.assignedToMe, focus, data.currentProjectId]);

  // Полной страницей: контекста доски здесь нет (ADR-0013 §3).
  const open = (i: AssignedIssue) => (i.projectId === data.currentProjectId ? openIssue(i.issueId, "page") : switchProject(i.projectId, i.issueId, "page"));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[960px] px-4 pb-12 pt-6 sm:px-8">
        <h1 className="font-disp text-[22px] font-semibold tracking-[-0.02em] text-ink">{t("sidebar.nav.my")}</h1>
        <p className="mt-0.5 text-[12.5px] text-faint">{t("my.subtitle")}</p>
        <FocusChips focus={focus} onFocus={setFocus} counts={counts} className="mt-5" />

        {groups.length === 0 ? (
          loaded && (
            <div className="mt-10">
              <Empty icon={<IcInbox size={22} />} title={t("home.noAssignedTitle")} sub={t("home.noAssignedSub")} />
            </div>
          )
        ) : (
          <div className="mt-6 space-y-6">
            {groups.map((items) => (
              <section key={items[0].projectId}>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold text-ink">
                  <ProjectMark projectKey={items[0].projectKey} size={18} />
                  {items[0].projectName}
                  <span className="tabular text-[12px] font-medium text-faint">{items.length}</span>
                </h2>
                <div className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
                  {items.map((i) => (
                    <TaskRow key={i.issueId} issue={i} onOpen={() => open(i)} showProject={false} />
                  ))}
                </div>
              </section>
            ))}
            {data.assignedTruncated && (
              <p className="px-1 text-[11.5px] font-medium text-warn">
                {t("home.assignedTruncated", {
                  n: data.assignedToMe.length,
                  noun: tn(data.assignedToMe.length, "noun.issue.one", "noun.issue.few", "noun.issue.many"),
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
