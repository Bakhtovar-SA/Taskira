import { useCallback, useEffect, useRef, useState } from "react";
import { useLocationProperty } from "wouter/use-browser-location";
import { Button } from "../ds/Button";
import { RoleTag } from "./settings/parts";
import { IcBook, PriorityIcon, TypeIcon } from "../icons";
import { PERMISSIONS, ROLE_ORDER, roleHas } from "../permissions";
import { PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { useT } from "../i18n";
import { helpCopy } from "../i18n/help";
import PlanningGuide from "./PlanningGuide";

export const SECTIONS = helpCopy.ru.sections.map(({ id, label }) => ({ id, label }));
export const EN_SECTIONS = helpCopy.en.sections.map(({ id, label }) => [id, label] as const);
const currentHash = () => window.location.hash;

function useDocsNavigation(prefix: string, enabled = true) {
  const hash = useLocationProperty(currentHash, () => "");
  const rootRef = useRef<HTMLDivElement>(null);
  const requested = useRef<string | null>(null);
  const [active, setActive] = useState("overview");
  const go = useCallback((id: string) => {
    const section = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("section[id]") ?? [])
      .find(value => value.id === `${prefix}${id}`);
    if (!section) return;
    requested.current = id;
    setActive(id);
    section.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start",
    });
  }, [prefix]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>(`section[id^="${prefix}"]`));
    const update = () => {
      if (requested.current !== null) return;
      const threshold = root.getBoundingClientRect().top + 24;
      let current: HTMLElement | undefined = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= threshold) current = section;
      }
      if (root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = sections.at(-1);
      if (current) setActive(current.id.slice(prefix.length));
    };
    const resume = () => { requested.current = null; update(); };
    const resumeKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) resume();
    };
    requested.current = null;
    update();
    root.addEventListener("scroll", update, { passive: true });
    root.addEventListener("wheel", resume, { passive: true });
    root.addEventListener("touchmove", resume, { passive: true });
    root.addEventListener("pointerdown", resume);
    root.addEventListener("keydown", resumeKey);
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", update);
      root.removeEventListener("wheel", resume);
      root.removeEventListener("touchmove", resume);
      root.removeEventListener("pointerdown", resume);
      root.removeEventListener("keydown", resumeKey);
      window.removeEventListener("resize", update);
    };
  }, [prefix, enabled]);
  useEffect(() => {
    if (!enabled) return;
    try { go(decodeURIComponent(hash.slice(1))); } catch { /* Malformed URL fragment. */ }
  }, [hash, go, enabled]);
  return { rootRef, active, go };
}


export default function DocsView() {
  const { t, lang } = useT();
  const copy = helpCopy[lang];
  const prefix = lang === "en" ? "doc-en-" : "doc-";
  const { rootRef, active, go } = useDocsNavigation(prefix);
  return <div ref={rootRef} className="h-full overflow-y-auto">
    <div className="mx-auto max-w-[1060px] px-6 py-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar text-onaccent"><IcBook size={18} /></span>
        <div><h1 className="font-disp text-[17px] font-semibold text-ink">{copy.title}</h1><p className="mt-0.5 text-[11.5px] text-faint">{copy.subtitle}</p></div>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[220px_1fr]">
        <nav className="top-5 h-fit rounded-xl surface-raised p-2 ring-1 ring-inset ring-line/70 lg:sticky lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto">
          {copy.sections.map(section => <Button key={section.id} variant="ghost" size="sm" aria-current={active === section.id ? "location" : undefined}
            onClick={() => go(section.id)} className={`flex w-full rounded-md px-3 py-2 text-left text-[12.5px] ${active === section.id ? "bg-accentsoft font-semibold text-accent" : "text-sub hover:bg-hover"}`}>{section.label}</Button>)}
        </nav>
        <div className="min-w-0 space-y-4">
          {copy.sections.map((section, index) => <section key={section.id} id={`${prefix}${section.id}`} className="scroll-mt-5 rounded-xl surface-raised p-5 ring-1 ring-inset ring-line/70">
            <h2 className="font-disp text-[15px] font-semibold tracking-tight text-ink">{index + 1} · {section.label}</h2>
            {section.paragraphs.map(paragraph => <p key={paragraph} className="mt-2 text-[13px] leading-relaxed text-sub">{paragraph}</p>)}
            {section.code && <pre tabIndex={0} className="ds-focus mt-3 overflow-x-auto rounded-lg bg-sunken p-3 font-code text-[12px] leading-relaxed text-ink"><code className="font-code">{section.code}</code></pre>}
            {section.links && <ul className="mt-3 space-y-1">{section.links.map(link => <li key={link.href}><a href={link.href} className="ds-focus rounded text-[12px] text-accent underline underline-offset-4">{link.label}</a></li>)}</ul>}
            {section.id === "roles" && <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{ROLE_ORDER.map(role => <div key={role} className="rounded-lg border border-linesoft bg-sunken p-3"><RoleTag role={role} size="sm" /><p className="mt-2 text-[12px] leading-relaxed text-sub">{t(`role.${role}.desc`)}</p></div>)}</div>
              <div className="mt-4 overflow-x-auto"><table className="w-full border-collapse text-[12px]"><thead><tr className="border-b border-line text-left"><th className="px-2 py-2 text-faint">{copy.permission}</th>{ROLE_ORDER.map(role => <th key={role} className="px-2 py-2"><RoleTag role={role} size="sm" /></th>)}</tr></thead><tbody>{PERMISSIONS.map(permission => <tr key={permission.id} className="border-b border-linesoft"><td className="px-2 py-2 text-ink">{t(`permission.${permission.id}.name`)}</td>{ROLE_ORDER.map(role => <td key={role} className="px-2 py-2 text-center">{roleHas(role, permission.id) ? <span className="text-ok">✓</span> : <span className="text-faint">—</span>}</td>)}</tr>)}</tbody></table></div>
            </>}
            {section.id === "issues" && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-wrap gap-2">{TYPE_ORDER.map(type => <span key={type} className="flex items-center gap-2 rounded-lg border border-linesoft bg-sunken px-3 py-2 text-[12px]"><TypeIcon type={type} size={14} />{t(`issueType.${type}`)}</span>)}</div>
              <div className="flex flex-wrap gap-2">{PRIORITY_ORDER.map(priority => <span key={priority} className="flex items-center gap-2 rounded-lg border border-linesoft bg-sunken px-3 py-2 text-[12px]"><PriorityIcon p={priority} size={14} />{t(`priority.${priority}`)}</span>)}</div>
            </div>}
            {section.id === "planning" && <div className="mt-2"><PlanningGuide lang={lang} /></div>}
            {section.table && <div className="mt-3 overflow-x-auto"><table className="w-full border-collapse text-[12px]"><thead><tr className="border-b border-line text-left">{section.table.headers.map(header => <th key={header} className="px-2 py-2 text-faint">{header}</th>)}</tr></thead><tbody>{section.table.rows.map(row => <tr key={row[0]} className="border-b border-linesoft last:border-0">{row.map((cell, i) => <td key={i} className={`px-2 py-2 ${i === 0 ? "font-medium text-ink" : "text-sub"}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
          </section>)}
        </div>
      </div>
    </div>
  </div>;
}
