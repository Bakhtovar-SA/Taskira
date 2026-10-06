
/** Настройки организации (IA §3.3, ТЗ 5.9 п. 2): то, что сервер уже умеет, а интерфейса не было —
 *  пользователи, проверка LDAP, лицензия, аудит, обслуживание, состояние системы. Значения, которые
 *  задаются только переменными окружения, показаны справочно (ТЗ 5.9: новых настроек не добавлять). */
import { Setup } from "./Setup";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../../store";
import { useT } from "../../i18n";
import type { BrandDto } from "../../../server/src/contract";
import { BRAND_EXTRA_HUES, BRAND_HUE, DEFAULT_BRAND_NAME, previewHue, setBrand, useBrand } from "../../brand";
import { cssVars } from "../../cssVars";
import { BrandMark } from "../BrandMark";
import { adminApi, brandApi, ldapApi, projectTemplatesApi, usersApi, type LicenseStatusDto, type MaintenanceStatusDto, type SafeUser } from "../../api";
import { Avatar, Button, DatePicker, Dialog, EmptyState, Input, Progress, RadioGroup, Switch, Tag } from "../../ds";
import { IcCompose, IcDiamond, IcDownload, IcLink, IcPlus, IcSearch, IcTrash } from "../../icons";
import { openProjectWizard } from "../../palette/events";
import { LIMITS } from "../../validation";
import { dataColorFor } from "../../dataColors";
import { SettingRow, SettingsCard, SettingsPage } from "./parts";
const SystemStatus = lazy(() => import("./SystemStatus"));

export function OrgSection({ section }: { section: string }) {
  switch (section) {
    case "setup":
      return <Setup />;
    case "users":
      return <Users />;
    case "ldap":
      return <Ldap />;
    case "project-templates":
      return <Templates />;
    case "brand":
      return <Brand />;
    case "license":
      return <License />;
    case "export":
      return <Export />;
    case "audit":
      return <Audit />;
    case "maintenance":
      return <Maintenance />;
    default:
      return <Suspense fallback={<Loading />}><SystemStatus /></Suspense>;
  }
}

/** Загрузка с явными состояниями: null — идёт, Error — не удалось. */
function useLoad<T>(fn: () => Promise<T>) {
  const [v, setV] = useState<T | null | Error>(null);
  const reload = useCallback(() => {
    setV(null);
    fn().then(setV, (e) => setV(e instanceof Error ? e : new Error(String(e))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(reload, [reload]);
  return [v, reload, setV] as const;
}

function Loading() {
  return (
    <div className="flex flex-col gap-2.5 px-5 py-5" aria-busy="true">
      <div className="ds-sk h-4 w-2/3" />
      <div className="ds-sk h-4 w-1/2" />
      <div className="ds-sk h-4 w-3/5" />
    </div>
  );
}
function Failed({ err, retry }: { err: Error; retry: () => void }) {
  const { t, errText } = useT();
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <p className="flex-1 text-[12.5px] text-[var(--status-danger-fg)]">{errText(err, t("settings.org.loadFailed"))}</p>
      <Button size="sm" variant="secondary" onClick={retry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
const EnvTag = () => (
  <Tag tone="gray" size="sm">
    env
  </Tag>
);
const dt = (iso: string | null, lang: string) => (iso ? new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—");
const dur = (ms: number, lang: string) => {
  const h = ms / 3_600_000;
  if (h >= 1) return lang === "en" ? `${+h.toFixed(1)} h` : `${+h.toFixed(1)} ч`;
  return lang === "en" ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 60_000)} мин`;
};

/* ---------------- Пользователи ---------------- */

function Users() {
  const { t, errText } = useT();
  const { authMode, toast, me } = useStore();
  const [list, reload, setList] = useLoad(() => usersApi.list());
  const [q, setQ] = useState("");
  const [create, setCreate] = useState(false);
  const ldap = authMode === "ldap";

  const users = list instanceof Array ? list : [];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sorted = [...users].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
    return s ? sorted.filter((u) => u.name.toLowerCase().includes(s) || u.username.toLowerCase().includes(s) || u.jobRole.toLowerCase().includes(s)) : sorted;
  }, [users, q]);

  const patch = async (u: SafeUser, body: { globalRole: SafeUser["globalRole"]; isActive?: boolean }) => {
    try {
      const next = await usersApi.patch(u.id, body);
      setList(users.map((x) => (x.id === u.id ? next : x)));
    } catch (e) {
      toast("error", errText(e, t("settings.org.saveFailed")));
    }
  };

  return (
    <SettingsPage title={t("settings.org.users")} desc={t(ldap ? "settings.desc.usersLdap" : "settings.desc.users")}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Input aria-label={t("settings.org.searchUsers")} iconLeft={<IcSearch size={14} />} placeholder={t("settings.org.searchUsers")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="primary" iconLeft={<IcPlus size={14} />} disabled={ldap ? t("settings.org.createLdap") : false} onClick={() => setCreate(true)}>
          {t("settings.org.addUser")}
        </Button>
      </div>
      <SettingsCard footer={list instanceof Array ? t("settings.org.usersCount", { n: users.length, active: users.filter((u) => u.isActive).length }) : undefined}>
        {list === null ? (
          <Loading />
        ) : list instanceof Error ? (
          <Failed err={list} retry={reload} />
        ) : (
          shown.map((u) => {
            const ldapUser = ldap && u.authSource === "ldap";
            return (
              <div key={u.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${u.isActive ? "" : "opacity-60"}`}>
                <Avatar person={{ name: u.name }} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] font-medium text-ink">
                    {u.name}
                    {u.id === me.id && <span className="text-[11.5px] font-normal text-faint">{t("settings.org.you")}</span>}
                  </p>
                  <p className="truncate text-[12px] text-faint">
                    @{u.username}
                    {u.jobRole && ` · ${u.jobRole}`}
                  </p>
                </div>
                {u.authSource === "ldap" && (
                  <Tag tone="teal" size="sm">
                    LDAP
                  </Tag>
                )}
                <select
                  aria-label={t("settings.org.globalRole", { name: u.name })}
                  value={u.globalRole}
                  disabled={ldapUser}
                  title={ldapUser ? t("settings.org.roleFromLdap") : undefined}
                  onChange={(e) => void patch(u, { globalRole: e.target.value as SafeUser["globalRole"] })}
                  className="ds-input ds-focus h-8 min-w-[150px] cursor-pointer text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="member">{t("settings.org.roleMember")}</option>
                  <option value="admin">{t("settings.profile.roleAdmin")}</option>
                </select>
                <Switch checked={u.isActive} onChange={(v) => void patch(u, { globalRole: u.globalRole, isActive: v })} label={t("settings.org.active")} labelFirst />
              </div>
            );
          })
        )}
      </SettingsCard>
      <CreateUser
        open={create}
        onClose={() => setCreate(false)}
        onCreated={(u) => {
          setList([...users, u]);
          setCreate(false);
          toast("success", t("settings.org.userCreated", { name: u.name }));
        }}
      />
    </SettingsPage>
  );
}

function CreateUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (u: SafeUser) => void }) {
  const { t, errText } = useT();
  const [f, setF] = useState({ username: "", name: "", jobRole: "", phone: "", password: "", globalRole: "member" as SafeUser["globalRole"] });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF({ username: "", name: "", jobRole: "", phone: "", password: "", globalRole: "member" });
      setErr(null);
    }
  }, [open]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const missing = !f.username.trim() || !f.name.trim() || !f.password;
  const initials =
    f.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const submit = async () => {
    if (missing) return;
    setBusy(true);
    setErr(null);
    try {
      const u = await usersApi.create({
        username: f.username.trim(),
        password: f.password,
        name: f.name.trim(),
        initials,
        color: dataColorFor(f.username.trim()),
        jobRole: f.jobRole.trim(),
        phone: f.phone.trim() || undefined,
        globalRole: f.globalRole,
      });
      onCreated(u);
    } catch (e) {
      setErr(errText(e, t("settings.org.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={false}
      title={t("settings.org.addUser")}
      description={t("settings.org.addUserDesc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={missing ? t("settings.org.fillRequired") : false} onClick={() => void submit()}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input label={t("settings.profile.name")} value={f.name} onChange={set("name")} required data-autofocus />
        <Input label={t("settings.profile.username")} value={f.username} onChange={set("username")} required autoComplete="off" />
        <Input label={t("userCard.jobRole")} value={f.jobRole} onChange={set("jobRole")} />
        <Input label={t("userCard.phone")} value={f.phone} onChange={set("phone")} type="tel" />
        <div className="sm:col-span-2">
          <Input label={t("settings.org.password")} value={f.password} onChange={set("password")} type="password" autoComplete="new-password" required hint={t("settings.org.passwordHint")} error={err ?? undefined} />
        </div>
        <div className="sm:col-span-2">
          <RadioGroup
            label={t("settings.org.globalRoleLabel")}
            value={f.globalRole}
            onChange={(v) => setF((s) => ({ ...s, globalRole: v }))}
            options={[
              { value: "member", label: t("settings.org.roleMember"), description: t("settings.org.roleMemberDesc") },
              { value: "admin", label: t("settings.profile.roleAdmin"), description: t("settings.org.roleAdminDesc") },
            ]}
          />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/* ---------------- LDAP ---------------- */

function Ldap() {
  const { t, errText } = useT();
  const { authMode, resyncLdap, data, setDepartmentLdapGroup } = useStore();
  const [ping, setPing] = useState<Awaited<ReturnType<typeof ldapApi.ping>> | Error | null>(null);
  const [busy, setBusy] = useState(false);
  if (authMode !== "ldap")
    return (
      <SettingsPage title={t("settings.org.ldap")} desc={t("settings.desc.ldap")}>
        <SettingsCard footer={t("settings.org.ldapOffHint")}>
          <EmptyState icon={<IcLink size={22} tone="teal" />} title={t("settings.org.ldapOff")} sub={t("settings.org.ldapOffSub")} />
        </SettingsCard>
      </SettingsPage>
    );
  const check = async () => {
    setBusy(true);
    try {
      setPing(await ldapApi.ping());
    } catch (e) {
      setPing(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsPage title={t("settings.org.ldap")} desc={t("settings.desc.ldap")}>
      <SettingsCard>
        <SettingRow
          label={t("settings.org.ldapCheck")}
          hint={
            ping === null ? (
              t("settings.org.ldapCheckHint")
            ) : ping instanceof Error ? (
              <span className="text-[var(--status-danger-fg)]">{errText(ping, t("settings.org.ldapCheckFailed"))}</span>
            ) : ping.ok ? (
              <span className="text-[var(--status-done-fg)]">{t("settings.org.ldapOk", { url: ping.url ?? "", base: ping.baseDn ?? "" })}</span>
            ) : (
              <span className="text-[var(--status-danger-fg)]">{ping.error}</span>
            )
          }
        >
          <Button variant="secondary" loading={busy} onClick={() => void check()}>
            {t("settings.org.ldapCheckBtn")}
          </Button>
        </SettingRow>
        <SettingRow label={t("settings.org.ldapResync")} hint={t("admin.resyncHint")}>
          <Button variant="secondary" onClick={resyncLdap}>
            {t("admin.resync")}
          </Button>
        </SettingRow>
      </SettingsCard>
      <SettingsCard title={t("settings.org.ldapGroups")} footer={t("settings.org.ldapGroupsHint")}>
        {data.departments.map((d) => (
          <div key={d.id} className="grid items-center gap-2 px-5 py-3 sm:grid-cols-[200px_1fr]">
            <span className="truncate text-[13px] font-medium text-ink">{d.name}</span>
            <Input
              key={d.ldapGroupDn ?? ""}
              aria-label={t("settings.org.ldapGroupFor", { name: d.name })}
              defaultValue={d.ldapGroupDn ?? ""}
              placeholder={t("admin.ldapPlaceholder")}
              maxLength={LIMITS.department.ldapGroupDn.max}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (d.ldapGroupDn ?? "")) setDepartmentLdapGroup(d.id, v || null);
              }}

            />
          </div>
        ))}
      </SettingsCard>
    </SettingsPage>
  );
}

/* ---------------- Лицензия ---------------- */

function License() {
  const { t, lang } = useT();
  const [st, reload] = useLoad(() => adminApi.license());
  let body: ReactNode;
  if (st === null) body = <Loading />;
  else if (st instanceof Error) body = <Failed err={st} retry={reload} />;
  else body = <LicenseBody st={st} lang={lang} />;
  return (
    <SettingsPage title={t("settings.org.license")} desc={t("settings.desc.license")}>
      <SettingsCard footer={t("settings.org.licenseCli")}>{body}</SettingsCard>
    </SettingsPage>
  );
}

function LicenseBody({ st, lang }: { st: LicenseStatusDto; lang: string }) {
  const { t } = useT();
  if (st.state === "unset") return <EmptyState icon={<IcDiamond size={22} tone="indigo" />} title={t("settings.org.licenseUnset")} sub={t("settings.org.licenseUnsetSub")} />;
  if (st.state === "invalid")
    return (
      <SettingRow label={t("settings.org.licenseState")} hint={t("settings.org.licenseInvalidHint", { reason: st.reason })}>
        <Tag tone="red" strong dot>
          {t("settings.org.licenseInvalid")}
        </Tag>
      </SettingRow>
    );
  const c = st.claims;
  const exp = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { dateStyle: "long" }).format(new Date(c.exp * 1000));
  const pct = Math.round((st.seatsUsed / Math.max(1, c.maxSeats)) * 100);
  return (
    <>
      <SettingRow label={t("settings.org.licenseState")} hint={st.state === "active" ? t("settings.org.licenseDaysLeft", { n: st.daysUntilExpiry ?? 0, date: exp }) : t("settings.org.licenseExpiredHint", { n: st.daysSinceExpiry ?? 0, date: exp })}>
        <Tag tone={st.state === "active" ? "green" : "amber"} strong dot>
          {t(st.state === "active" ? "settings.org.licenseActive" : "settings.org.licenseExpired")}
        </Tag>
      </SettingRow>
      <SettingRow label={t("settings.org.licensePlan")}>
        <span className="text-[13px] font-semibold text-ink">{c.plan}</span>
        {c.issuedTo && <span className="ml-2 text-[12px] text-faint">{c.issuedTo}</span>}
      </SettingRow>
      <SettingRow label={t("settings.org.licenseSeats")} hint={t("settings.org.licenseSeatsHint", { days: c.activeWindowDays })}>
        <div className="flex w-[220px] flex-col gap-1.5">
          <span className={`text-right text-[13px] font-semibold tabular ${st.seatsOverLimit ? "text-[var(--status-danger-fg)]" : "text-ink"}`}>
            {st.seatsUsed} / {c.maxSeats}
          </span>
          <Progress value={pct} label={t("settings.org.licenseSeats")} />
        </div>
      </SettingRow>
      {c.features.length > 0 && (
        <SettingRow label={t("settings.org.licenseFeatures")}>
          <div className="flex max-w-[320px] flex-wrap justify-end gap-1">
            {c.features.map((f) => (
              <Tag key={f} tone="indigo" size="sm">
                {f}
              </Tag>
            ))}
          </div>
        </SettingRow>
      )}
    </>
  );
}

/* ---------------- Экспорт и аудит ---------------- */

function Export() {
  const { t } = useT();
  return (
    <SettingsPage title={t("settings.org.export")} desc={t("settings.desc.export")}>
      <SettingsCard>
        <SettingRow label={t("admin.export")} hint={t("admin.exportHint")}>
          <a href={adminApi.exportUrl()} className="ds-btn ds-focus" data-variant="secondary" data-size="md">
            <IcDownload size={14} /> NDJSON
          </a>
        </SettingRow>
      </SettingsCard>
    </SettingsPage>
  );
}

function Audit() {
  const { t, lang } = useT();
  const [m] = useLoad(() => adminApi.maintenance());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState<"csv" | "jsonl">("csv");
  const iso = (d: string, end = false) => (d ? new Date(`${d}T${end ? "23:59:59" : "00:00:00"}`).toISOString() : undefined);
  return (
    <SettingsPage title={t("settings.org.audit")} desc={t("settings.desc.audit")}>
      <SettingsCard title={t("settings.org.auditExport")} footer={t("settings.org.auditExportHint")}>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div>
            <p className="ds-label mb-1">{t("settings.org.from")}</p>
            <DatePicker block label={t("settings.org.from")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={from || null} max={to || undefined} onChange={(v) => setFrom(v ?? "")} />
          </div>
          <div>
            <p className="ds-label mb-1">{t("settings.org.to")}</p>
            <DatePicker block label={t("settings.org.to")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={to || null} min={from || undefined} onChange={(v) => setTo(v ?? "")} />
          </div>
          <RadioGroup
            label={t("settings.org.format")}
            value={format}
            onChange={setFormat}
            options={[
              { value: "csv", label: "CSV", description: t("settings.org.csvDesc") },
              { value: "jsonl", label: "JSONL", description: t("settings.org.jsonlDesc") },
            ]}
          />
          <div className="flex items-end justify-end">
            <a href={adminApi.auditExportUrl(format, iso(from), iso(to, true))} className="ds-btn ds-focus" data-variant="primary" data-size="md">
              <IcDownload size={14} /> {t("settings.org.download")}
            </a>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard>
        <SettingRow label={t("settings.org.auditRetention")} hint={t("settings.org.auditRetentionHint")}>
          <span className="flex items-center gap-2 text-[13px] font-semibold tabular text-ink">
            {m && !(m instanceof Error) ? t("settings.org.days", { n: m.settings.auditRetentionDays }) : "…"} <EnvTag />
          </span>
        </SettingRow>
      </SettingsCard>
    </SettingsPage>
  );
}

/* ---------------- Обслуживание ---------------- */

const JOB_KEY: Record<string, string> = { maintenance: "settings.org.jobMaintenance", "storage-sweep": "settings.org.jobStorage", "ldap-resync": "settings.org.jobLdap" };

function Maintenance() {
  const { t, lang, errText } = useT();
  const { toast } = useStore();
  const [st, reload] = useLoad<MaintenanceStatusDto>(() => adminApi.maintenance());
  const [dry, setDry] = useState<{ archived: number; auditPurged: number; capped: boolean } | null>(null);
  const [busy, setBusy] = useState<"dry" | "run" | null>(null);
  const [confirm, setConfirm] = useState(false);

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "dry" : "run");
    try {
      const r = await adminApi.runMaintenance(dryRun);
      if (dryRun) setDry(r);
      else {
        toast("success", t("settings.org.maintDone", { archived: r.archived, purged: r.auditPurged }));
        setDry(null);
        reload();
      }
    } catch (e) {
      toast("error", errText(e, t("settings.org.saveFailed")));
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };

  return (
    <SettingsPage title={t("settings.org.maintenance")} desc={t("settings.desc.maintenance")}>
      <SettingsCard title={t("settings.org.maintRun")}>
        <SettingRow
          label={t("settings.org.maintDry")}
          hint={
            dry ? (
              <span className="font-medium text-ink">
                {t("settings.org.maintDryResult", { archived: dry.archived, purged: dry.auditPurged })}
                {dry.capped && ` ${t("settings.org.maintCapped")}`}
              </span>
            ) : (
              t("settings.org.maintDryHint")
            )
          }
        >
          <div className="flex gap-2">
            <Button variant="secondary" loading={busy === "dry"} onClick={() => void run(true)}>
              {t("settings.org.maintCheck")}
            </Button>
            <Button variant="primary" loading={busy === "run"} disabled={busy === "dry"} onClick={() => setConfirm(true)}>
              {t("settings.org.maintNow")}
            </Button>
          </div>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.org.jobs")}>
        {st === null ? (
          <Loading />
        ) : st instanceof Error ? (
          <Failed err={st} retry={reload} />
        ) : st.jobs.length === 0 ? (
          <p className="px-5 py-5 text-[12.5px] text-faint">{t(st.enabled ? "settings.org.jobsNone" : "settings.org.jobsDisabled")}</p>
        ) : (
          st.jobs.map((j) => (
            <div key={j.name} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{JOB_KEY[j.name] ? t(JOB_KEY[j.name] as "settings.org.jobMaintenance") : j.name}</p>
                <p className="text-[12px] text-faint">
                  {t("settings.org.jobEvery", { every: dur(j.intervalMs, lang) })} · {t("settings.org.jobLast", { at: dt(j.lastRunAt, lang) })}
                  {j.lastDurationMs !== null && ` · ${j.lastDurationMs} ms`}
                </p>
                {j.lastError && <p className="mt-0.5 text-[12px] text-[var(--status-danger-fg)]">{j.lastError}</p>}
              </div>
              <Tag tone={j.running ? "sky" : j.lastResult === "error" ? "red" : j.lastResult === "success" ? "green" : "gray"} size="sm" strong dot>
                {t(j.running ? "settings.org.jobRunning" : j.lastResult === "error" ? "settings.org.jobError" : j.lastResult === "success" ? "settings.org.jobOk" : j.lastResult === "skipped" ? "settings.org.jobSkipped" : "settings.org.jobNever")}
              </Tag>
            </div>
          ))
        )}
      </SettingsCard>

      {st && !(st instanceof Error) && (
        <SettingsCard title={t("settings.org.envTitle")} footer={t("settings.org.envHint")}>
          {(
            [
              ["settings.org.archiveAfter", t("settings.org.days", { n: st.settings.archiveAfterDays })],
              ["settings.org.auditRetention", t("settings.org.days", { n: st.settings.auditRetentionDays })],
              ["settings.org.interval", dur(st.settings.intervalMs, lang)],
              ["settings.org.batch", `${st.settings.batchSize} / ${st.settings.maxPerRun}`],
            ] as const
          ).map(([k, v]) => (
            <SettingRow key={k} label={t(k)}>
              <span className="flex items-center gap-2 text-[13px] font-semibold tabular text-ink">
                {v} <EnvTag />
              </span>
            </SettingRow>
          ))}
        </SettingsCard>
      )}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("settings.org.maintConfirm")}
        description={t("settings.org.maintConfirmDesc")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy === "run"} onClick={() => void run(false)}>
              {t("settings.org.maintNow")}
            </Button>
          </>
        }
      />
    </SettingsPage>
  );
}

/* ---------------- Шаблоны проектов (ТЗ 5.10) ---------------- */

function Templates() {
  const { t, errText } = useT();
  const { toast } = useStore();
  const [list, reload, setList] = useLoad(() => projectTemplatesApi.list());
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const all = list instanceof Array ? list : [];
  const org = all.filter((x) => !x.builtin);
  const builtin = all.filter((x) => x.builtin);
  const remove = async (id: string) => {
    try {
      await projectTemplatesApi.remove(id);
      setList(all.filter((x) => x.id !== id));
    } catch (e) {
      toast("error", errText(e, t("settings.org.saveFailed")));
    } finally {
      setConfirm(null);
    }
  };
  const row = (x: (typeof all)[number], deletable: boolean) => (
    <div key={x.id} className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{x.name}</p>
        <p className="truncate text-[12px] text-faint">{x.spec.statuses.map((s) => s.name).join(" → ")}</p>
      </div>
      {deletable && (
        <Button size="sm" variant="ghost" iconLeft={<IcTrash size={13} />} onClick={() => setConfirm({ id: x.id, name: x.name })}>
          {t("common.delete")}
        </Button>
      )}
    </div>
  );
  return (
    <SettingsPage title={t("settings.org.project-templates")} desc={t("settings.desc.projectTemplates")}>
      <div className="flex justify-end">
        <Button variant="primary" iconLeft={<IcPlus size={14} />} onClick={() => openProjectWizard()}>
          {t("wizard.title")}
        </Button>
      </div>
      <SettingsCard title={t("settings.org.templatesOrg")} footer={t("settings.org.templatesOrgHint")}>
        {list === null ? (
          <Loading />
        ) : list instanceof Error ? (
          <Failed err={list} retry={reload} />
        ) : org.length === 0 ? (
          <EmptyState icon={<IcCompose size={22} tone="pink" />} title={t("settings.org.templatesEmpty")} sub={t("settings.org.templatesEmptySub")} />
        ) : (
          org.map((x) => row(x, true))
        )}
      </SettingsCard>
      {builtin.length > 0 && <SettingsCard title={t("settings.org.templatesBuiltin")}>{builtin.map((x) => row(x, false))}</SettingsCard>}
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={t("settings.org.templateDeleteTitle", { name: confirm?.name ?? "" })}
        description={t("settings.org.templateDeleteDesc")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => confirm && void remove(confirm.id)}>
              {t("common.delete")}
            </Button>
          </>
        }
      />
    </SettingsPage>
  );
}

/** Новые проверенные образцы и старый диапазон BRAND_HUE; ползунок доступен для старого диапазона. */
const HUE_SWATCHES = [...BRAND_EXTRA_HUES, 258, 268, 278, 288, 298, 308, 318];

/** Брендирование (ТЗ 5.14 п.5): название, оттенок акцента с живым предпросмотром, знак. Оттенок применяется ко всему
 *  интерфейсу сразу (previewHue), но остаётся, только если его сохранить; уход со страницы возвращает сохранённый. */
function Brand() {
  const { t, errText } = useT();
  const { toast } = useStore();
  const brand = useBrand();
  const [name, setName] = useState(brand.name ?? "");
  const [hue, setHue] = useState(brand.hue ?? BRAND_HUE.default);
  const [transparencyDefault, setTransDefault] = useState(brand.transparencyDefault);
  useEffect(() => setTransDefault(brand.transparencyDefault), [brand.transparencyDefault]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => previewHue(null), []);

  const savedHue = brand.hue ?? BRAND_HUE.default;
  const nextName = name.trim() && name.trim() !== DEFAULT_BRAND_NAME ? name.trim() : null;
  const dirty = nextName !== brand.name || hue !== savedHue || transparencyDefault !== brand.transparencyDefault;
  const pick = (h: number) => {
    setHue(h);
    previewHue(h);
  };

  const run = async (job: () => Promise<BrandDto>, ok?: string) => {
    setBusy(true);
    try {
      setBrand(await job());
      if (ok) toast("success", ok);
    } catch (e) {
      toast("error", errText(e, t("brand.logoFailed")));
    } finally {
      setBusy(false);
    }
  };
  const save = () => void run(() => brandApi.patch({ name: nextName, hue: hue === BRAND_HUE.default ? null : hue, transparencyDefault }), t("brand.saved"));
  const onFile = (f: File | undefined) => {
    if (f) void run(() => brandApi.uploadLogo(f));
    if (input.current) input.current.value = "";
  };

  return (
    <SettingsPage title={t("settings.org.brand")} desc={t("settings.desc.brand")}>
      <SettingsCard>
        <div className="px-5 py-4">
          <Input label={t("brand.name")} hint={t("brand.nameHint")} value={name} placeholder={DEFAULT_BRAND_NAME} maxLength={LIMITS.brand.name.max} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium text-ink">{t("brand.hue")}</p>
            <Button variant="ghost" size="sm" type="button" className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0" disabled={hue === BRAND_HUE.default} onClick={() => pick(BRAND_HUE.default)}>
              {t("brand.default")}
            </Button>
          </div>
          <div className="[&>div]:flex-row [&>div]:flex-wrap">
            <RadioGroup value={String(hue)} onChange={(v) => pick(Number(v))} options={HUE_SWATCHES.map((h) => ({
              value: String(h),
              label: <span className="flex items-center"><span aria-hidden="true" ref={cssVars({ "--sw-h": String(h) })} className="block h-8 w-8 rounded-full bg-[oklch(0.55_0.2_var(--sw-h))]" /><span className="sr-only">{t("brand.hueSwatch", { h })}</span></span>,
            }))} />
          </div>
          {hue >= BRAND_HUE.min && hue <= BRAND_HUE.max && <input
            type="range"
            min={BRAND_HUE.min}
            max={BRAND_HUE.max}
            step={1}
            value={hue}
            aria-label={t("brand.hue")}
            onChange={(e) => pick(Number(e.target.value))}
            className="w-full accent-[var(--accent-solid)]"
          />}
          <p className="text-[12px] leading-relaxed text-faint">{t("brand.hueHint")}</p>
        </div>
        <div className="px-5 py-4">
          <RadioGroup label={t("transparency.orgLabel")} value={transparencyDefault} onChange={setTransDefault} disabled={busy} options={[
            { value: "auto", label: t("transparency.auto") },
            { value: "on", label: t("transparency.alwaysOn") },
          ]} />
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[12px] font-medium text-faint">{t("brand.preview")}</p>
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-sunken/70 px-4 py-3 ring-1 ring-inset ring-linesoft">
            <span className="flex min-w-0 items-center gap-2.5">
              <BrandMark size={22} />
              <span className="truncate font-disp text-[16px] font-bold tracking-[-0.03em] text-ink">{nextName ?? DEFAULT_BRAND_NAME}</span>
            </span>
            <span className="flex-1" />
            <span className="text-[13px] font-medium text-accent">{t("brand.previewLink")}</span>
            <Button size="sm" variant="primary" tabIndex={-1} aria-hidden>
              {t("brand.previewButton")}
            </Button>
          </div>
          {hue !== savedHue && <p className="text-[12px] text-faint">{t("brand.unsaved")}</p>}
          <div className="flex justify-end">
            <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title={t("brand.logo")}>
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-4">
            <BrandMark size={48} variant="app" />
            <BrandMark size={22} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-[12.5px] leading-relaxed text-faint">{t("brand.logoHint")}</p>
            <div className="flex flex-wrap gap-2">
              <input ref={input} type="file" accept="image/png,image/webp" className="sr-only" tabIndex={-1} aria-label={t("brand.logoUpload")} onChange={(e) => onFile(e.target.files?.[0])} />
              <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
                {t(brand.logoUpdatedAt ? "brand.logoReplace" : "brand.logoUpload")}
              </Button>
              {brand.logoUpdatedAt && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => brandApi.removeLogo())}>
                  {t("brand.logoRemove")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}

