import { q } from "../db.js";

/**
 * Предупреждения readiness: деградация без ошибки. Они НЕ меняют `ok` и код ответа (503 заставил бы
 * оркестратор снять с трафика инстанс, который отлично работает, просто медленнее), но делают её видимой:
 * иначе она обнаруживается постфактум по жалобам («поиск стал медленным»).
 */
export interface HealthWarning {
  code: "search_index_missing";
  reason: string;
}

const SEARCH_INDEXES = ["idx_issues_active_title_trgm", "idx_issues_active_key_trgm"];

/**
 * Триграммные индексы поиска (миграция 20260920T1420) на месте? Без них поиск `q` молча превращается в
 * Seq Scan: на 50 тыс. задач 80–160 мс вместо единиц миллисекунд. Расширение `pg_trgm` принадлежит базе,
 * а не схеме, поэтому его удаление (сброс чужой схемы, ручной `DROP EXTENSION … CASCADE`) уносит
 * индексы всех схем без единой ошибки (TEST-01). Индексы ищутся по имени через search_path соединения,
 * то есть в схеме приложения.
 */
export async function searchIndexWarnings(): Promise<HealthWarning[]> {
  const [row] = await q<{ missing: string[]; ext: boolean }>(
    `SELECT COALESCE(array_agg(n) FILTER (WHERE to_regclass(n) IS NULL), '{}') AS missing,
            EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS ext
       FROM unnest($1::text[]) AS n`,
    [SEARCH_INDEXES],
  );
  if (!row || row.missing.length === 0) return [];
  const why = row.ext
    ? "расширение pg_trgm установлено, индексы нужно создать (команды — в комментарии миграции 20260920T1420)"
    : "расширение pg_trgm не установлено: если contrib недоступен, это ожидаемо; если оно было и пропало — установите его и создайте индексы (миграция 20260920T1420)";
  return [
    {
      code: "search_index_missing",
      reason: `Поиск по задачам работает без триграммных индексов (${row.missing.join(", ")}) и замедлится на больших проектах: ${why}.`,
    },
  ];
}
