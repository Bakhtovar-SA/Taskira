import { useStore } from "../store";
import { useT } from "../i18n";
import { applicationsCopy } from "../i18n/applications";
import { Button } from "../ds/Button";

/** A direct material URL keeps its context even when the application is disabled. */
export default function ApplicationReadOnly() {
  const { application = "work", applications, setView, ui, me } = useStore();
  const { lang } = useT(), c = applicationsCopy(lang);
  const enabled = applications?.applications.find((item) => item.id === application)?.enabled;
  if (enabled !== false || ["settings", "projectSettings", "orgSettings", "docs"].includes(ui.view)) return null;
  return <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-linesoft bg-sunken px-4 py-2 text-[13px] text-sub">
    <p className="min-w-0 flex-1"><strong className="font-semibold text-ink">{c.apps[application].name} · {c.readOnly}.</strong>{" "}{c.unavailableHint}</p>
    {me.globalRole === "admin" && <Button size="sm" variant="ghost" onClick={() => setView("orgSettings", "applications")}>{c.manage}</Button>}
  </div>;
}
