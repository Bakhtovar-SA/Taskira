/** Реестр открытых WS-соединений по пользователю — push вместо ожидания
 *  следующего polling-тика (ARCHITECTURE.md follow-up, Этап 3c). Только push
 *  сервер → клиент; из сообщений клиента маршрут (routes/ws.ts) разбирает
 *  лишь auth-рукопожатие первым сообщением после открытия соединения. */
import type { WebSocket } from "@fastify/websocket";
import type { WsMessage } from "../contract.js";

const byUser = new Map<string, Set<WebSocket>>();

/**
 * Момент последнего отзыва сессии пользователя (мс, Date.now()). Закрывает
 * TOCTOU-окно хендшейка (routes/ws.ts): assertFreshUser — это поход в БД, и
 * revokeUserSessions() может выполниться ПОСЛЕ него, но ДО registerSocket().
 * closeUserSockets() тогда ничего не находит (сокет ещё не зарегистрирован) и
 * ничего не закрывает; без этой метки такой сокет остался бы жить бессрочно.
 * routes/ws.ts сверяет её сразу после registerSocket() — без await между
 * ними, так что сравнение атомарно относительно любого другого revoke().
 */
const revokedAt = new Map<string, number>();
const REVOKED_TTL_MS = 60_000;

export function registerSocket(userId: string, socket: WebSocket): void {
  let set = byUser.get(userId);
  if (!set) {
    set = new Set();
    byUser.set(userId, set);
  }
  set.add(socket);
}

export function unregisterSocket(userId: string, socket: WebSocket): void {
  const set = byUser.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) byUser.delete(userId);
}

/** Отправить сообщение всем открытым соединениям пользователя — обычно одно,
 *  но пользователь мог открыть несколько вкладок/устройств одновременно. */
export function pushToUser(userId: string, message: WsMessage): void {
  const set = byUser.get(userId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(message);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

/**
 * Закрыть все открытые сокеты пользователя — вызывать при отзыве сессии
 * (logout, деактивация, смена роли), т.е. из revokeUserSessions()
 * (middleware.ts) — НЕ из invalidateUserCache(), та теперь чистая
 * инвалидация кэша без побочных эффектов (иначе LDAP-релогин или
 * пересохранение формы без изменений рвали бы чужую живую вкладку без
 * всякого реального отзыва). assertFreshUser сверяет активность/отзыв
 * только один раз, на хендшейке (routes/ws.ts) — без этого разлогиненный
 * или деактивированный пользователь с открытой вкладкой продолжал бы
 * получать push до закрытия вкладки самим человеком. Запись из byUser
 * удалять здесь не нужно — 'close' долетит до routes/ws.ts и
 * unregisterSocket() отработает штатно.
 */
export function closeUserSockets(userId: string, reason: string): void {
  const now = Date.now();
  for (const [id, at] of revokedAt) {
    if (now - at > REVOKED_TTL_MS) revokedAt.delete(id);
  }
  revokedAt.set(userId, now);
  const set = byUser.get(userId);
  if (!set) return;
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.close(1008, reason);
  }
}

/** true — пользователя отзывали в момент времени `sinceMs` или позже. Вызывать
 *  из routes/ws.ts сразу после registerSocket() с меткой, снятой ДО похода в
 *  БД (assertFreshUser) — закрывает гонку, описанную у closeUserSockets(). */
export function revokedSince(userId: string, sinceMs: number): boolean {
  const t = revokedAt.get(userId);
  if (t !== undefined && Date.now() - t > REVOKED_TTL_MS) {
    revokedAt.delete(userId);
    return false;
  }
  return t !== undefined && t >= sinceMs;
}

/** Только для тестов — не течёт между тестами, если кто-то забыл закрыть сокет. */
export function _resetWsHub(): void {
  byUser.clear();
  revokedAt.clear();
}
