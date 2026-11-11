// Production-CSP preview with an explicit, loopback-only API proxy for workspace E2E.
import { createServer, request } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
const root = resolve("dist");
const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(
  readFileSync("nginx.conf", "utf8"),
)[1];
const api = new URL(process.env.WORKSPACE_TEST_API || "http://127.0.0.1:28181");
if (api.hostname !== "127.0.0.1")
  throw new Error("E2E proxy accepts loopback only");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/") || req.url === "/health") {
    const upstream = request(
      new URL(req.url, api),
      { method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const reference = pathname === "/workspace-reference";
    let file = reference
      ? resolve("docs/design/taskira-next/reference.html")
      : resolve(root, `.${pathname}`);
    if (!reference && file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
    } catch {
      if (pathname.startsWith("/assets/")) {
        res.writeHead(404).end();
        return;
      }
      file = resolve(root, "index.html");
    }
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      ...(!reference ? { "Content-Security-Policy": csp } : {}),
      "X-Content-Type-Options": "nosniff",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(500).end();
  }
});
server.on("upgrade", (req, socket, head) => {
  const upstream = request(new URL(req.url, api), { headers: req.headers });
  upstream.on("upgrade", (response, peer, bytes) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n")}\r\n\r\n`,
    );
    if (head.length) peer.write(head);
    if (bytes.length) socket.write(bytes);
    peer.pipe(socket);
    socket.pipe(peer);
    socket.on("error", () => peer.destroy());
    peer.on("error", () => socket.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});
server.listen(Number(process.env.PLAYWRIGHT_PORT || 28182), "127.0.0.1");
