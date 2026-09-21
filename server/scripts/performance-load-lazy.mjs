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
 * PERF_DURATION_SECONDS (по умолчанию 60) — длительность замера каждого сценария; 60 с перекрывают
 * TTL кэша assignees (45 с), на 15 с он мог ни разу не истечь. PERF_WARMUP_SECONDS (по умолчанию 10,
 * 0 — без прогрева) — такой же прогон перед каждым сценарием, результат которого отбрасывается:
 * прогревает keep-alive соединения, пул pg, кэши процесса и планы запросов.
 * ВАЖНО: это НАСЫЩЕНИЕ — каждое соединение шлёт запросы без пауз (closed loop). Числа показывают
 * потолок сервера, а не нагрузку живых пользователей; скрипт печатает и пишет это в отчёт (`warnings`).
 * Сервер на время прогона: RATE_LIMIT_ENABLED=false (200 входов с одного адреса) и
 * MAINTENANCE_ENABLED=false. Перед прогоном проверьте, что триграммные индексы на месте.
 */
import autocannon from "autocannon";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import os from "node:os";

const baseUrl = (process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const connections = Number(process.env.PERF_CONNECTIONS ?? 100);
const duration = Number(process.env.PERF_DURATION_SECONDS ?? 60);
const warmup = Number(process.env.PERF_WARMUP_SECONDS ?? 10);
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

function runScenario(name, tokens, paths, runSeconds) {
  const responseTimes = [];
  const requests = tokens.flatMap((token) =>
    paths.map((path) => ({ method: "GET", path, headers: { authorization: `Bearer ${token}` } })),
  );
  return new Promise((resolveRun, reject) => {
    const instance = autocannon(
      { url: baseUrl, connections, duration: runSeconds, timeout, pipelining: 1, requests },
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

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function getHealth() {
  try {
    return await (await fetch(`${baseUrl}/api/health`)).json();
  } catch (error) {
    return { error: String(error) };
  }
}

const warnings = [
  "SATURATION: соединения шлют запросы без пауз (closed loop), это потолок сервера, а не пользовательская нагрузка; "
    + "числа пессимистичны (сервер, БД и генератор на одной машине) и не переносятся на прод-железо.",
];
if (warmup <= 0) warnings.push("NO WARMUP: PERF_WARMUP_SECONDS=0 — в замер попадают холодные соединения, кэши и планы запросов.");
if (duration < 60) warnings.push(`SHORT RUN: ${duration} с меньше 60 — TTL кэша assignees (45 с) мог не истечь ни разу.`);

const startedAt = new Date().toISOString();
const healthBefore = await getHealth();
for (const w of healthBefore.warnings ?? []) warnings.push(`SERVER HEALTH ${w.code}: ${w.reason}`);
if (healthBefore.error || healthBefore.ok === false) warnings.push(`SERVER HEALTH: ${JSON.stringify(healthBefore)}`);

const tokens = await loginUsers();
const fixture = await getFixture(tokens[0]);
const sets = requestSets(`/api/projects/${fixture.projectId}`, fixture.ids);

const scenarios = [];
const only = process.env.PERF_SCENARIOS ? new RegExp(process.env.PERF_SCENARIOS) : null;
for (const [name, paths] of Object.entries(sets)) {
  if (only && !only.test(name)) continue;
  if (warmup > 0) await runScenario(name, tokens, paths, warmup); // результат отбрасывается
  scenarios.push(await runScenario(name, tokens, paths, duration));
}
const healthAfter = await getHealth();

const compact = scenarios.map(({ name, result, p95 }) => ({
  name,
  latencyMs: { average: result.latency.average, p50: result.latency.p50, p95, p99: result.latency.p99, max: result.latency.max },
  requestsPerSecond: result.requests.average,
  requests: result.requests.total,
  errors: result.errors,
  timeouts: result.timeouts,
  non2xx: result.non2xx,
}));
const gitStatus = git("status", "--porcelain", "--untracked-files=no");
const report = {
  generatedAt: new Date().toISOString(),
  startedAt,
  baseUrl,
  concurrentUsers: connections,
  durationSecondsPerScenario: duration,
  warmupSecondsPerScenario: warmup,
  mode: "saturation-closed-loop",
  warnings,
  run: {
    scenarios: scenarios.map((s) => s.name),
    scenarioFilter: process.env.PERF_SCENARIOS ?? null,
    breakdown: process.env.PERF_BREAKDOWN === "1",
    timeoutSeconds: timeout,
    projectId: fixture.projectId,
    script: { git: { commit: git("rev-parse", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), dirty: gitStatus === null ? null : gitStatus.length > 0 } },
  },
  server: { healthBefore, healthAfter },
  host: {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    totalMemBytes: os.totalmem(),
    freeMemBytesAtEnd: os.freemem(),
    node: process.version,
  },
  scenarios: compact,
  // полный результат autocannon по сценариям (гистограммы задержки, статус-коды) — для пересчёта без повторного прогона
  raw: scenarios.map(({ name, result }) => ({ name, ...result, requests: { ...result.requests }, latency: { ...result.latency } })),
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}
`, "utf8");
for (const w of warnings) console.warn(`WARNING: ${w}`);
console.log(JSON.stringify({ ...report, raw: undefined }, null, 2));
