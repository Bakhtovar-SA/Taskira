import { createServer, type IncomingHttpHeaders, type ServerResponse, type RequestListener } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

export interface ReceivedWebhook { headers: IncomingHttpHeaders; body: Buffer; url: string }
export interface ReceiverReply { status?: number; headers?: Record<string, string>; body?: string | Buffer; delayMs?: number }
export async function webhookReceiver(tls = false) {
  const received: ReceivedWebhook[] = [];
  const timers = new Set<NodeJS.Timeout>();
  let reply: ReceiverReply = {}, active = 0, peak = 0;
  let handler: ((request: ReceivedWebhook, response: ServerResponse) => void) | null = null;
  const receive: RequestListener = (request, response) => {
    active++; peak = Math.max(peak, active);
    let finished = false;
    response.on("close", () => { if (!finished) { active--; finished = true; } });
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const captured = { headers: request.headers, body: Buffer.concat(chunks), url: request.url ?? "/" };
      received.push(captured);
      if (handler) { handler(captured, response); return; }
      const current = { ...reply };
      const respond = () => {
        response.writeHead(current.status ?? 200, current.headers ?? {});
        response.end(current.body ?? "ok");
      };
      if (current.delayMs) {
        const timer = setTimeout(() => { timers.delete(timer); respond(); }, current.delayMs);
        timers.add(timer);
      } else respond();
    });
  };
  // Public fixture key: only for proving an untrusted certificate is rejected; never trusted by the client.
  const server = tls ? createHttpsServer({ key: readFileSync(new URL("../fixtures/webhook-tls/key.pem", import.meta.url)),
    cert: readFileSync(new URL("../fixtures/webhook-tls/cert.pem", import.meta.url)) }, receive) : createServer(receive);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `${tls ? "https" : "http"}://127.0.0.1:${port}/hook`, port, received,
    get peak() { return peak; },
    setReply(value: ReceiverReply) { reply = value; handler = null; },
    setHandler(value: (request: ReceivedWebhook, response: ServerResponse) => void) { handler = value; },
    clear() { received.length = 0; reply = {}; handler = null; peak = 0; },
    async close() {
      for (const timer of timers) clearTimeout(timer); timers.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
