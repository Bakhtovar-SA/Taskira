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
}

export async function runStorageSweepOnce(storage: Storage, driver: "local" | "s3", graceMs: number): Promise<SweepStats> {
  const objects = await storage.list();
  if (objects.length === 0) return { scanned: 0, orphaned: 0 };

  const known = await q<{ storage_key: string }>(`SELECT storage_key FROM attachments WHERE storage_driver = $1`, [driver]);
  const knownKeys = new Set(known.map((r) => r.storage_key));
  const cutoff = Date.now() - graceMs;

  const orphans = objects.filter((o) => !knownKeys.has(o.key) && o.mtimeMs < cutoff);
  for (const o of orphans) {
    await storage.delete(o.key);
    console.log(`[storage-sweep] удалён осиротевший объект (${driver}): ${o.key}`);
  }
  if (orphans.length > 0) {
    await audit(null, "storage.sweep", "storage", null, { driver, deleted: orphans.length });
  }
  return { scanned: objects.length, orphaned: orphans.length };
}
