// ТЗ 5.2 — замер доски в настоящем браузере: production-сборка dist/ под production CSP
// (строка из nginx.conf), API замокан через page.route, 3 колонки × 100 карточек.
// Цифры — точка отсчёта docs/design/PERF-BUDGET.md. Это замер, не проверка CI: код выхода 0
// всегда, кроме случая, когда страница не загрузилась.
//
// playwright-core — не зависимость репозитория (как и в scripts/csp-spike/run.mjs):
//   npm run build
//   SPIKE_NODE_MODULES=/tmp/csp-spike/node_modules CHROMIUM_PATH=/path/to/chrome \
//   THROTTLE=1,4 node scripts/perf-board/run.mjs
// THROTTLE — список множителей замедления CPU (CDP Emulation.setCPUThrottlingRate).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { productionCsp } from "../csp-spike/server.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const nm = process.env.PLAYWRIGHT_NODE_MODULES ?? process.env.SPIKE_NODE_MODULES;
const { chromium } = (nm ? createRequire(join(nm, "noop.js")) : createRequire(import.meta.url))("playwright-core");
const csp = productionCsp();
const dist = join(repo, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

// Статика dist/ с SPA-фолбэком — как try_files в nginx.conf.
const server = createServer(async (req, res) => {
  let file = join(dist, new URL(req.url ?? "/", "http://x").pathname);
  let body;
  try {
    body = await readFile(file);
  } catch {
    file = join(dist, "index.html");
    body = await readFile(file);
  }
  res.writeHead(200, { "Content-Security-Policy": csp, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ── Мок API ── */
const USERS = Array.from({ length: 6 }, (_, i) => ({
  id: `u${i}`, username: `u${i}`, name: `Пользователь ${i}`, initials: `П${i}`, color: "#7c5cd6", jobRole: "Тест",
  globalRole: i === 0 ? "admin" : "member", isActive: true, authSource: "local", avatarUpdatedAt: null,
}));
const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };
const STATUSES = [
  { id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 },
  { id: "s2", sid: "inprogress", name: "В работе", category: "inprogress", position: 1 },
  { id: "s3", sid: "done", name: "Готово", category: "done", position: 2 },
];
const PER_COLUMN = 100;
const PR = ["low", "medium", "high", "critical"];
const dto = (st, n) => ({
  id: `${st}-${n}`, key: `A21-${st.slice(1)}${n}`, title: `Задача ${st}-${n}: достаточно длинный заголовок, чтобы переноситься на вторую строку`,
  description: "", typeId: n % 5 === 0 ? "bug" : "task", statusId: st, priorityId: PR[n % 4],
  assigneeIds: [USERS[n % 6].id, ...(n % 3 === 0 ? [USERS[(n + 1) % 6].id] : [])], reporterId: "u0", epicId: null, parentId: null,
  labels: n % 4 === 0 ? ["frontend", "ux"] : [], complexity: null, dueDate: n % 7 === 0 ? "2026-10-01" : null, rank: n,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: st === "s3" ? new Date().toISOString() : null,
  archivedAt: null, tStart: null, tSpan: null, color: null, sprintId: null, collaboratorIds: [], attachments: [], links: [],
  checklist: [], customFieldValues: [], subtasksSummary: { total: 0, done: 0 },
});
const boot = {
  project, users: USERS, members: USERS.map((u) => ({ userId: u.id, role: "manager" })),
  workflow: { statuses: STATUSES, transitions: [{ id: "t1", from: "s1", to: "s2" }, { id: "t2", from: "s2", to: "s3" }, { id: "t3", from: "s2", to: "s1" }] },
  issueTemplates: [], customFields: [], sprints: [],
};
let unread = 0;
const unknown = new Set();
function handle(method, url) {
  const p = url.pathname;
  const q = url.searchParams;
  if (p === "/api/auth/config") return { authMode: "local" };
  if (p === "/api/auth/me") return USERS[0];
  if (p === "/api/projects") return [project];
  if (p === "/api/departments" || p === "/api/issues/collaborating") return [];
  if (p === "/api/notifications") return { items: [], nextCursor: null };
  if (p === "/api/notifications/unread-count") return { count: unread };
  if (p === "/api/projects/p1") return boot;
  if (p === "/api/projects/p1/issues") {
    const st = q.get("status");
    return { items: st ? Array.from({ length: PER_COLUMN }, (_, n) => dto(st, n)) : [], hasMore: false, nextCursor: null };
  }
  if (p === "/api/projects/p1/issues/counts")
    return q.get("closed") === "older" ? { total: 0, byStatus: {} } : { total: 3 * PER_COLUMN, byStatus: { s1: PER_COLUMN, s2: PER_COLUMN, s3: PER_COLUMN } };
  if (p === "/api/projects/p1/issues/assignees") return { items: USERS.map((u) => ({ userId: u.id, count: 10 })) };
  if (p === "/api/projects/p1/issues/epics") return { items: [], truncated: false };
  if (p === "/api/projects/p1/saved-views") return [];
  const m = p.match(/^\/api\/projects\/p1\/issues\/(s\d-\d+)$/);
  if (m) {
    const [st, n] = m[1].split("-");
    return dto(st, Number(n));
  }
  if (/^\/api\/projects\/p1\/issues\/[^/]+\/\w+/.test(p)) return []; // comments, activity, …
  unknown.add(`${method} ${p}`);
  return {};
}

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r1 = (x) => Math.round(x * 10) / 10;

const throttles = (process.env.THROTTLE ?? "1,4").split(",").map(Number);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const out = { browser: `Chromium ${browser.version()}`, cpu: `${cpus()[0]?.model} × ${cpus().length}`, cards: 3 * PER_COLUMN, runs: {} };

for (const rate of throttles) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.effectiveDirective} ${e.sample}`));
    window.__events = [];
    new PerformanceObserver((l) => window.__events.push(...l.getEntries().map((e) => ({ name: e.name, duration: e.duration })))).observe({
      type: "event",
      durationThreshold: 16,
      buffered: true,
    });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/ws") return route.abort();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(handle(route.request().method(), url)) });
  });

  // 1. Загрузка доски до 300 карточек в DOM (от начала навигации)
  await page.goto(`${origin}/p/A21/board`);
  await page.waitForFunction((n) => document.querySelectorAll("article").length === n, 3 * PER_COLUMN, { timeout: 60_000 });
  const loadMs = await page.evaluate(() => performance.now());
  await page.waitForTimeout(500);
  const fonts = await page.evaluate(() =>
    performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".woff2")).map((r) => r.name.split("/").pop()),
  );

  // 2. Начало перетаскивания: dragstart → кадр отрисован (два rAF)
  const dragStart = [];
  for (let i = 0; i < 5; i++) {
    dragStart.push(
      await page.evaluate(async (k) => {
        const card = document.querySelectorAll("article")[k];
        window.__dt = new DataTransfer();
        const t0 = performance.now();
        card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const dt = performance.now() - t0;
        card.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: window.__dt }));
        return dt;
      }, 5 + i),
    );
    await page.waitForTimeout(150);
  }

  // 3. Кадры во время перетаскивания: dragover каждый кадр; «худший» — колонка под курсором
  //    меняется каждый кадр (подсветка колонки = setState в Board), «контроль» — одна колонка.
  const dragFrames = (alternate) =>
    page.evaluate(async (alt) => {
      const card = document.querySelectorAll("article")[5];
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cols = document.querySelectorAll("section");
      const times = [];
      let last = performance.now();
      for (let i = 0; i < 40; i++) {
        cols[alt ? 1 + (i % 2) : 1].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        times.push(now - last);
        last = now;
      }
      card.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { avgFrameMs: avg, p90FrameMs: times[Math.floor(times.length * 0.9)], fps: 1000 / avg };
    }, alternate);
  const dragWorst = await dragFrames(true);
  await page.waitForTimeout(300);
  const dragSame = await dragFrames(false);
  await page.waitForTimeout(300);

  // 4. Счётчик непрочитанных: focus → GET unread-count → кадр с новым числом на колокольчике
  const unreadMs = [];
  for (let i = 0; i < 5; i++) {
    unread = 10 + i;
    unreadMs.push(
      await page.evaluate(async (want) => {
        const badge = () => document.querySelector('button[aria-label="Уведомления"] span, button[aria-label="Notifications"] span');
        const t0 = performance.now();
        const done = new Promise((resolve) => {
          const mo = new MutationObserver(() => {
            if (badge()?.textContent === String(want)) {
              mo.disconnect();
              resolve();
            }
          });
          mo.observe(document.body, { subtree: true, childList: true, characterData: true });
          setTimeout(resolve, 5000);
        });
        window.dispatchEvent(new Event("focus"));
        await done;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      }, unread),
    );
    await page.waitForTimeout(200);
  }

  // 5. Открыть задачу настоящим кликом: от event.timeStamp клика до кадра с диалогом (MutationObserver
  //    в странице, без задержек Playwright); Event Timing «click» — то, что пошло бы в INP.
  const opens = [];
  for (let i = 0; i < 6; i++) {
    const evBefore = await page.evaluate(() => {
      window.__openMs = null;
      let clickTs = 0;
      document.addEventListener("click", (e) => (clickTs = e.timeStamp), { capture: true, once: true });
      const mo = new MutationObserver(() => {
        if (document.querySelector("[role=dialog]")) {
          mo.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => (window.__openMs = performance.now() - clickTs)));
        }
      });
      mo.observe(document.body, { subtree: true, childList: true });
      return window.__events.length;
    });
    await page.locator("article").nth(3 + i).click();
    await page.waitForFunction(() => window.__openMs !== null);
    opens.push(
      await page.evaluate((k) => ({ ms: window.__openMs, click: window.__events.slice(k).find((e) => e.name === "click")?.duration ?? null }), evBefore),
    );
    await page.keyboard.press("Escape");
    await page.waitForSelector("[role=dialog]", { state: "detached" });
    await page.waitForTimeout(300);
  }

  const cspViolations = await page.evaluate(() => window.__csp);
  const dynamicCssRules = await page.evaluate(() => document.getElementById("taskira-dynamic-styles")?.sheet?.cssRules.length ?? -1);
  out.runs[`cpu ${rate}×`] = {
    boardLoadMs: Math.round(loadMs),
    fontsOnBoard: fonts,
    dragStartMedianMs: r1(med(dragStart)),
    dragOverAlternatingColumns: { avgFrameMs: r1(dragWorst.avgFrameMs), p90FrameMs: r1(dragWorst.p90FrameMs), fps: Math.round(dragWorst.fps) },
    dragOverSameColumn: { avgFrameMs: r1(dragSame.avgFrameMs), p90FrameMs: r1(dragSame.p90FrameMs), fps: Math.round(dragSame.fps) },
    unreadBadgeMedianMs: r1(med(unreadMs)),
    openIssueFirstMs: r1(opens[0].ms),
    openIssueMedianMs: r1(med(opens.slice(1).map((o) => o.ms))),
    openIssueClickEventMs: opens.map((o) => o.click),
    cspViolations,
    dynamicCssRules,
  };
  await page.close();
}
await browser.close();
server.close();
if (unknown.size) out.unmockedApi = [...unknown];
console.log(JSON.stringify(out, null, 2));
