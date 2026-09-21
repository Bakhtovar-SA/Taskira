import { withAdvisoryLock } from "./db.js";
import { seedAdmin } from "./seed.js";
import { seedProject } from "./seedProject.js";

/**
 * Стартовые сиды под блокировкой. `seedAdmin` и `seedProject` устроены как «проверить, что пусто, затем
 * вставить»: при одновременном старте двух экземпляров на пустой БД оба видят пусто, второй `INSERT` падает
 * по уникальности (`users.username`, `projects.key`), и экземпляр не стартует. Блокирующий лок ставит их в
 * очередь: второй дожидается первого и видит уже созданное. `migrate()` защищён тем же приёмом
 * (`taskira:schema-migrations`).
 */
export async function runStartupSeeds(): Promise<void> {
  await withAdvisoryLock("taskira:seed", { wait: true }, async () => {
    await seedAdmin();
    await seedProject();
  });
}
