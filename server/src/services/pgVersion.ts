import { q } from "../db.js";

/**
 * Матрица поддерживаемых версий PostgreSQL (OPS-PG-01, docs/OPERATIONS.md «Обновление PostgreSQL»).
 * Минимум — 14 (миграции опираются на pg_trgm как trusted-расширение и встроенный gen_random_uuid, оба
 * с 13; 14 — нижняя граница, которую мы проверяем в CI). Максимум проверенной — по CI-матрице
 * `.github/workflows/test.yml` (job server). Меняя числа, меняйте их и там, и в документации.
 */
export const PG_MIN_MAJOR = 14;
export const PG_MAX_TESTED_MAJOR = 17;

export type PgVersionStatus = "unsupported" | "supported" | "newer_than_tested";

export interface PgVersionInfo {
  /** server_version_num как есть, напр. 160004. */
  versionNum: number;
  major: number;
  minor: number;
  status: PgVersionStatus;
  minMajor: number;
  maxTestedMajor: number;
}

/**
 * `server_version_num`: с 10-й версии это major*10000 + minor (160004 = 16.4); до 10 — другая схема
 * (090624 = 9.6.24), её мы не поддерживаем, и major там считается как 9.
 */
export function parseServerVersionNum(raw: string | number): { major: number; minor: number } {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Не удалось разобрать server_version_num: ${JSON.stringify(raw)}`);
  if (n < 100000) return { major: Math.floor(n / 10000), minor: Math.floor(n / 100) % 100 };
  return { major: Math.floor(n / 10000), minor: n % 10000 };
}

export function assessPgVersion(raw: string | number): PgVersionInfo {
  const { major, minor } = parseServerVersionNum(raw);
  const versionNum = Number(raw);
  const status: PgVersionStatus =
    major < PG_MIN_MAJOR ? "unsupported" : major > PG_MAX_TESTED_MAJOR ? "newer_than_tested" : "supported";
  return { versionNum, major, minor, status, minMajor: PG_MIN_MAJOR, maxTestedMajor: PG_MAX_TESTED_MAJOR };
}

export function unsupportedVersionMessage(info: PgVersionInfo): string {
  return (
    `PostgreSQL ${info.major}.${info.minor} не поддерживается: нужна версия ${info.minMajor} или новее ` +
    `(проверено ${info.minMajor}–${info.maxTestedMajor}). Обновите PostgreSQL — см. docs/OPERATIONS.md, «Обновление PostgreSQL».`
  );
}

// Upgrade stops the API: the startup version remains valid until that process restarts.
let cached: PgVersionInfo | null = null;

export async function getPgVersionInfo(): Promise<PgVersionInfo> {
  if (cached) return cached;
  // Алиас обязателен: `SHOW server_version_num` отдаёт колонку `server_version_num`, а не `v` (из-за этого сервер
  // отказывался стартовать на любой версии PostgreSQL).
  const [row] = await q<{ v: string }>(`SELECT current_setting('server_version_num') AS v`);
  const info = assessPgVersion(row?.v ?? "");
  cached = info;
  return info;
}

/** Вызывается при старте до миграций: на версии ниже минимальной бросает понятную ошибку. */
export async function assertSupportedPostgres(): Promise<PgVersionInfo> {
  const info = await getPgVersionInfo();
  if (info.status === "unsupported") throw new Error(unsupportedVersionMessage(info));
  if (info.status === "newer_than_tested") {
    console.warn(
      `[taskira] PostgreSQL ${info.major}.${info.minor} новее проверенных версий (${info.minMajor}–${info.maxTestedMajor}); работа не гарантирована.`,
    );
  }
  return info;
}

/** Только для тестов. */
export function resetPgVersionCache(): void {
  cached = null;
}
