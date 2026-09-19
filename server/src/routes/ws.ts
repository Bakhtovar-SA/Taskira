/** GET /api/ws — push уведомлений вместо ожидания polling-тика (Этап 3c).
 *
 *  Браузер аутентифицируется HttpOnly-cookie, которая автоматически приходит
 *  в handshake. Для CLI и старых клиентов поддерживается первое сообщение
 *  после открытия соединения: { type: "auth", token }. Не пришёл ни один
 *  способ или проверка не пройдена — закрываем (1008, policy violation),
 *  клиент должен переподключиться (см. src/store.tsx).
 *
 *  Дальше от клиента ничего не ждём — это чистый push-канал сервер→клиент.
 */
import type { FastifyInstance } from "fastify";
import type { JwtPayload } from "../middleware.js";
import { assertFreshUser } from "../middleware.js";
import type { WsAuthMessage, WsMessage } from "../contract.js";
import { registerSocket, revokedSince, unregisterSocket } from "../services/wsHub.js";
import { requestToken } from "../sessionCookie.js";

const AUTH_TIMEOUT_MS = 5_000;

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ws", { websocket: true }, (socket, req) => {
    let userId: string | null = null;
    // Синхронный латч "первая auth-рама уже принята в обработку" — ОТДЕЛЬНО от
    // userId, который выставляется только ПОСЛЕ await assertFreshUser(). Без
    // него вторая "auth"-рама, пришедшая, пока первая ещё ждёт ответ БД,
    // проходила бы ту же проверку (userId всё ещё null) и стартовала бы
    // параллельную верификацию — возможно, другого токена. Оба пути тогда
    // дошли бы до registerSocket(), а общая переменная userId запомнила бы
    // только того, кто финишировал последним; регистрация первого в byUser
    // (wsHub.ts) осталась бы без пары unregisterSocket() на 'close' навсегда.
    let authStarted = false;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;

    const authTimer = setTimeout(() => {
      if (!userId) socket.close(1008, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    const authenticate = (token: string) => {
      if (authStarted) return;
      authStarted = true;
      const handshakeStartedAt = Date.now(); // до await — см. revokedSince() ниже
      void (async () => {
        try {
          const payload = app.jwt.verify<JwtPayload>(token);
          await assertFreshUser(payload.sub, payload.sessionVersion);
          // assertFreshUser — поход в БД; пока ждали, authTimer мог уже закрыть
          // сокет по таймауту. Регистрировать закрытый сокет — оставить его
          // висеть в byUser навсегда: 'close' по нему уже отгремел, второй раз
          // не придёт, и unregisterSocket() для этой записи не вызовется никогда.
          if (socket.readyState !== socket.OPEN) return;
          userId = payload.sub;
          clearTimeout(authTimer);
          registerSocket(userId, socket);
          if (typeof payload.exp === "number") {
            const remaining = payload.exp * 1000 - Date.now();
            if (remaining <= 0) {
              socket.close(1008, "token expired");
              return;
            }
            expiryTimer = setTimeout(() => socket.close(1008, "token expired"), remaining);
          }
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
    };

    socket.on("message", (raw: Buffer) => {
      if (authStarted) return; // вторую auth-раму на этом сокете не ждём вообще
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
      authenticate(auth.token);
    });

    // Браузер не раскрывает HttpOnly-cookie JavaScript-коду, но автоматически
    // отправляет её на WS-handshake. Старый auth-message путь выше остаётся для
    // Bearer-клиентов и существующих интеграционных тестов.
    const cookieToken = requestToken(req);
    if (cookieToken) authenticate(cookieToken);

    const cleanup = () => {
      clearTimeout(authTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      if (userId) unregisterSocket(userId, socket);
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
