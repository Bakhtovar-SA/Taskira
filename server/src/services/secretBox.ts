/** INT-03: секреты подписок; ключ приходит только из конфигурации оператора. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretUnavailableError extends Error {
  constructor() { super("Секрет недоступен"); this.name = "SecretUnavailableError"; }
}

function checkKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new SecretUnavailableError();
}

export function seal(plain: string, key: Buffer): string {
  checkKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

function decode(raw: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(raw)) throw new SecretUnavailableError();
  const buffer = Buffer.from(raw, "base64url");
  if (buffer.toString("base64url") !== raw) throw new SecretUnavailableError();
  return buffer;
}

export function open(sealed: string, key: Buffer): string {
  try {
    checkKey(key);
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new SecretUnavailableError();
    const iv = decode(parts[1]);
    const encrypted = decode(parts[2]);
    const tag = decode(parts[3]);
    if (iv.length !== 12 || tag.length !== 16) throw new SecretUnavailableError();
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch { throw new SecretUnavailableError(); }
}
