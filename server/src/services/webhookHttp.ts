/** Одна попытка к проверенному адресу: без прокси, редиректов и общего пула соединений. */
import http from "node:http";
import https from "node:https";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

export type DeliveryError = "timeout" | "dns" | "connect" | "tls" | "target_blocked" | "redirect" | "http_status" | "secret_unavailable" | "too_large" | "internal";
export interface SendResult {
  status: number | null; durationMs: number; excerpt: string; error: DeliveryError | null; retryAfter: string | null;
}
export interface SendOptions {
  url: URL; address: string; family: 4 | 6; body: string; headers: Record<string, string>;
  timeoutMs: number; connectTimeoutMs: number; signal?: AbortSignal;
  redactValues?: readonly string[];
}

export function signedHeaders(body: string, secrets: string[], event: string, eventId: string, deliveryId: string, version: string, now = Date.now()): Record<string, string> {
  const timestamp = Math.floor(now / 1000);
  return {
    "Content-Type": "application/json; charset=utf-8", "User-Agent": "Taskira-Webhooks/" + version,
    "X-Taskira-Event": event, "X-Taskira-Event-Id": eventId, "X-Taskira-Delivery": deliveryId,
    "X-Taskira-Webhook-Version": "1",
    "X-Taskira-Signature": "t=" + timestamp + secrets.map(secret => ",v1=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")).join(""),
  };
}

function excerpt(bytes: Buffer, url: URL, signature: string, redactValues: readonly string[]): string {
  let text = bytes.toString("utf8").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  // Получатель может вернуть query-параметры запроса или подпись; журнал не раскрывает их.
  const rawValues = url.search.slice(1).split("&").map(part => part.slice(part.indexOf("=") + 1));
  const signatures = signature.split(",").filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  const sensitive = [...new Set([url.href, url.search, ...url.searchParams.values(), ...rawValues, signature, ...signatures, ...redactValues].filter(Boolean))];
  if (sensitive.length) {
    const pattern = sensitive.sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    text = text.replace(new RegExp(pattern, "g"), "[redacted]");
  }
  text = Buffer.from(text, "utf8").subarray(0, 512).toString("utf8");
  while (Buffer.byteLength(text, "utf8") > 512) text = text.slice(0, -1);
  return text;
}

export async function send(opts: SendOptions): Promise<SendResult> {
  const started = performance.now();
  const secure = opts.url.protocol === "https:";
  const hostname = opts.url.hostname.replace(/^\[|\]$/g, "");
  const agent = secure ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
  return new Promise(resolve => {
    let finished = false;
    let request: http.ClientRequest | undefined;
    let totalTimer: NodeJS.Timeout | undefined, connectTimer: NodeJS.Timeout | undefined;
    let status: number | null = null, retryAfter: string | null = null;
    const finish = (error: DeliveryError | null, bytes = Buffer.alloc(0)): void => {
      if (finished) return;
      finished = true;
      clearTimeout(totalTimer); clearTimeout(connectTimer);
      opts.signal?.removeEventListener("abort", abort);
      request?.destroy(); agent.destroy();
      resolve({ status, durationMs: Math.round(performance.now() - started),
        excerpt: excerpt(bytes, opts.url, opts.headers["X-Taskira-Signature"] ?? "", opts.redactValues ?? []), error, retryAfter });
    };
    const abort = () => finish("internal");
    if (opts.signal?.aborted) { finish("internal"); return; }
    opts.signal?.addEventListener("abort", abort, { once: true });
    totalTimer = setTimeout(() => finish("timeout"), opts.timeoutMs);
    connectTimer = setTimeout(() => finish("connect"), opts.connectTimeoutMs);
    try {
      const options: https.RequestOptions = {
        protocol: opts.url.protocol, hostname: opts.address, family: opts.family,
        port: opts.url.port || (secure ? 443 : 80), path: opts.url.pathname + opts.url.search,
        method: "POST", agent,
        // hostname — проверенный IP. Host и проверка сертификата используют исходное имя.
        headers: { ...opts.headers, Host: opts.url.host, "Content-Length": String(Buffer.byteLength(opts.body)) },
        servername: secure && !isIP(hostname) ? hostname : undefined,
        checkServerIdentity: (_host, cert) => checkServerIdentity(hostname, cert),
        lookup: (_host, _options, cb) => cb(null, opts.address, opts.family),
      };
      request = (secure ? https.request : http.request)(options, response => {
        status = response.statusCode ?? null;
        retryAfter = typeof response.headers["retry-after"] === "string" ? response.headers["retry-after"] : null;
        if (status !== null && status >= 300 && status < 400) { finish("redirect"); return; }
        let received = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > 65_536) { finish("too_large", Buffer.concat(chunks)); return; }
          chunks.push(chunk);
        });
        response.on("end", () => finish(status !== null && status >= 200 && status < 300 ? null : "http_status", Buffer.concat(chunks)));
        response.on("error", () => finish("connect", Buffer.concat(chunks)));
        response.on("aborted", () => finish("connect", Buffer.concat(chunks)));
      });
      request.on("socket", socket => {
        socket.once(secure ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
      });
      request.on("error", (error: NodeJS.ErrnoException) => {
        const code = error.code ?? "";
        finish(code.includes("CERT") || code.includes("TLS") || code.includes("SSL") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" ? "tls" : "connect");
      });
      request.end(opts.body);
    } catch { finish("internal"); }
  });
}
