import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { parseTrelloExport } from "../import/trello";
import { parseJiraExport } from "../import/jira";
import { parseAsanaExport } from "../import/asana";
import type { ImportParseResult } from "../import/types";
import type { CreateInput } from "../store/mappers";
import { IcX } from "../icons";
import { Modal } from "../ui";
import { useT } from "../i18n";

type Source = "trello" | "jira" | "asana";
type Parsed = ImportParseResult & { boardName?: string };
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export default function ImportModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT();
  const { importIssues } = useStore();
  const [source, setSource] = useState<Source>("trello");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileError, setFileError] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ ok: number; failed: number; cancelled: boolean } | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const readerRef = useRef<FileReader | null>(null);
  useEffect(() => () => { mountedRef.current = false; readerRef.current?.abort(); }, []);

  const selectSource = (next: Source) => {
    readerRef.current?.abort();
    setSource(next); setParsed(null); setFileError(""); setResult(null);
    setProgress(null); setIncludeClosed(false);
  };

  const onFile = (file: File) => {
    readerRef.current?.abort();
    setFileError(""); setParsed(null); setResult(null); setProgress(null);
    if (file.size > MAX_FILE_BYTES) { setFileError(t("import.tooLarge")); return; }
    const reader = new FileReader();
    readerRef.current = reader;
    reader.onload = () => {
      try {
        const text = String(reader.result);
        setParsed(source === "trello" ? parseTrelloExport(JSON.parse(text))
          : source === "jira" ? parseJiraExport(text) : parseAsanaExport(text));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const missing = message.includes("нет колонки");
        setFileError(missing ? t(source === "jira" ? "import.notJira" : "import.notAsana")
          : lang === "ru" && message ? message : t("import.parseFailed"));
      }
    };
    reader.onerror = () => setFileError(t("import.readFailed"));
    reader.readAsText(file);
  };

  const importable = useMemo(() => parsed?.items.filter((item) => includeClosed || !item.closed) ?? [], [parsed, includeClosed]);
  const closedCount = useMemo(() => parsed?.items.filter((item) => item.closed).length ?? 0, [parsed]);

  const runImport = async () => {
    if (!importable.length || running || result) return;
    cancelledRef.current = false;
    setRunning(true); setProgress({ done: 0, total: importable.length });
    const inputs: CreateInput[] = importable.map((item) => ({
      title: item.title, description: item.description,
      typeId: item.typeId ?? "task", priorityId: item.priorityId ?? "medium",
      assigneeIds: [], epicId: null, labels: item.labels, complexity: null, dueDate: item.dueDate,
    }));
    try {
      const outcome = await importIssues(inputs,
        (done, total) => { if (mountedRef.current) setProgress({ done, total }); },
        () => cancelledRef.current);
      if (mountedRef.current) setResult(outcome);
    } catch {
      if (mountedRef.current) setFileError(t("import.createFailed"));
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  };

  const handleClose = () => { if (running) cancelledRef.current = true; onClose(); };

  return <Modal onClose={handleClose} w={520} title={t("import.title")}>
    <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
      <span className="font-disp text-[14px] font-semibold text-ink">{t("import.title")}</span>
      <button onClick={handleClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink" aria-label={t("common.close")}><IcX size={15} /></button>
    </div>
    <div className="space-y-4 px-5 py-4">
      <div>
        <label htmlFor="import-source" className="mb-1.5 block text-[12px] font-medium text-faint">{t("import.source")}</label>
        <select id="import-source" value={source} disabled={running} onChange={(e) => selectSource(e.target.value as Source)} className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[12.5px] text-ink">
          <option value="trello">Trello (JSON)</option><option value="jira">Jira (CSV)</option><option value="asana">Asana (CSV)</option>
        </select>
      </div>
      <div>
        <label htmlFor="import-file" className="mb-1.5 block text-[12px] font-medium text-faint">{t("import.file")}</label>
        <p className="mb-2 text-[11.5px] leading-relaxed text-faint">{t(source === "trello" ? "import.trelloInstructions" : source === "jira" ? "import.jiraInstructions" : "import.asanaInstructions")}</p>
        <input key={source} id="import-file" type="file" accept={source === "trello" ? ".json,application/json" : ".csv,text/csv"} disabled={running}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          className="w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-ink hover:file:border-accent" />
        {fileError && <p role="alert" className="mt-1.5 text-[11.5px] font-semibold text-danger">{fileError}</p>}
      </div>
      {parsed && <div className="rounded-md border border-line bg-sunken px-3 py-2.5 text-[12.5px]">
        {parsed.boardName && <p className="font-semibold text-ink">«{parsed.boardName}»</p>}
        <p className="mt-0.5 text-faint">{t("import.found", { count: parsed.items.length })} {parsed.skipped > 0 && t("import.skipped", { count: parsed.skipped })}</p>
        {!!parsed.unrecognizedDates && <p className="mt-1 text-faint">{t("import.badDates", { count: parsed.unrecognizedDates })}</p>}
        {!!parsed.truncatedDescriptions && <p className="mt-1 text-faint">{t("import.truncatedDescriptions", { count: parsed.truncatedDescriptions })}</p>}
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-sub">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          {t("import.includeClosed", { count: closedCount })}
        </label>
        <p className="mt-1.5 font-semibold text-ink">{t("import.willCreate", { count: importable.length })}</p>
      </div>}
      {progress && <div className="rounded-md bg-linesoft px-3 py-2">
        <progress value={progress.done} max={progress.total} aria-label={t("import.progress")} className="w-full accent-accent" />
        <p className="mt-1.5 text-[11.5px] text-sub">{progress.done} / {progress.total}</p>
      </div>}
      {result && <p className="text-[12.5px] font-semibold text-ink">{result.cancelled
        ? t("import.stopped", { ok: result.ok, total: importable.length })
        : t("import.imported", { ok: result.ok, total: result.ok + result.failed })} {result.failed > 0 && t("import.failed", { count: result.failed })}</p>}
      <div className="flex items-center gap-3">
        <button onClick={() => void runImport()} disabled={!parsed || !importable.length || running || !!result} className="rounded-lg btn-primary px-4 py-2 text-[13px] font-medium text-onaccent disabled:cursor-not-allowed disabled:opacity-50">
          {running ? t("import.importing") : t("import.start", { count: importable.length ? ` (${importable.length})` : "" })}
        </button>
        <button onClick={handleClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-sub hover:bg-hover">{result ? t("toast.success") : t("common.cancel")}</button>
      </div>
    </div>
  </Modal>;
}
