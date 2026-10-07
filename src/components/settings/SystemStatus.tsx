/** Административный снимок состояния: явное обновление, приоритет сбоев, история только по раскрытию. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { OpsKind, OpsRunDto, StatusState, SystemCheck, SystemStatusDto } from "../../../server/src/contract";
import { adminApi } from "../../api";
import { Button } from "../../ds/Button";
import { SkeletonCard, Tag } from "../../ds/Display";
import { useT } from "../../i18n";
import { SettingsPage } from "./parts";

const priority: Record<StatusState, number> = { fail: 0, warn: 1, unknown: 2, ok: 3, off: 4 };
const tone = { fail: "red", warn: "amber", ok: "green", unknown: "gray", off: "gray" } as const;
const linkClass = "ds-focus inline-flex rounded text-[12px] font-medium text-accent underline underline-offset-4";
const jobLabels = { maintenance: "status.job.maintenance", "storage-sweep": "status.job.storage-sweep", "ldap-resync": "status.job.ldap-resync",
  "webhook-dispatch": "status.job.webhook-dispatch", "due-events": "status.job.due-events", recurring: "status.job.recurring" } as const;
const licenseLabels = { unset: "status.fact.license.unset", invalid: "status.fact.license.invalid", active: "status.fact.license.active",
  expired: "status.fact.license.expired" } as const;

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  const { t, errText } = useT();
  return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl surface-raised px-5 py-4 ring-1 ring-inset ring-linesoft">
    <p className="min-w-0 flex-1 text-[12.5px] text-danger">{errText(error, t("settings.org.loadFailed"))}</p>
    <Button variant="secondary" size="sm" onClick={retry}>{t("common.retry")}</Button>
  </div>;
}

function useFormats(checkedAt: string) {
  const { t, lang } = useT(); const locale = lang === "en" ? "en-GB" : "ru-RU";
  const number = (value: number): string => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const date = (value: string): string => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const relative = (value: string | null): string => {
    if (!value) return t("status.fact.never");
    const seconds = (Date.parse(value) - Date.parse(checkedAt)) / 1000;
    const [scale, unit] = Math.abs(seconds) >= 86400 ? [86400, "day"] as const : Math.abs(seconds) >= 3600 ? [3600, "hour"] as const
      : Math.abs(seconds) >= 60 ? [60, "minute"] as const : [1, "second"] as const;
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(seconds / scale), unit);
  };
  const bytes = (value: number | null): string => {
    if (value === null) return t("status.fact.unavailable");
    const [scale, unit] = value >= 1024 ** 3 ? [1024 ** 3, "GiB"] as const : value >= 1024 ** 2 ? [1024 ** 2, "MiB"] as const : [1024, "KiB"] as const;
    return t(`status.fact.${unit}`, { value: number(value / scale) });
  };
  return { number, date, relative, bytes };
}

function CheckFacts({ check, checkedAt }: { check: SystemCheck; checkedAt: string }) {
  const { t } = useT(); const { number, relative, bytes } = useFormats(checkedAt);
  if (check.state === "unknown") return <p className="mt-3 text-[12px] text-sub">{t("status.fact.unknown")}</p>;
  let facts: string[];
  switch (check.id) {
    case "database": facts = [check.facts.latencyMs === null ? t("status.fact.databaseUnavailable") : t("status.fact.latency", { value: number(check.facts.latencyMs) }),
      check.facts.pendingMigrations.length ? t("status.fact.pendingMigrations", { names: check.facts.pendingMigrations.join(", ") }) : t("status.fact.migrationsReady")]; break;
    case "storage": facts = [t(`status.fact.driver.${check.facts.driver}`)];
      if (check.facts.freeBytes !== null) facts.push(t("status.fact.free", { free: bytes(check.facts.freeBytes), total: bytes(check.facts.totalBytes) }));
      if (check.state === "fail" || check.state === "warn") facts.push(t(check.facts.freeBytes === null ? "status.fact.storageUnavailable" : "status.fact.storageSpace")); break;
    case "mail": facts = check.state === "off" ? [t("status.fact.mailOff")] : check.state === "fail" ? [t("status.fact.smtpMissing")]
      : [t("status.fact.pending", { count: number(check.facts.pending) }), t("status.fact.failed24h", { count: number(check.facts.failed24h) })];
      if (check.facts.oldestPendingSec !== null) facts.push(t("status.fact.oldest", { age: relative(new Date(Date.parse(checkedAt) - check.facts.oldestPendingSec * 1000).toISOString()) })); break;
    case "ldap": facts = check.state === "off" ? [t(check.facts.mode === "local" ? "status.fact.localAuth" : "status.fact.ldapOff")]
      : [t("status.fact.lastSuccess", { age: relative(check.facts.lastSuccessAt) }), ...(check.facts.lastError ? [t("status.fact.ldapError")] : [])]; break;
    case "jobs": {
      facts = [t("status.fact.jobs", { count: number(check.facts.jobs.length) })];
      const errors = check.facts.jobs.filter(job => job.lastResult === "error");
      if (errors.length) facts.push(t("status.fact.jobErrors", { names: errors.map(job => Object.prototype.hasOwnProperty.call(jobLabels, job.name) ? t(jobLabels[job.name as keyof typeof jobLabels]) : job.name).join(", ") }));
      const successes = check.facts.jobs.map(job => job.lastSuccessAt).filter((value): value is string => value !== null).sort();
      if (check.facts.jobs.length) facts.push(t("status.fact.oldestSuccess", { age: relative(successes[0] ?? null) })); break;
    }
    case "license": facts = [t(Object.prototype.hasOwnProperty.call(licenseLabels, check.facts.status) ? licenseLabels[check.facts.status as keyof typeof licenseLabels] : "status.fact.license.unknown")];
      if (check.facts.expiresAt) facts.push(t("status.fact.expires", { age: relative(check.facts.expiresAt) }));
      if (check.facts.seatsUsed !== null && check.facts.seatsLimit !== null) facts.push(t("status.fact.seats", { used: number(check.facts.seatsUsed), limit: number(check.facts.seatsLimit) })); break;
    case "search": facts = check.facts.missingIndexes.length ? [t("status.fact.missingIndexes", { names: check.facts.missingIndexes.join(", ") }), t("status.fact.searchSlow")]
      : [t("status.fact.indexesReady")]; break;
    case "backup": case "restoreDrill": facts = [check.facts.lastResult ? t("status.fact.lastResult", { result: t(`status.ops.result.${check.facts.lastResult}`), age: relative(check.facts.lastRunAt) }) : t("status.ops.empty"),
      t("status.fact.lastSuccess", { age: relative(check.facts.lastSuccessAt) })];
      if (check.facts.archive) facts.push(t("status.fact.archive", { name: check.facts.archive })); break;
    case "webhooks": facts = [t("status.fact.webhooks", { active: number(check.facts.active), disabled: number(check.facts.disabled) }),
      t("status.fact.queueFailures", { pending: number(check.facts.pending), failed: number(check.facts.failed24h) })];
      if (check.facts.oldestPendingSec !== null) facts.push(t("status.fact.oldest", { age: relative(new Date(Date.parse(checkedAt) - check.facts.oldestPendingSec * 1000).toISOString()) })); break;
    case "recurring": facts = [t("status.fact.rules", { active: number(check.facts.active), paused: number(check.facts.paused) }),
      t("status.fact.ownerLost", { count: number(check.facts.ownerLostAccess) }), t("status.fact.failed24h", { count: number(check.facts.failed24h) })]; break;
  }
  return <ul className="mt-3 flex flex-col gap-1.5 text-[12px] leading-relaxed text-sub">{facts.map((fact, index) => <li key={index} className="break-words">{fact}</li>)}</ul>;
}

function OpsHistory({ kind, checkedAt }: { kind: OpsKind; checkedAt: string }) {
  const { t } = useT(); const { date } = useFormats(checkedAt);
  const [runs, setRuns] = useState<OpsRunDto[] | null>(null), [error, setError] = useState<unknown>(null);
  const requested = useRef(false), epoch = useRef(0);
  useEffect(() => () => { ++epoch.current; }, []);
  const load = () => {
    if (requested.current) return; requested.current = true; setError(null);
    const current = ++epoch.current;
    adminApi.opsRuns(kind).then(value => { if (current === epoch.current) setRuns(value); }, failure => {
      if (current === epoch.current) { setError(failure); requested.current = false; }
    });
  };
  return <details className="mt-3 border-t border-linesoft pt-3" onToggle={event => { if (event.currentTarget.open) load(); }}>
    <summary className="ds-focus cursor-pointer rounded text-[12px] font-medium text-ink">{t("status.ops.history")}</summary>
    <div className="mt-3">
      {error ? <Failed error={error} retry={load} /> : runs === null ? <p role="status" className="text-[12px] text-sub">{t("common.loading")}</p>
        : runs.length === 0 ? <p className="text-[12px] text-sub">{t("status.ops.empty")}</p>
        : <ol className="flex flex-col gap-3">{runs.map(run => <li key={run.id} className="text-[12px] leading-relaxed">
          <div className="flex flex-wrap items-center justify-between gap-2"><time dateTime={run.startedAt} className="text-sub">{date(run.startedAt)}</time>
            <Tag size="sm" tone={run.result === "success" ? "green" : run.result === "failure" || run.result === "interrupted" ? "red" : "gray"}>{t(`status.ops.result.${run.result}`)}</Tag></div>
          {run.archive && <p className="mt-1 break-words text-ink">{run.archive}</p>}
          {run.error && <p className="mt-1 whitespace-pre-wrap break-words text-danger">{run.error}</p>}
        </li>)}</ol>}
    </div>
  </details>;
}

function CheckAction({ id }: { id: SystemCheck["id"] }) {
  const { t } = useT();
  const [href, text] = id === "jobs" || id === "mail" ? ["/admin/maintenance", t("status.action.maintenance")]
    : id === "license" ? ["/admin/license", t("status.action.license")] : id === "ldap" ? ["/admin/ldap", t("status.action.ldap")]
    : id === "webhooks" ? ["/help", t("status.action.webhooks")] : id === "recurring" ? ["/help", t("status.action.recurring")]
    : id === "backup" || id === "restoreDrill" ? ["/help", t("status.action.backup")] : ["/help", t("status.action.help")];
  return <Link href={href} className={linkClass}>{text}</Link>;
}

export default function SystemStatus() {
  const { t, tn } = useT();
  const [status, setStatus] = useState<SystemStatusDto | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true);
  const epoch = useRef(0);
  const load = useCallback(() => {
    const current = ++epoch.current; setLoading(true); setError(null);
    adminApi.status().then(value => { if (current === epoch.current) { setStatus(value); setLoading(false); } }, failure => {
      if (current === epoch.current) { setError(failure); setLoading(false); }
    });
  }, []);
  useEffect(() => { load(); return () => { ++epoch.current; }; }, [load]);
  const fails = status?.checks.filter(check => check.state === "fail").length ?? 0, warns = status?.checks.filter(check => check.state === "warn").length ?? 0;
  const { date, number } = useFormats(status?.checkedAt ?? new Date().toISOString());
  const summary = !fails && !warns ? t("status.summary.ok") : t("status.summary.problems", { fails: number(fails), warns: number(warns),
    failure: tn(fails, "status.summary.failure.one", "status.summary.failure.few", "status.summary.failure.many"),
    warning: tn(warns, "status.summary.warning.one", "status.summary.warning.few", "status.summary.warning.many") });
  return <SettingsPage title={t("settings.org.health")} desc={t("settings.desc.health")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      {!loading && !error && status && <p role="status" className="text-[13px] font-medium text-ink">{summary}</p>}
      <Button variant="secondary" size="sm" loading={loading} onClick={load}>{t("settings.org.refresh")}</Button>
    </div>
    {loading ? <div role="status" aria-label={t("common.loading")} aria-busy="true" className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map(key => <SkeletonCard key={key} />)}</div>
      : error ? <Failed error={error} retry={load} /> : status && <>
        <p className="text-[11.5px] text-sub">{t("status.checkedAt")} <time dateTime={status.checkedAt}>{date(status.checkedAt)}</time> · {t("status.version", { version: status.version })}</p>
        <ul aria-label={t("status.checks")} className="grid items-start gap-4 sm:grid-cols-2">{[...status.checks].sort((a, b) => priority[a.state] - priority[b.state]).map(check => <li key={check.id} className="surface-raised min-w-0 rounded-xl px-5 py-4 ring-1 ring-inset ring-linesoft">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[13px] font-semibold text-ink">{t(`status.check.${check.id}`)}</h2><Tag tone={tone[check.state]} size="sm" strong dot>{t(`status.state.${check.state}`)}</Tag></div>
          <CheckFacts check={check} checkedAt={status.checkedAt} />
          <p className="mt-3"><CheckAction id={check.id} /></p>
          {(check.id === "backup" || check.id === "restoreDrill") && <OpsHistory key={`${check.id}:${status.checkedAt}`} kind={check.id === "backup" ? "backup" : "restore_drill"} checkedAt={status.checkedAt} />}
        </li>)}</ul>
      </>}
  </SettingsPage>;
}
