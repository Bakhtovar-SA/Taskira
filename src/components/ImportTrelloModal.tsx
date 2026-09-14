import { useState } from "react";
import { useStore } from "../store";
import { parseTrelloExport, type TrelloParseResult } from "../import/trello";
import type { CreateInput } from "../store";
import { IcX } from "../icons";
import { Modal } from "../ui";

/** Импорт задач из JSON-экспорта доски Trello (Меню → Ещё → Печать и экспорт →
 *  Экспортировать как JSON). Разбор файла — parseTrelloExport (чистая функция,
 *  своими тестами); сама запись — store.importIssues(), тем же POST /issues,
 *  что обычное создание задачи, по одному запросу на карточку. */
export default function ImportTrelloModal({ onClose }: { onClose: () => void }) {
  const { importIssues } = useStore();
  const [parsed, setParsed] = useState<TrelloParseResult | null>(null);
  const [fileError, setFileError] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);

  const onFile = (file: File) => {
    setFileError("");
    setParsed(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        setParsed(parseTrelloExport(json));
      } catch (e) {
        setFileError(e instanceof Error ? e.message : "Не удалось разобрать файл");
      }
    };
    reader.onerror = () => setFileError("Не удалось прочитать файл");
    reader.readAsText(file);
  };

  const importable = parsed ? parsed.items.filter((i) => includeClosed || !i.closed) : [];

  const runImport = async () => {
    if (importable.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: importable.length });
    const inputs: CreateInput[] = importable.map((i) => ({
      title: i.title,
      description: i.description,
      typeId: "task",
      priorityId: "medium",
      assigneeId: null,
      epicId: null,
      labels: i.labels,
      complexity: null,
      dueDate: i.dueDate,
    }));
    const r = await importIssues(inputs, (done, total) => setProgress({ done, total }));
    setRunning(false);
    setResult(r);
  };

  return (
    <Modal onClose={onClose} w={520} title="Импорт из Trello">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="font-disp text-[14px] font-bold text-ink">Импорт из Trello</span>
        <button onClick={onClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-canvas hover:text-ink" aria-label="Закрыть">
          <IcX size={15} />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">JSON-экспорт доски</p>
          <p className="mb-2 text-[11.5px] leading-relaxed text-faint">
            В Trello: меню доски → «Ещё» → «Печать и экспорт» → «Экспортировать как JSON». Импорт из Jira/Asana — отдельная задача, не поддерживается здесь.
          </p>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-ink hover:file:border-accent"
          />
          {fileError && <p className="mt-1.5 text-[11.5px] font-semibold text-danger">{fileError}</p>}
        </div>

        {parsed && (
          <div className="rounded-md border border-line bg-canvas/50 px-3 py-2.5 text-[12.5px]">
            <p className="font-semibold text-ink">«{parsed.boardName}»</p>
            <p className="mt-0.5 text-faint">
              Найдено карточек: {parsed.items.length}
              {parsed.skipped > 0 && ` (пропущено без названия: ${parsed.skipped})`}
            </p>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-sub">
              <input
                type="checkbox"
                checked={includeClosed}
                onChange={(e) => setIncludeClosed(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              включая архивные карточки Trello ({parsed.items.filter((i) => i.closed).length})
            </label>
            <p className="mt-1.5 font-semibold text-ink">Будет создано: {importable.length}</p>
          </div>
        )}

        {progress && (
          <div className="rounded-md bg-linesoft px-3 py-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-sub">{progress.done} / {progress.total}</p>
          </div>
        )}

        {result && (
          <p className="text-[12.5px] font-semibold text-ink">
            Импортировано {result.ok} из {result.ok + result.failed}
            {result.failed > 0 && `, не удалось: ${result.failed}`}.
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => void runImport()}
            disabled={!parsed || importable.length === 0 || running}
            className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] transition-all hover:bg-accentdeep active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Импортирую…" : `Импортировать${importable.length ? ` (${importable.length})` : ""}`}
          </button>
          <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-sub hover:bg-canvas">
            {result ? "Готово" : "Отмена"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
