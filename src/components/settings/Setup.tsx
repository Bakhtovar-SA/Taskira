/** «Начальная настройка» (ТЗ 5.11): первый вход администратора после установки. Не тур, а обычная страница
 *  настроек организации: название → вход и LDAP → пользователи → первый проект (мастер 5.10) → по желанию демо.
 *  Каждый шаг делается тут же или ведёт в свой раздел; «Завершить» отмечает настройку на сервере, и
 *  автоматически она больше не открывается (App.tsx). Вернуться можно в любой момент из «Организации». */
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../../store";
import { useT } from "../../i18n";
import { ldapApi, setupApi } from "../../api";
import type { SetupStatusDto } from "../../../server/src/contract";
import { Button, Input, Tag } from "../../ds";
import { IcCheck } from "../../icons";
import { openProjectWizard } from "../../palette/events";
import { SettingsPage } from "./parts";

type Ping = Awaited<ReturnType<typeof ldapApi.ping>> | Error | null;

export function Setup() {
  const { t, errText } = useT();
  const { data, setView, switchProject, refreshOrg, toast, bootstrap } = useStore();
  const [st, setSt] = useState<SetupStatusDto | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [ping, setPing] = useState<Ping>(null);
  const [pinging, setPinging] = useState(false);
  const [adConfirmed, setAdConfirmed] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const load = () =>
    setupApi.get().then(
      (s) => {
        setSt(s);
        setName((n) => n || s.instanceName);
      },
      () => undefined,
    );
  useEffect(() => {
    void load();
    // Проекты меняются мастером в соседнем окне — перечитываем счётчик, когда список проектов изменился.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.projects.length]);

  if (!st) return <SettingsPage title={t("settings.org.setup")}>{<div className="ds-sk h-40 rounded-xl" />}</SettingsPage>;

  const ldap = st.authMode === "ldap";
  const done = {
    name: nameSaved || st.completed,
    login: ldap ? ping !== null && !(ping instanceof Error) && ping.ok : true,
    users: st.users > 0 || (ldap && adConfirmed),
    project: st.projects > 1,
  };

  const saveName = async () => {
    setSavingName(true);
    try {
      setSt(await setupApi.rename(name.trim()));
      setNameSaved(true);
    } catch (e) {
      toast("error", errText(e, t("settings.org.saveFailed")));
    } finally {
      setSavingName(false);
    }
  };
  const check = async () => {
    setPinging(true);
    try {
      setPing(await ldapApi.ping());
    } catch (e) {
      setPing(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setPinging(false);
    }
  };
  const createDemo = async () => {
    setDemoBusy(true);
    try {
      const { id } = await setupApi.createDemo();
      await refreshOrg();
      await load();
      toast("success", t("setup.demoCreated"));
      setView("board");
      switchProject(id);
    } catch (e) {
      toast("error", errText(e, t("settings.org.saveFailed")));
    } finally {
      setDemoBusy(false);
    }
  };
  const removeDemo = async () => {
    setDemoBusy(true);
    const wasCurrent = data.currentProjectId === st.demoProjectId;
    try {
      await setupApi.removeDemo();
      toast("success", t("setup.demoRemoved"));
      if (wasCurrent) await bootstrap();
      else {
        await refreshOrg();
        await load();
      }
    } catch (e) {
      toast("error", errText(e, t("settings.org.saveFailed")));
    } finally {
      setDemoBusy(false);
    }
  };
  const finish = async () => {
    try {
      setSt(await setupApi.complete());
      toast("success", t("setup.finished"));
    } catch (e) {
      toast("error", errText(e, t("settings.org.saveFailed")));
    }
  };

  const doneCount = Object.values(done).filter(Boolean).length;
  return (
    <SettingsPage title={t("settings.org.setup")} desc={st.completed ? t("setup.descDone") : t("setup.desc")}>
      <ol className="flex flex-col gap-3">
        <Step n={1} done={done.name} title={t("setup.name.title")} sub={t("setup.name.sub")}>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input label={t("setup.name.label")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <Button variant="secondary" loading={savingName} disabled={name.trim() ? false : t("settings.project.nameRequired")} onClick={() => void saveName()}>
              {t("common.save")}
            </Button>
          </div>
        </Step>

        <Step n={2} done={done.login} title={t("setup.login.title")} sub={ldap ? t("setup.login.ldapSub") : t("setup.login.localSub")}>
          {ldap && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" loading={pinging} onClick={() => void check()}>
                {t("settings.org.ldapCheckBtn")}
              </Button>
              {ping !== null && (
                <span role="status" className={`text-[12.5px] ${!(ping instanceof Error) && ping.ok ? "text-[var(--status-done-fg)]" : "text-[var(--status-danger-fg)]"}`}>
                  {ping instanceof Error ? errText(ping, t("settings.org.ldapCheckFailed")) : ping.ok ? t("settings.org.ldapOk", { url: ping.url ?? "", base: ping.baseDn ?? "" }) : ping.error}
                </span>
              )}
            </div>
          )}
        </Step>

        <Step n={3} done={done.users} title={t("setup.users.title")} sub={ldap ? t("setup.users.ldapSub") : t("setup.users.localSub")}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12.5px] text-sub">{t("setup.users.count", { n: st.users })}</span>
            <Button variant="secondary" onClick={() => setView("orgSettings", "users")}>
              {t("setup.users.open")}
            </Button>
            {ldap && !done.users && (
              <Button variant="ghost" onClick={() => setAdConfirmed(true)}>
                {t("setup.users.fromAd")}
              </Button>
            )}
          </div>
        </Step>

        <Step n={4} done={done.project} title={t("setup.project.title")} sub={t("setup.project.sub")}>
          <div className="flex">
            <Button variant="primary" onClick={() => openProjectWizard()}>
              {t("wizard.title")}
            </Button>
          </div>
        </Step>

        <Step n={5} optional title={t("setup.demo.title")} sub={t("setup.demo.sub")} done={!!st.demoProjectId}>
          {st.demoProjectId ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setView("board");
                  switchProject(st.demoProjectId!);
                }}
              >
                {t("setup.demo.open")}
              </Button>
              <Button variant="danger" loading={demoBusy} onClick={() => void removeDemo()}>
                {t("setup.demo.remove")}
              </Button>
            </div>
          ) : (
            <div className="flex">
              <Button variant="secondary" loading={demoBusy} onClick={() => void createDemo()}>
                {t("setup.demo.create")}
              </Button>
            </div>
          )}
        </Step>
      </ol>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-faint">{t("setup.progress", { n: doneCount, total: 4 })}</span>
        {st.completed ? (
          <Tag tone="green" dot>
            {t("setup.completedTag")}
          </Tag>
        ) : (
          <Button variant="primary" onClick={() => void finish()}>
            {t("setup.finish")}
          </Button>
        )}
      </div>
    </SettingsPage>
  );
}

function Step({ n, title, sub, done, optional, children }: { n: number; title: string; sub: string; done: boolean; optional?: boolean; children?: ReactNode }) {
  const { t } = useT();
  return (
    <li className="surface-raised flex gap-4 rounded-xl p-5 ring-1 ring-inset ring-line/70" data-done={done || undefined}>
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12.5px] font-bold ${done ? "bg-[var(--status-done)] text-onaccent" : "bg-accentsoft text-accenttext"}`}
        aria-hidden="true"
      >
        {done ? <IcCheck size={14} /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
            {title}
            {optional && <span className="text-[12px] font-normal text-faint">· {t("wizard.optional")}</span>}
            <span className="sr-only">{done ? t("onboarding.stepDone") : t("onboarding.stepTodo")}</span>
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">{sub}</p>
        </div>
        {children}
      </div>
    </li>
  );
}
