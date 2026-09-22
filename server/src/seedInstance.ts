/**
 * Сид строки `instance` (ТЗ 4.1, план v2 Трек 4; миграция `20260922T1500_instance_singleton.sql`;
 * см. docs/adr/0009-database-per-tenant.md). Идемпотентно, тот же приём, что seedAdmin/seedProject:
 * проверить, что пусто, затем вставить — под тем же `taskira:seed` advisory-локом
 * (seedStartup.ts), так что параллельный старт двух экземпляров на пустой БД не гонится за
 * первой строкой.
 *
 * name/plan — из env, только при самом первом сиде: провижининг новой инсталляции (ТЗ 4.2)
 * задаёт их явно через те же переменные, а не правкой строки после старта. Дефолты ниже — для
 * локальной разработки, когда INSTANCE_NAME/INSTANCE_PLAN не заданы.
 */
import { one } from "./db.js";

export async function seedInstance(): Promise<void> {
  const existing = await one<{ id: number }>(`SELECT id FROM instance WHERE id = 1`);
  if (existing) {
    console.log("[seed] instance уже существует — пропускаем сид instance");
    return;
  }

  const name = process.env.INSTANCE_NAME?.trim() || "Taskira (dev)";
  const plan = process.env.INSTANCE_PLAN?.trim() || "default";

  await one(
    `INSERT INTO instance (id, name, plan) VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [name, plan],
  );
  console.log(`[seed] instance «${name}» (план «${plan}»)`);
}
