/** Сборщик осиротевших объектов хранилища (ARCHITECTURE.md, follow-up).
 *
 *  Удаление задачи (или проекта → issues) каскадом снимает строки attachments
 *  (миграция 010), но не сам физический объект — синхронная чистка тысяч
 *  файлов заблокировала бы запрос удаления, поэтому это отдельный фоновый
 *  проход. БД — источник истины: объект хранилища без строки attachments
 *  считается мусором.
 *
 *  Гонка с загрузкой: routes/attachments.ts пишет объект в Storage (put())
 *  ДО INSERT INTO attachments — в это окно объект уже виден list(), но ещё
 *  не виден БД. `graceMs` — минимальный возраст объекта, чтобы попасть в
 *  кандидаты на удаление; на порядки больше времени одной загрузки, поэтому
 *  свежие объекты сборщик не трогает вовсе, независимо от исхода INSERT.
 */
import { q } from "../db.js";
import { audit } from "../audit.js";
import type { Storage } from "./storage.js";

export interface SweepStats {
  scanned: number;
  orphaned: number;
  deleted: number;
  failed: number;
}

/** Сколько объектов удалять параллельно. Storage.delete() — сетевой вызов у
 *  S3-драйвера; тысячи сирот после массового удаления проекта последовательно,
 *  по одному, растянулись бы на N round-trip'ов подряд. Батч-API S3
 *  (DeleteObjectsCommand, до 1000 ключей за раз) потребовал бы расширять
 *  интерфейс Storage под конкретный драйвер — ограниченный параллелизм даёт
 *  почти тот же выигрыш без этого. */
const DELETE_CONCURRENCY = 10;

export async function runStorageSweepOnce(storage: Storage, driver: "local" | "s3", graceMs: number): Promise<SweepStats> {
  const objects = await storage.list();
  if (objects.length === 0) return { scanned: 0, orphaned: 0, deleted: 0, failed: 0 };

  const known = await q<{ storage_key: string }>(`SELECT storage_key FROM attachments WHERE storage_driver = $1`, [driver]);
  const knownKeys = new Set(known.map((r) => r.storage_key));
  const cutoff = Date.now() - graceMs;

  const orphans = objects.filter((o) => !knownKeys.has(o.key) && o.mtimeMs < cutoff);
  let deleted = 0;
  let failed = 0;
  // Своя try/catch на каждый объект: одна упавшая (транзиентная сетевая
  // ошибка у S3, EBUSY на диске) не должна обрывать Promise.all и
  // пропускать все остальные батчи — вчера это был реальный баг здесь.
  for (let i = 0; i < orphans.length; i += DELETE_CONCURRENCY) {
    await Promise.all(
      orphans.slice(i, i + DELETE_CONCURRENCY).map(async (o) => {
        try {
          await storage.delete(o.key);
          deleted += 1;
          console.log(`[storage-sweep] удалён осиротевший объект (${driver}): ${o.key}`);
        } catch (e) {
          failed += 1;
          console.error(`[storage-sweep] не удалось удалить ${o.key}`, e);
        }
      }),
    );
  }
  // deleted===0 && failed>0 — тоже пишем: полный провал батча (истёкшие
  // креды S3, permission denied) должен остаться виден в audit_log, а не
  // только в console.error, иначе исчезающий доступ к хранилищу молча
  // оставался бы вообще без следа в аудите.
  if (deleted > 0 || failed > 0) {
    await audit(null, "storage.sweep", "storage", null, { driver, deleted, failed });
  }
  return { scanned: objects.length, orphaned: orphans.length, deleted, failed };
}
