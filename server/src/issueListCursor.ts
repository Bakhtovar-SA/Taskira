import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = 1;
const PAYLOAD_BYTES = 25;
const SIGNATURE_BYTES = 16;
const CURSOR_BYTES = PAYLOAD_BYTES + SIGNATURE_BYTES;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IssueListCursorValue {
  rank: number;
  id: string;
}

const signature = (payload: Buffer, secret: string): Buffer =>
  createHmac("sha256", secret).update("taskira:issue-list-cursor:v1\0").update(payload).digest().subarray(0, SIGNATURE_BYTES);

const uuidBytes = (id: string): Buffer => {
  if (!UUID_RE.test(id)) throw new Error("invalid UUID");
  return Buffer.from(id.replaceAll("-", ""), "hex");
};

const formatUuid = (bytes: Buffer): string => {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Opaque, authenticated cursor. Its binary payload intentionally contains no
 * JSON or database field names; consumers must only store and return it.
 */
export function encodeIssueListCursor(value: IssueListCursorValue, secret: string): string {
  if (!Number.isFinite(value.rank)) throw new Error("invalid rank");
  const payload = Buffer.allocUnsafe(PAYLOAD_BYTES);
  payload.writeUInt8(VERSION, 0);
  payload.writeDoubleBE(value.rank, 1);
  uuidBytes(value.id).copy(payload, 9);
  return Buffer.concat([payload, signature(payload, secret)]).toString("base64url");
}

export function decodeIssueListCursor(cursor: string, secret: string): IssueListCursorValue {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("invalid cursor encoding");
  const bytes = Buffer.from(cursor, "base64url");
  // Строка должна быть единственной допустимой записью этих байт: в хвосте
  // base64url есть неиспользуемые биты, и без проверки несколько разных строк
  // декодировались бы в один и тот же (подписанный) курсор.
  if (bytes.toString("base64url") !== cursor) throw new Error("non-canonical cursor encoding");
  if (bytes.length !== CURSOR_BYTES || bytes.readUInt8(0) !== VERSION) throw new Error("invalid cursor format");

  const payload = bytes.subarray(0, PAYLOAD_BYTES);
  const actualSignature = bytes.subarray(PAYLOAD_BYTES);
  const expectedSignature = signature(payload, secret);
  if (!timingSafeEqual(actualSignature, expectedSignature)) throw new Error("invalid cursor signature");

  const rank = payload.readDoubleBE(1);
  if (!Number.isFinite(rank)) throw new Error("invalid cursor rank");
  return { rank, id: formatUuid(payload.subarray(9, 25)) };
}

/* ---- v2: курсор для сортировок, отличных от rank ---------------------------
 * Порядок выдачи — (значение сортировки, num). Значение приводится к float8 в
 * самом SQL (см. services/issueFilters.ts), поэтому равенство при сравнении
 * с курсором точное. sort/dir зашиты в подписанный payload: курсор одной
 * сортировки нельзя подставить в другую. */
const SORT_VERSION = 2;
const SORT_PAYLOAD_BYTES = 15;
const SORT_CURSOR_BYTES = SORT_PAYLOAD_BYTES + SIGNATURE_BYTES;
const SORT_CODES = ["priority", "due", "updated", "key"] as const;
export type IssueCursorSort = (typeof SORT_CODES)[number];

export interface IssueSortCursorValue {
  sort: IssueCursorSort;
  dir: "asc" | "desc";
  value: number;
  num: number;
}

const sortSignature = (payload: Buffer, secret: string): Buffer =>
  createHmac("sha256", secret).update("taskira:issue-list-cursor:v2\0").update(payload).digest().subarray(0, SIGNATURE_BYTES);

export function encodeIssueSortCursor(v: IssueSortCursorValue, secret: string): string {
  const code = SORT_CODES.indexOf(v.sort);
  if (code < 0 || !Number.isFinite(v.value) || !Number.isInteger(v.num)) throw new Error("invalid sort cursor");
  const payload = Buffer.allocUnsafe(SORT_PAYLOAD_BYTES);
  payload.writeUInt8(SORT_VERSION, 0);
  payload.writeUInt8(code, 1);
  payload.writeUInt8(v.dir === "desc" ? 1 : 0, 2);
  payload.writeDoubleBE(v.value, 3);
  payload.writeInt32BE(v.num, 11);
  return Buffer.concat([payload, sortSignature(payload, secret)]).toString("base64url");
}

export function decodeIssueSortCursor(cursor: string, secret: string): IssueSortCursorValue {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("invalid cursor encoding");
  const bytes = Buffer.from(cursor, "base64url");
  // Строка должна быть единственной допустимой записью этих байт: в хвосте
  // base64url есть неиспользуемые биты, и без проверки несколько разных строк
  // декодировались бы в один и тот же (подписанный) курсор.
  if (bytes.toString("base64url") !== cursor) throw new Error("non-canonical cursor encoding");
  if (bytes.length !== SORT_CURSOR_BYTES || bytes.readUInt8(0) !== SORT_VERSION) throw new Error("invalid cursor format");
  const payload = bytes.subarray(0, SORT_PAYLOAD_BYTES);
  if (!timingSafeEqual(bytes.subarray(SORT_PAYLOAD_BYTES), sortSignature(payload, secret))) throw new Error("invalid cursor signature");
  const sort = SORT_CODES[payload.readUInt8(1)];
  const value = payload.readDoubleBE(3);
  if (!sort || !Number.isFinite(value)) throw new Error("invalid cursor payload");
  return { sort, dir: payload.readUInt8(2) === 1 ? "desc" : "asc", value, num: payload.readInt32BE(11) };
}
