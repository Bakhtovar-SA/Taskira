// Local test server for the built client, using the exact production CSP.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
const root = resolve("dist");
const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(readFileSync("nginx.conf", "utf8"))?.[1];
if (!csp) throw new Error("Production CSP missing");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".webp": "image/webp", ".ico": "image/x-icon" };
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) { res.writeHead(403).end(); return; }
    try { if (!(await stat(file)).isFile()) file = resolve(root, "index.html"); }
    catch { if (path.startsWith("/assets/")) { res.writeHead(404).end(); return; } file = resolve(root, "index.html"); }
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" });
    res.end(await readFile(file));
  } catch { res.writeHead(500).end(); }
}).listen(Number(process.env.PLAYWRIGHT_PORT || 3199), "127.0.0.1");
