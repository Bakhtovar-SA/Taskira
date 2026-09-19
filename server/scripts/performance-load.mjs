/** Autocannon workload for the PERF fixture created by performance-seed.ts. */
import autocannon from "autocannon";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";

const baseUrl = (process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const connections = Number(process.env.PERF_CONNECTIONS ?? 200);
const duration = Number(process.env.PERF_DURATION_SECONDS ?? 30);
const timeout = Number(process.env.PERF_TIMEOUT_SECONDS ?? 30);
const issueCount = Number(process.env.PERF_EXPECTED_ISSUES ?? 50_000);
const boardColumnCards = Number(process.env.PERF_EXPECTED_BOARD_COLUMN ?? 1_500);
const password = process.env.PERF_USER_PASSWORD ?? "Perf-Load-User-42!";
const output = resolve(process.env.PERF_OUTPUT ?? "../docs/PERFORMANCE.raw.json");

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
  const projectsResponse = await fetch(`${baseUrl}/api/projects`, { headers: { authorization: `Bearer ${token}` } });
  if (!projectsResponse.ok) throw new Error(`projects: ${projectsResponse.status}`);
  const projects = await projectsResponse.json();
  const project = projects.find((item) => item.key === "PERF");
  if (!project) throw new Error("PERF project not found; run npm run perf:seed first");
  const bootResponse = await fetch(`${baseUrl}/api/projects/${project.id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!bootResponse.ok) throw new Error(`project bootstrap: ${bootResponse.status}`);
  const boot = await bootResponse.json();
  const todo = boot.workflow.statuses.find((status) => status.sid === "todo");
  if (!todo) throw new Error("PERF todo status not found");
  return { projectId: project.id, todoStatusId: todo.id };
}

function runScenario(name, tokens, options) {
  let nextToken = 0;
  const responseTimes = [];
  return new Promise((resolveRun, reject) => {
    const instance = autocannon({
      url: baseUrl,
      connections,
      duration,
      timeout,
      pipelining: 1,
      setupClient(client) {
        const token = tokens[nextToken++ % tokens.length];
        client.setHeaders({ authorization: `Bearer ${token}` });
      },
      ...options,
    }, (error, result) => {
      if (error) return reject(error);
      if (result.non2xx) {
        return reject(new Error(`${name} produced non2xx=${result.non2xx}; credentials or scenario are invalid`));
      }
      responseTimes.sort((a, b) => a - b);
      const p95 = responseTimes[Math.max(0, Math.ceil(responseTimes.length * 0.95) - 1)] ?? 0;
      resolveRun({ name, result, p95 });
    });
    instance.on("response", (_client, _statusCode, _resBytes, responseTime) => responseTimes.push(responseTime));
    process.once("SIGINT", () => instance.stop());
  });
}

const tokens = await loginUsers();
const fixture = await getFixture(tokens[0]);
const prefix = `/api/projects/${fixture.projectId}`;
const boardRequests = tokens.flatMap((token) => Array.from({ length: 8 }, (_, page) => ({
  method: "GET",
  path: `${prefix}/issues?status=${fixture.todoStatusId}&limit=200&offset=${page * 200}`,
  headers: { authorization: `Bearer ${token}` },
})));

const scenarios = [];
scenarios.push(await runScenario("project-bootstrap", tokens, { url: `${baseUrl}${prefix}` }));
scenarios.push(await runScenario("issues-first-page", tokens, { url: `${baseUrl}${prefix}/issues?limit=200&offset=0` }));
scenarios.push(await runScenario("issues-deep-page", tokens, { url: `${baseUrl}${prefix}/issues?limit=200&offset=${Math.max(0, issueCount - 200)}` }));
scenarios.push(await runScenario("board-column-1500", tokens, { requests: boardRequests }));

const compact = scenarios.map(({ name, result, p95 }) => ({
  name,
  latencyMs: {
    average: result.latency.average,
    p50: result.latency.p50,
    p95,
    p99: result.latency.p99,
    max: result.latency.max,
  },
  requestsPerSecond: result.requests.average,
  throughputBytesPerSecond: result.throughput.average,
  requests: result.requests.total,
  errors: result.errors,
  timeouts: result.timeouts,
  non2xx: result.non2xx,
}));
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  fixture: { issues: issueCount, concurrentUsers: connections, boardColumnCards },
  durationSecondsPerScenario: duration,
  timeoutSeconds: timeout,
  host: {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  },
  scenarios: compact,
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
