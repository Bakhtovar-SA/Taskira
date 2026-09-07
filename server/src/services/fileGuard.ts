/** Проверка загружаемого файла (FILES_MIGRATION.md D3).
 *
 *  Три барьера:
 *   1) чёрный список расширений (config.storage.blockExt);
 *   2) magic-байты: исполняемая/скриптовая сигнатура -> отказ, даже если
 *      расширение безобидное (переименованный .exe -> .jpg);
 *   3) несовпадение расширения и подтверждённой сигнатуры (расширение .jpg,
 *      а внутри ZIP/PDF/PE) -> отказ.
 *
 *  Никакой внешней зависимости - таблица сигнатур инлайн; нам нужен только
 *  детект "это исполняемое?" и грубое "jpg/png/pdf/zip/...".
 */
import { ApiHttpError } from "../errors.js";

/** Сколько байт с начала файла достаточно для всех сигнатур ниже. */
export const HEAD_BYTES = 512;

const bad = (reason: string): never => {
  throw new ApiHttpError(400, "ATTACHMENT_REJECTED", reason);
};

/* ---------------- имя файла ---------------- */

/** Windows-зарезервированные имена (регистронезависимо, без учёта расширения). */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const BOM = 0xfeff;

/** Управляющий символ (C0 + DEL) — вырезаем из имени файла. */
const isCtrl = (ch: string): boolean => {
  const n = ch.charCodeAt(0);
  return n < 32 || n === 127;
};

/** Убирает путь, управляющие символы, ведущие/замыкающие точки-пробелы;
 *  схлопывает пробелы; режет до maxLen с сохранением расширения. */
export function sanitizeFilename(raw: string, maxLen: number): string {
  let name = String(raw ?? "");
  name = name.split(/[/\\]/).pop() ?? ""; // отсечь путь (unix и windows)
  name = [...name].filter((c) => !isCtrl(c)).join("");
  name = name.replace(/\s+/g, " ").replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (!name) name = "attachment";

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : ""; // с точкой

  if (RESERVED.test(stem)) return `_${name}`.slice(0, maxLen);

  if (name.length > maxLen) {
    const keep = Math.max(1, maxLen - ext.length);
    return (stem.slice(0, keep) + ext).slice(0, maxLen);
  }
  return name;
}

/** Расширение в нижнем регистре без точки, либо "". */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/* ---------------- сигнатуры ---------------- */

type SigId =
  | "pe"
  | "elf"
  | "macho"
  | "script"
  | "png"
  | "jpeg"
  | "gif"
  | "pdf"
  | "zip"
  | "rar"
  | "7z"
  | "gzip"
  | "svg"
  | "xml";

const EXECUTABLE_SIGS = new Set<SigId>(["pe", "elf", "macho", "script"]);

/** Начинается ли буфер с указанных байт (с необязательным смещением). */
const starts = (b: Buffer, bytes: number[], off = 0): boolean =>
  b.length >= off + bytes.length && bytes.every((x, i) => b[off + i] === x);

const asciiAt = (b: Buffer, s: string, off = 0): boolean =>
  starts(
    b,
    [...s].map((c) => c.charCodeAt(0)),
    off,
  );

/** Грубое определение типа по первым байтам. undefined — не распознали. */
export function sniff(head: Buffer): SigId | undefined {
  if (starts(head, [0x4d, 0x5a])) return "pe"; // MZ (PE/DOS)
  if (starts(head, [0x7f, 0x45, 0x4c, 0x46])) return "elf"; // 7F 'ELF'
  if (
    starts(head, [0xfe, 0xed, 0xfa, 0xce]) ||
    starts(head, [0xfe, 0xed, 0xfa, 0xcf]) ||
    starts(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    starts(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    starts(head, [0xca, 0xfe, 0xba, 0xbe]) // Mach-O universal / Java class
  )
    return "macho";
  if (starts(head, [0x23, 0x21])) return "script"; // #!
  if (asciiAt(head, "<?php")) return "script";

  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (asciiAt(head, "GIF87a") || asciiAt(head, "GIF89a")) return "gif";
  if (asciiAt(head, "%PDF-")) return "pdf";
  if (
    starts(head, [0x50, 0x4b, 0x03, 0x04]) ||
    starts(head, [0x50, 0x4b, 0x05, 0x06]) ||
    starts(head, [0x50, 0x4b, 0x07, 0x08])
  )
    return "zip"; // zip / docx / xlsx / pptx / jar / apk / odt
  if (starts(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "rar"; // Rar!
  if (starts(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (starts(head, [0x1f, 0x8b])) return "gzip";

  // текстовые xml/svg — пропустив ведущий BOM (U+FEFF) и пробелы
  let text = head.subarray(0, 256).toString("utf8");
  if (text.charCodeAt(0) === BOM) text = text.slice(1);
  text = text.trimStart().toLowerCase();
  if (text.startsWith("<svg")) return "svg";
  if (text.startsWith("<?xml")) return "xml";
  return undefined;
}

/** Расширение → допустимые сигнатуры (детект несовпадения).
 *  Только форматы с надёжной сигнатурой; текст/csv/логи/произвольные бинарники
 *  сюда не входят — для них несовпадение не проверяем. */
const EXT_EXPECT: Record<string, SigId[]> = {
  png: ["png"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  gif: ["gif"],
  pdf: ["pdf"],
  zip: ["zip"],
  docx: ["zip"],
  xlsx: ["zip"],
  pptx: ["zip"],
  odt: ["zip"],
  ods: ["zip"],
  odp: ["zip"],
  rar: ["rar"],
  "7z": ["7z"],
  gz: ["gzip"],
  tgz: ["gzip"],
  svg: ["svg", "xml"],
};

/** Расширение → нормализованный MIME (приоритетнее клиентского). */
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  pcap: "application/vnd.tcpdump.pcap",
};

const SIG_MIME: Partial<Record<SigId, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  pdf: "application/pdf",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  gzip: "application/gzip",
  svg: "image/svg+xml",
  xml: "application/xml",
};

export interface GuardResult {
  /** Санитизированное имя. */
  filename: string;
  /** Нормализованный MIME для строки attachments (не клиентский). */
  contentType: string;
  /** Что показала сигнатура (для аудита/диагностики), либо "unknown". */
  sniffed: SigId | "unknown";
}

/** Основная проверка. Бросает ApiHttpError(400) при отказе. */
export function checkUpload(input: {
  filename: string;
  head: Buffer;
  maxFilename: number;
  blockExt: string[];
}): GuardResult {
  const filename = sanitizeFilename(input.filename, input.maxFilename);
  const ext = extOf(filename);

  if (ext && input.blockExt.includes(ext)) {
    bad(`Файлы с расширением .${ext} загружать нельзя`);
  }

  const sig = sniff(input.head);

  if (sig && EXECUTABLE_SIGS.has(sig)) {
    bad(`Файл распознан как исполняемый или скрипт (сигнатура ${sig}) — загрузка запрещена`);
  }

  const expect = EXT_EXPECT[ext];
  if (expect && sig && !expect.includes(sig)) {
    bad(`Содержимое файла (${sig}) не соответствует расширению .${ext}`);
  }

  const contentType = EXT_MIME[ext] ?? (sig ? SIG_MIME[sig] : undefined) ?? "application/octet-stream";

  return { filename, contentType, sniffed: sig ?? "unknown" };
}
