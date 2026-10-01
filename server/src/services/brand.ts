/** Брендирование инсталляции (ТЗ 5.14 п.5, миграция 20260928T1200): название, знак клиента, оттенок акцента.
 *  Строка — instance (singleton, ТЗ 4.1). Знак — PNG или WebP до 200 КБ и до 1024 px, проверяется по сигнатуре и
 *  габаритам из заголовка (не по имени файла); SVG не принимается — это документ со скриптами, не картинка. */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { one, q } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError } from "../errors.js";
import { getStorage } from "./storage.js";
import { webpSize } from "./projectPhoto.js";
import type { BrandDto } from "../contract.js";

export const LOGO_LIMITS = { maxBytes: 200_000, maxSide: 1024, minSide: 32 } as const;
const storage = () => getStorage(loadConfig());

interface Row {
  brand_transparency: BrandDto["transparencyDefault"];
  brand_name: string | null;
  brand_hue: number | null;
  brand_logo_key: string | null;
  brand_logo_content_type: string | null;
  brand_logo_updated_at: Date | null;
}
const row = () =>
  one<Row>(`SELECT brand_transparency, brand_name, brand_hue, brand_logo_key, brand_logo_content_type, brand_logo_updated_at FROM instance WHERE id = 1`);

export async function getBrand(): Promise<BrandDto> {
  const r = await row();
  return { transparencyDefault: r?.brand_transparency ?? "auto", name: r?.brand_name ?? null, hue: r?.brand_hue ?? null, logoUpdatedAt: r?.brand_logo_updated_at ? r.brand_logo_updated_at.getTime() : null };
}

export async function patchBrand(p: { name?: string | null; hue?: number | null; transparencyDefault?: BrandDto["transparencyDefault"] }): Promise<BrandDto> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (p.name !== undefined) (vals.push(p.name), sets.push(`brand_name = $${vals.length}`));
  if (p.hue !== undefined) (vals.push(p.hue), sets.push(`brand_hue = $${vals.length}`));
  if (p.transparencyDefault !== undefined) (vals.push(p.transparencyDefault), sets.push(`brand_transparency = $${vals.length}`));
  await q(`UPDATE instance SET ${sets.join(", ")} WHERE id = 1`, vals);
  return getBrand();
}

/** Габариты PNG (IHDR) или WebP; null — ни то, ни другое. */
export function logoType(b: Buffer): { type: "image/png" | "image/webp"; width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("ascii", 12, 16) === "IHDR") {
    return { type: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  const w = webpSize(b);
  return w ? { type: "image/webp", ...w } : null;
}

export async function setBrandLogo(buf: Buffer): Promise<BrandDto> {
  if (buf.length === 0) throw new ApiHttpError(400, "LOGO_REJECTED", "Пустой файл");
  if (buf.length > LOGO_LIMITS.maxBytes) throw new ApiHttpError(413, "LOGO_TOO_LARGE", `Знак больше ${LOGO_LIMITS.maxBytes / 1000} КБ`);
  const t = logoType(buf);
  if (!t) throw new ApiHttpError(400, "LOGO_REJECTED", "Знак: только PNG или WebP");
  if (Math.max(t.width, t.height) > LOGO_LIMITS.maxSide || Math.min(t.width, t.height) < LOGO_LIMITS.minSide) {
    throw new ApiHttpError(400, "LOGO_REJECTED", `Габариты ${t.width}×${t.height} вне допустимых (${LOGO_LIMITS.minSide}…${LOGO_LIMITS.maxSide} px)`);
  }
  const store = await storage();
  const key = `brand/${randomUUID()}`;
  await store.put(key, Readable.from([buf]), { contentType: t.type, size: buf.length });
  const prev = await row();
  try {
    await q(
      `UPDATE instance SET brand_logo_driver = $1, brand_logo_key = $2, brand_logo_content_type = $3, brand_logo_updated_at = now() WHERE id = 1`,
      [loadConfig().storage.driver, key, t.type],
    );
  } catch (e) {
    await store.delete(key).catch(() => undefined);
    throw e;
  }
  if (prev?.brand_logo_key) await store.delete(prev.brand_logo_key).catch(() => undefined);
  return getBrand();
}

export async function removeBrandLogo(): Promise<BrandDto> {
  const prev = await row();
  await q(`UPDATE instance SET brand_logo_driver = NULL, brand_logo_key = NULL, brand_logo_content_type = NULL, brand_logo_updated_at = NULL WHERE id = 1`);
  if (prev?.brand_logo_key) await (await storage()).delete(prev.brand_logo_key).catch(() => undefined);
  return getBrand();
}

export async function openBrandLogo(): Promise<{ stream: Readable; contentType: string } | null> {
  const r = await row();
  if (!r?.brand_logo_key) return null;
  return { stream: await (await storage()).get(r.brand_logo_key), contentType: r.brand_logo_content_type ?? "image/png" };
}
