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
  if (bytes.length !== CURSOR_BYTES || bytes.readUInt8(0) !== VERSION) throw new Error("invalid cursor format");

  const payload = bytes.subarray(0, PAYLOAD_BYTES);
  const actualSignature = bytes.subarray(PAYLOAD_BYTES);
  const expectedSignature = signature(payload, secret);
  if (!timingSafeEqual(actualSignature, expectedSignature)) throw new Error("invalid cursor signature");

  const rank = payload.readDoubleBE(1);
  if (!Number.isFinite(rank)) throw new Error("invalid cursor rank");
  return { rank, id: formatUuid(payload.subarray(9, 25)) };
}
