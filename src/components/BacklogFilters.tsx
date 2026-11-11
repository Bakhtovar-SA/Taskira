/** Фильтры списка задач: срок, своё поле, заглушка строки. Вынесено из Backlog.tsx без изменения поведения. */
import { type ReactNode } from "react";
import { fmtDate } from "../store/mappers";
import type { CustomFieldDef } from "../types";
import { IcCalendar, IcCheck, IcChevD, IcFilter } from "../icons";
import { Button } from "../ds/Button";
import { DatePicker } from "../ds/DatePicker";
import { Skeleton } from "../ds/Display";
import { Popover } from "../ds/Overlay";
import { useT } from "../i18n";
import { type FilterState } from "../router";

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDaysLocal = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** «Срок»: готовые периоды считаются от сегодняшнего дня в момент выбора и дальше живут как обычные даты «с … по …»
 *  (так их можно сохранить в фильтр и поделиться ссылкой); «Свои даты» — два поля. */
export function DueRangeFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t, lang } = useT();
  const today = new Date();
  const monday = addDaysLocal(today, -((today.getDay() + 6) % 7));
  const presets: { key: string; from: string; to: string }[] = [
    { key: "backlog.due.today", from: isoDay(today), to: isoDay(today) },
    { key: "backlog.due.thisWeek", from: isoDay(monday), to: isoDay(addDaysLocal(monday, 6)) },
    { key: "backlog.due.next7", from: isoDay(today), to: isoDay(addDaysLocal(today, 7)) },
    { key: "backlog.due.thisMonth", from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)) },
  ];
  const fmt = (s: string) => fmtDate(s, lang);
  const active = !!(from || to);
  const label = !active ? t("backlog.due.any") : from && to && from === to ? fmt(from) : `${from ? fmt(from) : "…"} – ${to ? fmt(to) : "…"}`;
  return (
    <Popover
      label={t("field.dueDate")}
      className="w-[250px]"
      trigger={(p, open) => (
        <Button size="sm"
          {...p}
          type="button"
          aria-label={`${t("field.dueDate")}: ${label}`}
          className={(open || active) ? "border-accent" : undefined}
        >
          <IcCalendar size={14} className="text-faint" />
          <span className="tabular">{active ? label : t("field.dueDate")}</span>
          <IcChevD size={13} className="text-faint" />
        </Button>
      )}
    >
      {(close) => (
        <>
          {presets.map((p) => (
            <MenuButton key={p.key} onClick={() => { onChange(p.from, p.to); close(); }}>
              {t(p.key as never)}
              {from === p.from && to === p.to && <IcCheck size={14} className="ml-auto text-accenttext" />}
            </MenuButton>
          ))}
          <div role="separator" className="ds-menu-sep" />
          <div className="grid grid-cols-2 gap-1.5 px-2.5 py-1.5">
            <div className="text-[12px] font-medium text-faint">
              {t("backlog.due.from")}
              <DatePicker block label={t("backlog.due.from")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={from || null} max={to || undefined} onChange={(v) => onChange(v ?? "", to)} />
            </div>
            <div className="text-[12px] font-medium text-faint">
              {t("backlog.due.to")}
              <DatePicker block label={t("backlog.due.to")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={to || null} min={from || undefined} onChange={(v) => onChange(from, v ?? "")} />
            </div>
          </div>
          {active && (
            <MenuButton onClick={() => { onChange("", ""); close(); }}>{t("backlog.due.clear")}</MenuButton>
          )}
        </>
      )}
    </Popover>
  );
}

/** Заглушка строки таблицы на время загрузки — из ds-примитивов, по форме строки (флажок/тип, ключ, название, поле, исполнитель). */
export function ListSkeletonRow() {
  return (
    <div className="flex items-center gap-3 border-b border-linesoft px-3.5 py-3 last:border-0">
      <Skeleton.Line w="14px" h={14} />
      <Skeleton.Line w="56px" h={12} />
      <span className="min-w-0 max-w-[320px] flex-1">
        <Skeleton.Line h={12} />
      </span>
      <span className="hidden sm:block">
        <Skeleton.Line w="64px" h={16} />
      </span>
      <Skeleton.Circle size={16} />
    </div>
  );
}

/** Пункт внутри Popover (там, где кроме пунктов есть поля и Menu не подходит) — вид пункта ds-меню. */
export function MenuButton({ onClick, className = "", children }: { onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`ds-menu-item ${className}`}>
      {children}
    </button>
  );
}

type CfPart = Pick<FilterState, "cf" | "cfValue" | "cfFrom" | "cfTo" | "cfEmpty">;
export const CF_CLEAR: CfPart = { cf: "", cfValue: "", cfFrom: "", cfTo: "", cfEmpty: "" };

/** Условие по своему полю проекта (ROUTE-02): сначала поле, потом условие по его типу. Одно поле на набор — как
 *  остальные условия списка; смысл значений считает сервер (buildIssueFilter). */
export function CustomFieldFilter({ fields, value, onChange }: { fields: CustomFieldDef[]; value: CfPart; onChange: (next: CfPart) => void }) {
  const { t, lang } = useT();
  const field = fields.find((f) => f.id === value.cf);
  const set = (part: Partial<CfPart>) => onChange({ ...CF_CLEAR, cf: value.cf, ...part });
  const fmt = (v: string) => (field?.fieldType === "date" ? fmtDate(v, lang) : v);
  const summary = !field
    ? ""
    : value.cfEmpty
      ? t("backlog.cf.empty")
      : field.fieldType === "checkbox"
        ? value.cfValue === "true"
          ? t("backlog.cf.checked")
          : value.cfValue === "false"
            ? t("backlog.cf.unchecked")
            : ""
        : value.cfFrom || value.cfTo
          ? value.cfFrom && value.cfTo && value.cfFrom === value.cfTo
            ? fmt(value.cfFrom)
            : `${value.cfFrom ? fmt(value.cfFrom) : "…"} – ${value.cfTo ? fmt(value.cfTo) : "…"}`
          : value.cfValue;
  const active = !!(field && summary);
  const inputCls = "mt-0.5 h-7 w-full rounded border border-line bg-panel px-1.5 text-[13px] text-ink outline-none focus:border-accent";
  const check = (on: boolean) => (on ? <IcCheck size={14} className="ml-auto text-accenttext" /> : null);
  return (
    <Popover
      label={t("backlog.cf.button")}
      className="w-[250px]"
      trigger={(p, open) => (
        <Button size="sm"
          {...p}
          type="button"
          aria-label={active ? `${field!.name}: ${summary}` : t("backlog.cf.button")}
          className={(open || active) ? "border-accent" : undefined}
        >
          <IcFilter size={14} className="shrink-0 text-faint" />
          <span className="truncate">{active ? `${field!.name}: ${summary}` : t("backlog.cf.button")}</span>
          <IcChevD size={13} className="shrink-0 text-faint" />
        </Button>
      )}
    >
      {(close) =>
        !field ? (
          <>
            <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-faint">{t("backlog.cf.pick")}</div>
            {fields.map((f) => (
              <MenuButton key={f.id} onClick={() => onChange({ ...CF_CLEAR, cf: f.id })}>
                <span className="truncate">{f.name}</span>
              </MenuButton>
            ))}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{field.name}</span>
              <button type="button" onClick={() => onChange(CF_CLEAR)} className="shrink-0 text-[12.5px] font-medium text-accenttext hover:underline">
                {t("backlog.cf.other")}
              </button>
            </div>
            {field.fieldType === "select" &&
              field.options.map((o) => (
                <MenuButton key={o} onClick={() => { set({ cfValue: o }); close(); }}>
                  <span className="truncate">{o}</span>
                  {check(!value.cfEmpty && value.cfValue === o)}
                </MenuButton>
              ))}
            {field.fieldType === "checkbox" && (
              <>
                <MenuButton onClick={() => { set({ cfValue: "true" }); close(); }}>
                  {t("backlog.cf.checked")}
                  {check(value.cfValue === "true")}
                </MenuButton>
                <MenuButton onClick={() => { set({ cfValue: "false" }); close(); }}>
                  {t("backlog.cf.unchecked")}
                  {check(value.cfValue === "false")}
                </MenuButton>
              </>
            )}
            {field.fieldType === "text" && (
              <label className="block px-2.5 py-1.5 text-[12px] font-medium text-faint">
                {t("backlog.cf.contains")}
                <input
                  autoFocus
                  value={value.cfEmpty ? "" : value.cfValue}
                  maxLength={500}
                  onChange={(e) => set({ cfValue: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && close()}
                  className={inputCls}
                />
              </label>
            )}
            {(field.fieldType === "number" || field.fieldType === "date") && (
              <div className="grid grid-cols-2 gap-1.5 px-2.5 py-1.5">
                <label className="text-[12px] font-medium text-faint">
                  {t("backlog.cf.from")}
                  <input
                    type={field.fieldType === "date" ? "date" : "number"}
                    value={value.cfFrom}
                    max={field.fieldType === "date" ? value.cfTo || undefined : undefined}
                    onChange={(e) => set({ cfFrom: e.target.value, cfTo: value.cfTo })}
                    className={`${inputCls} tabular`}
                  />
                </label>
                <label className="text-[12px] font-medium text-faint">
                  {t("backlog.cf.to")}
                  <input
                    type={field.fieldType === "date" ? "date" : "number"}
                    value={value.cfTo}
                    min={field.fieldType === "date" ? value.cfFrom || undefined : undefined}
                    onChange={(e) => set({ cfFrom: value.cfFrom, cfTo: e.target.value })}
                    className={`${inputCls} tabular`}
                  />
                </label>
              </div>
            )}
            {field.fieldType !== "checkbox" && (
              <MenuButton onClick={() => { set({ cfEmpty: "1" }); close(); }}>
                {t("backlog.cf.empty")}
                {check(!!value.cfEmpty)}
              </MenuButton>
            )}
            {active && (
              <>
                <div role="separator" className="ds-menu-sep" />
                <MenuButton onClick={() => { onChange(CF_CLEAR); close(); }}>{t("backlog.cf.clear")}</MenuButton>
              </>
            )}
          </>
        )
      }
    </Popover>
  );
}
