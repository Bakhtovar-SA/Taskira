import { planningCopy } from "../i18n/planning";

export default function PlanningGuide({ lang }: { lang: "ru" | "en" }) {
  const copy = planningCopy(lang);
  return <div className="text-[13px] leading-relaxed text-sub">
    <p>{copy.intro}</p>
    <dl className="mt-3 space-y-3">{copy.rows.map(([name, explanation]) => <div key={name}>
      <dt className="font-semibold text-ink">{name}</dt><dd className="mt-0.5">{explanation}</dd>
    </div>)}</dl>
    <p className="mt-4">{copy.summary}</p>
    <p className="mt-3">{copy.photo}</p>
  </div>;
}
