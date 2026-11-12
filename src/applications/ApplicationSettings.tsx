import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { applicationsCopy } from "../i18n/applications";
import { applicationsApi } from "../api/applications";
import { useAction } from "../workspace/hooks";
import { SettingsPage, SettingsCard } from "../components/settings/parts";
import { Button } from "../ds/Button";
import { Switch } from "../ds/Field";
import { ApplicationIcon } from "./ApplicationSwitcher";
import type { ApplicationEnabled } from "../../server/src/applicationContract";

export default function ApplicationSettings() {
  const { lang } = useT(), c = applicationsCopy(lang);
  const { applications, applicationsError, refreshApplications, me } = useStore();
  const action = useAction();
  const [saved, setSaved] = useState(false);
  return <SettingsPage title={c.applications} desc={c.settingsHint}>
    <SettingsCard footer={c.disabledHint}>
      {!applications ? <div className="px-5 py-5" role="status">
        {applicationsError ? <><p role="alert" className="text-[13px] text-danger">{c.loadError}</p><Button size="sm" onClick={() => void refreshApplications()}>{c.retry}</Button></> : <p className="text-[13px] text-faint">{c.loading}</p>}
      </div> : applications.applications.map((app) => <div key={app.id} className="px-5 py-4">
        <Switch labelFirst label={<span className="flex items-center gap-2"><ApplicationIcon application={app.id} />{c.apps[app.id].name}</span>} description={c.apps[app.id].start}
          checked={app.enabled} disabled={action.busy || me.globalRole !== "admin" || !applications.canManage}
          onChange={(checked) => {
            if (action.busy) return;
            setSaved(false);
            const enabled = Object.fromEntries(applications.applications.map((item) => [item.id, item.id === app.id ? checked : item.enabled])) as ApplicationEnabled;
            void action.run(async () => {
              try { await applicationsApi.patch({ revision: applications.revision, enabled }); }
              finally { await refreshApplications(); }
            }, () => setSaved(true));
          }} />
      </div>)}
    </SettingsCard>
    <p className="text-[13px] leading-relaxed text-sub">{c.projectHint}</p>
    {action.error && <p role="alert" className="text-[13px] text-danger">{action.error}</p>}
    <p role="status" aria-live="polite" className="text-[13px] text-sub">{action.busy ? c.saving : saved ? c.saved : ""}</p>
  </SettingsPage>;
}
