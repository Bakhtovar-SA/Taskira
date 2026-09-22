/**
 * Instance (ТЗ 4.1, план v2 Трек 4) — единственная строка конфигурации/лицензии этой
 * инсталляции. См. docs/adr/0009-database-per-tenant.md: database-per-tenant, поэтому это
 * singleton, не сущность с id из URL.
 *
 * Не путать с `project.ts`: там несколько проектов одной организации в одной БД
 * (multi-project, миграция 007) — ортогональная ось, см. ADR-0009 «Multi-project (внутри
 * инсталляции) — это не мультитенантность». Здесь — сама организация, всегда одна, всегда id=1.
 *
 * Кэш без TTL, в отличие от `projectById()`/`requireAuth` (middleware.ts): та строка меняется
 * только явным административным действием этого же процесса (провижининг — ТЗ 4.2, обновление
 * лицензии — ТЗ 4.3), а не сторонним процессом, о котором этот инстанс мог бы не знать —
 * рассинхрон между узлами кластера здесь не тот риск, что у `project.is_shared` (видимость
 * доступа проекта пересчитывается на каждый запрос по множеству путей; лицензия — нет). Код,
 * который пишет в таблицу `instance`, обязан сам вызвать `invalidateInstanceCache()` — симметрично
 * `invalidateProjectCache()`/`invalidateUserCache()`.
 */
import { one } from "../db.js";

export interface Instance {
  id: 1;
  name: string;
  plan: string;
  licenseKey: string | null;
  /** мс эпохи; null — лицензия не задана (ТЗ 4.3 ещё не подключено или офлайн-режим без лицензии). */
  licenseExpiresAt: number | null;
  createdAt: number;
}

interface InstanceDbRow {
  id: number;
  name: string;
  plan: string;
  license_key: string | null;
  license_expires_at: string | null;
  created_at: string;
}

const SELECT_COLS = `id, name, plan, license_key, license_expires_at, created_at`;

const toInstance = (r: InstanceDbRow): Instance => ({
  id: 1,
  name: r.name,
  plan: r.plan,
  licenseKey: r.license_key,
  licenseExpiresAt: r.license_expires_at ? new Date(r.license_expires_at).getTime() : null,
  createdAt: new Date(r.created_at).getTime(),
});

let cached: Instance | null = null;

/**
 * Единственная точка чтения instance. Бросает, если строки ещё нет — это означает, что
 * seedInstance() не запускался (например, `db.ts` migrate() отработал, а старт сервера ещё не
 * дошёл до сидов), а не легитимное «инстанс не настроен»: строка обязана существовать всегда
 * после старта сервера, по контракту ТЗ 4.1.
 */
export async function getInstance(): Promise<Instance> {
  if (cached) return cached;
  const row = await one<InstanceDbRow>(`SELECT ${SELECT_COLS} FROM instance WHERE id = 1`);
  if (!row) {
    throw new Error(
      "Строка instance не найдена — запустите сид (npm run seed) или дождитесь старта сервера (seedInstance())",
    );
  }
  cached = toInstance(row);
  return cached;
}

/** Сброс кэша — вызывать после любой записи в таблицу instance (провижининг, ротация лицензии). */
export function invalidateInstanceCache(): void {
  cached = null;
}
