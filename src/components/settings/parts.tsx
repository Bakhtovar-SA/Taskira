/** Каркас страниц настроек (ТЗ 5.9): заголовок, пояснение, карточки со строками «подпись — управление». */
import type { ReactNode } from "react";

/** Каркас новой страницы настроек: заголовок, пояснение, карточки. */
export function SettingsPage({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[760px] px-5 py-6 sm:px-8">
      <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      {desc && <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-sub">{desc}</p>}
      <div className="mt-6 flex flex-col gap-5">{children}</div>
    </div>
  );
}

export function SettingsCard({ title, children, footer }: { title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
      {title && <h2 className="border-b border-linesoft px-5 py-3 text-[13px] font-semibold text-ink">{title}</h2>}
      <div className="flex flex-col divide-y divide-linesoft">{children}</div>
      {footer && <div className="border-t border-linesoft bg-sunken/60 px-5 py-2.5 text-[11.5px] text-faint">{footer}</div>}
    </section>
  );
}

/** Строка настройки: подпись и пояснение слева, управление справа (на узком экране — под ними). */
export function SettingRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
