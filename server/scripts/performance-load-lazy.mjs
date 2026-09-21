/**
 * Autocannon-нагрузка по ленивой загрузке (PERF-05/06): то, что клиент реально запрашивает после
 * того, как bootstrap перестал грузить весь проект. Дополняет `performance-load.mjs`, который
 * мерит прежний offset-обход (`limit=200&offset=…`, оставленный сервером только для совместимости).
 *
 * Сценарии — набор запросов на каждое соединение (свой пользователь perf_NNN):
 *   board-cold-start  counts + три страницы колонок + epics + assignees (то, что уходит при открытии доски)
 *   search-hit        ?q=&limit=8 с совпадениями
 *   search-miss       ?q=&limit=8 без совпадений
 *   mixed             всё вместе в пропорции «один пользователь открыл доску и ищет»
 *
 * Только для изолированного стенда (схема `taskira_perf`), см. docs/OPERATIONS.md.
 * PERF_BREAKDOWN=1 — дополнительно каждый запрос холодного старта отдельным сценарием.
 * PERF_SCENARIOS=<regexp> — запускать только сценарии с подходящим именем.
 * Сервер на время прогона: RATE_LIMIT_ENABLED=false (200 входов с одного адреса) и
 * MAINTENANCE_ENABLED=false. Перед прогоном проверьте, что триграммные индексы на месте.
 */
import autocannon from "autocannon";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";

const baseUrl = (process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const connections = Number(process.env.PERF_CONNECTIONS ?? 100);
const duration = Number(process.env.PERF_DURATION_SECONDS ?? 15);
const timeout = Number(process.env.PERF_TIMEOUT_SECONDS ?? 30);
const password = process.env.PERF_USER_PASSWORD ?? "Perf-Load-User-42!";
const output = resolve(process.env.PERF_OUTPUT ?? "./performance-load-lazy.raw.json");

async function login(number) {
  const username = `perf_${String(number).padStart(3, "0")}`;
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login ${username}: ${response.status} ${await response.text()}`);
  return (await response.json()).token;
}

async function loginUsers() {
  const tokens = [];
  for (let start = 1; start <= connections; start += 20) {
    const batch = Array.from({ length: Math.min(20, connections - start + 1) }, (_, i) => login(start + i));
    tokens.push(...(await Promise.all(batch)));
  }
  return tokens;
}

async function getFixture(token) {
  const auth = { authorization: `Bearer ${token}` };
  const projects = await (await fetch(`${baseUrl}/api/projects`, { headers: auth })).json();
  const project = projects.find((item) => item.key === "PERF");
  if (!project) throw new Error("PERF project not found; run npm run perf:seed first");
  const boot = await (await fetch(`${baseUrl}/api/projects/${project.id}`, { headers: auth })).json();
  const byStatus = (sid) => boot.workflow.statuses.find((s) => s.sid === sid)?.id;
  const ids = { todo: byStatus("todo"), inprogress: byStatus("inprogress"), done: byStatus("done") };
  if (!ids.todo || !ids.inprogress || !ids.done) throw new Error("PERF workflow statuses not found");
  return { projectId: project.id, ids };
}

const SEARCH_HIT = ["issue 2140", "issue 40970", "performance issue 3", "issue 1505", "issue 777"];
const SEARCH_MISS = ["nomatchxyz", "qwertyuiop", "zzqqxx"];
const enc = encodeURIComponent;

function requestSets(prefix, ids) {
  const boardStart = [
    `${prefix}/issues/counts`,
    `${prefix}/issues?status=${ids.todo}&sort=rank&dir=asc&limit=100`,
    `${prefix}/issues?status=${ids.inprogress}&sort=rank&dir=asc&limit=100`,
    `${prefix}/issues?status=${ids.done}&closed=recent&closedDays=14&sort=rank&dir=asc&limit=100`,
    `${prefix}/issues/epics`,
    `${prefix}/issues/assignees?limit=24`,
  ];
  const hit = SEARCH_HIT.map((q) => `${prefix}/issues?q=${enc(q)}&limit=8`);
  const miss = SEARCH_MISS.map((q) => `${prefix}/issues?q=${enc(q)}&limit=8`);
  const sets = { "board-cold-start": boardStart, "search-hit": hit, "search-miss": miss, mixed: [...boardStart, ...hit, ...miss] };
  if (process.env.PERF_BREAKDOWN === "1") {
    // каждый запрос холодного старта отдельно — чтобы увидеть, какой из шести доминирует
    const names = ["counts", "page-todo", "page-inprogress", "page-done-recent", "epics", "assignees"];
    boardStart.forEach((path, i) => (sets[`only:${names[i]}`] = [path]));
  }
  return sets;
}

function runScenario(name, tokens, paths) {
  const responseTimes = [];
  const requests = tokens.flatMap((token) =>
    paths.map((path) => ({ method: "GET", path, headers: { authorization: `Bearer ${token}` } })),
  );
  return new Promise((resolveRun, reject) => {
    const instance = autocannon(
      { url: baseUrl, connections, duration, timeout, pipelining: 1, requests },
      (error, result) => {
        if (error) return reject(error);
        if (result.non2xx) return reject(new Error(`${name} produced non2xx=${result.non2xx}; credentials or scenario are invalid`));
        responseTimes.sort((a, b) => a - b);
        const p95 = responseTimes[Math.max(0, Math.ceil(responseTimes.length * 0.95) - 1)] ?? 0;
        resolveRun({ name, result, p95 });
      },
    );
    instance.on("response", (_client, _statusCode, _resBytes, responseTime) => responseTimes.push(responseTime));
    process.once("SIGINT", () => instance.stop());
  });
}

const tokens = await loginUsers();
const fixture = await getFixture(tokens[0]);
const sets = requestSets(`/api/projects/${fixture.projectId}`, fixture.ids);

const scenarios = [];
const only = process.env.PERF_SCENARIOS ? new RegExp(process.env.PERF_SCENARIOS) : null;
for (const [name, paths] of Object.entries(sets)) if (!only || only.test(name)) scenarios.push(await runScenario(name, tokens, paths));

const compact = scenarios.map(({ name, result, p95 }) => ({
  name,
  latencyMs: { average: result.latency.average, p50: result.latency.p50, p95, p99: result.latency.p99, max: result.latency.max },
  requestsPerSecond: result.requests.average,
  requests: result.requests.total,
  errors: result.errors,
  timeouts: result.timeouts,
  non2xx: result.non2xx,
}));
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  concurrentUsers: connections,
  durationSecondsPerScenario: duration,
  host: { platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model ?? "unknown", logicalCpus: os.cpus().length, node: process.version },
  scenarios: compact,
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
