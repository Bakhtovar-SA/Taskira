import { withTransaction } from "../db.js";

/**
 * Лимит попыток входа по IP: не более `max` за скользящее окно `windowMs`. Состояние в БД (таблица
 * `login_attempts`), а не в памяти процесса: лимит не «умножается» на число процессов и не обнуляется
 * перезапуском. Время берётся у БД (`now()`), а не у процесса — расхождение часов между процессами не влияет.
 *
 * Логика прежняя: каждая попытка входа засчитывается до проверки пароля; отклонённая попытка не продлевает окно.
 * Проверка и запись — в одной транзакции под транзакционным advisory-локом на IP: без него две одновременные
 * попытки у самого порога обе увидели бы «ещё можно».
 *
 * @returns true — лимит исчерпан, вход надо отклонить (429).
 */
export async function loginRateLimited(ip: string, max: number, windowMs: number): Promise<boolean> {
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`taskira:login-ip:${ip}`]);
    await client.query(`DELETE FROM login_attempts WHERE ip = $1 AND attempted_at <= now() - ($2 * interval '1 millisecond')`, [ip, windowMs]);
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM login_attempts WHERE ip = $1`, [ip]);
    if (rows[0].n >= max) return true;
    await client.query(`INSERT INTO login_attempts (ip) VALUES ($1)`, [ip]);
    return false;
  });
}
