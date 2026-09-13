/** GET /api/ws — push уведомлений вместо ожидания polling-тика (Этап 3c).
 *
 *  Аутентификация НЕ через requireAuth/Authorization: браузерный WebSocket
 *  не умеет слать свои заголовки при хендшейке, а токен в query-строке
 *  попадает в access-логи сервера. Вместо этого — первое сообщение после
 *  открытия соединения: { type: "auth", token }. Не пришло вовремя или не
 *  прошло проверку — закрываем (1008, policy violation), клиент должен
 *  переподключиться (см. src/store.tsx).
 *
 *  Дальше от клиента ничего не ждём — это чистый push-канал сервер→клиент.
 */
import type { FastifyInstance } from "fastify";
import type { JwtPayload } from "../middleware.js";
import { assertFreshUser } from "../middleware.js";
import type { WsAuthMessage, WsMessage } from "../contract.js";
import { registerSocket, revokedSince, unregisterSocket } from "../services/wsHub.js";

const AUTH_TIMEOUT_MS = 5_000;

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ws", { websocket: true }, (socket) => {
    let userId: string | null = null;

    const authTimer = setTimeout(() => {
      if (!userId) socket.close(1008, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    socket.on("message", (raw: Buffer) => {
      if (userId) return; // после аутентификации сообщений от клиента не ждём
      const handshakeStartedAt = Date.now(); // до await — см. revokedSince() ниже
      void (async () => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          socket.close(1008, "malformed auth message");
          return;
        }
        const auth = msg as Partial<WsAuthMessage>;
        if (auth.type !== "auth" || typeof auth.token !== "string") {
          socket.close(1008, "expected auth message");
          return;
        }
        try {
          const payload = app.jwt.verify<JwtPayload>(auth.token);
          await assertFreshUser(payload.sub, payload.iatMs);
          // assertFreshUser — поход в БД; пока ждали, authTimer мог уже закрыть
          // сокет по таймауту. Регистрировать закрытый сокет — оставить его
          // висеть в byUser навсегда: 'close' по нему уже отгремел, второй раз
          // не придёт, и unregisterSocket() для этой записи не вызовется никогда.
          if (socket.readyState !== socket.OPEN) return;
          userId = payload.sub;
          clearTimeout(authTimer);
          registerSocket(userId, socket);
          // Без await с предыдущей строки — атомарно относительно любого
          // revokeUserSessions() из другого запроса (logout/деактивация/смена
          // роли), случившегося, пока мы ждали assertFreshUser(): если он
          // пришёлся на это окно, closeUserSockets() тогда ничего не нашёл
          // (сокет ещё не был зарегистрирован) — ловим это здесь и закрываем сами.
          if (revokedSince(userId, handshakeStartedAt)) {
            unregisterSocket(userId, socket);
            socket.close(1008, "revoked during handshake");
            return;
          }
          // Клиент (store.tsx) ждёт именно это, а не сам факт открытия
          // соединения, чтобы сбросить экспоненциальный бэкофф переподключения —
          // открытие TCP/WS ничего не говорит о том, принят ли токен.
          const ok: WsMessage = { type: "auth_ok", ts: Date.now() };
          socket.send(JSON.stringify(ok));
        } catch {
          socket.close(1008, "auth failed");
        }
      })();
    });

    const cleanup = () => {
      clearTimeout(authTimer);
      if (userId) unregisterSocket(userId, socket);
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
