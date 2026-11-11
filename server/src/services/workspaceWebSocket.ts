import type { FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";

/** Fastify authenticates and validates the route before calling handleUpgrade.
 * Use a separate receiver for document sync without raising /api/ws's 8 KiB cap.
 * Both receivers share Fastify's existing HTTP listener and error handling. */
export function configureDocumentWebSocket(app: FastifyInstance): void {
  const documents = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const notifications = app.websocketServer;
  const upgrade = notifications.handleUpgrade.bind(notifications);
  notifications.handleUpgrade = (request, socket, head, callback) => {
    const path = (request.url ?? "").split("?", 1)[0];
    if (/^\/api\/projects\/[^/]+\/documents\/[^/]+\/collaboration$/.test(path)) {
      documents.handleUpgrade(request, socket, head, callback);
    } else {
      upgrade(request, socket, head, callback);
    }
  };
  app.addHook("preClose", async () => {
    for (const socket of documents.clients) socket.terminate();
    await new Promise<void>((resolve) => documents.close(() => resolve()));
  });
}
