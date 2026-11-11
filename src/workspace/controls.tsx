import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../ds/Button";
import { Input } from "../ds/Field";
import { DatePicker } from "../ds/DatePicker";
import { IcChevD, IcPlus } from "../icons";
import { useT } from "../i18n";
import { workspaceCopy } from "../i18n/workspace";

export function DateField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { lang } = useT();
  if (disabled) return <Input label={label} value={value} disabled readOnly />;
  return (
    <div className="ds-field">
      <span className="ds-label">{label}</span>
      <DatePicker
        label={label}
        value={value || null}
        onChange={(v) => onChange(v || "")}
        lang={lang}
        block
        markOverdue={false}
      />
    </div>
  );
}

export function FileUpload({
  onFile,
  busy = false,
}: {
  onFile: (file: File) => void | Promise<unknown>;
  busy?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    { lang } = useT(),
    c = workspaceCopy(lang);
  return (
    <div className="workspace-upload">
      <input
        ref={input}
        hidden
        type="file"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
      <Button
        loading={busy}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <IcPlus size={16} />
        {c.addFile}
      </Button>
    </div>
  );
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  className = "",
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen),
    id = useId();
  return (
    <section className={`workspace-disclosure ${className}`} data-open={open}>
      <Button
        className="workspace-disclosure-toggle"
        variant="ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <IcChevD size={16} />
        {title}
      </Button>
      <div
        id={id}
        className="workspace-disclosure-body"
        aria-hidden={!open}
        inert={!open}
      >
        <div>
          <div className="workspace-disclosure-content">{children}</div>
        </div>
      </div>
    </section>
  );
}
