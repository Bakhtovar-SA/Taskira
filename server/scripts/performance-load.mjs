/** Autocannon workload for the PERF fixture created by performance-seed.ts. */
import autocannon from "autocannon";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const connections = Number(process.env.PERF_CONNECTIONS ?? 200);
const duration = Number(process.env.PERF_DURATION_SECONDS ?? 30);
const timeout = Number(process.env.PERF_TIMEOUT_SECONDS ?? 30);
const issueCount = Number(process.env.PERF_EXPECTED_ISSUES ?? 50_000);
const boardColumnCards = Number(process.env.PERF_EXPECTED_BOARD_COLUMN ?? 1_500);
const password = process.env.PERF_USER_PASSWORD ?? "Perf-Load-User-42!";
const output = resolve(process.env.PERF_OUTPUT ?? "../docs/PERFORMANCE.raw.json");
const writeMode = process.env.PERF_SCENARIO === "integration-writes";
const writeKinds = (process.env.PERF_WRITE_KINDS ?? "patch,transition").split(",").map((kind) => kind.trim());
if (writeMode && (writeKinds.some((kind) => !["patch", "transition"].includes(kind))
  || new Set(writeKinds).size !== writeKinds.length)) {
  throw new Error("PERF_WRITE_KINDS must select patch and/or transition without duplicates");
}
const writeRequests = process.env.PERF_REQUESTS_PER_SCENARIO === undefined
  ? undefined : Number(process.env.PERF_REQUESTS_PER_SCENARIO);
if (writeMode && process.env.PERF_CONFIRM !== "load-writes") {
  throw new Error("Write workload requires PERF_CONFIRM=load-writes and an isolated taskira_perf schema");
}
if (writeMode && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the write workload");
if (writeMode && writeRequests !== undefined
  && (!Number.isInteger(writeRequests) || writeRequests < connections * 2 || writeRequests % (connections * 2) !== 0)) {
  throw new Error("PERF_REQUESTS_PER_SCENARIO must contain an equal, even number of requests per connection");
}

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
      if (result.non2xx || result.errors || result.timeouts || result.mismatches) {
        return reject(new Error(`${name} failed: non2xx=${result.non2xx}, errors=${result.errors}, timeouts=${result.timeouts}, mismatches=${result.mismatches}`));
      }
      responseTimes.sort((a, b) => a - b);
      const percentile = (fraction) => responseTimes[Math.max(0, Math.ceil(responseTimes.length * fraction) - 1)] ?? 0;
      resolveRun({ name, result, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) });
    });
    instance.on("response", (_client, _statusCode, _resBytes, responseTime) => responseTimes.push(responseTime));
    const stop = () => instance.stop();
    process.once("SIGINT", stop);
    instance.once("done", () => process.off("SIGINT", stop));
  });
}

/** Opt-in real mutations. Snapshot values by UUID; leave and report history/audit side effects. */
async function runWrites(tokens, fixture) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let rows = [];
  try {
    const location = (await client.query(`SELECT current_database() AS db, current_schema() AS schema`)).rows[0];
    if (!/^taskira_(perf|test)/.test(location.db) || location.schema !== "taskira_perf") {
      throw new Error("Write workload requires an isolated taskira_perf schema in a taskira_perf/test database");
    }
    const progress = (await client.query(`SELECT id FROM workflow_statuses WHERE project_id = $1 AND sid = 'inprogress'`, [fixture.projectId])).rows[0];
    rows = (await client.query(
      `SELECT id, title, status_id, rank::text, updated_at::text, done_at::text, archived_at::text
         FROM issues WHERE project_id = $1 AND status_id = $2 ORDER BY num LIMIT $3`,
      [fixture.projectId, fixture.todoStatusId, connections],
    )).rows;
    if (!progress || rows.length !== connections) throw new Error("PERF fixture lacks enough todo issues or inprogress status");
    // A fresh title marker proves that HTTP and SQL point to the same database before HTTP mutations.
    const marker = `INT-02 probe ${randomUUID()}`;
    await client.query(`UPDATE issues SET title = $2 WHERE id = $1`, [rows[0].id, marker]);
    const probe = await fetch(`${baseUrl}/api/projects/${fixture.projectId}/issues/${rows[0].id}`, {
      headers: { authorization: `Bearer ${tokens[0]}` },
    });
    if (!probe.ok || (await probe.json()).title !== marker) throw new Error("HTTP server and DATABASE_URL do not refer to the same fixture");
    await client.query(`UPDATE issues SET title = $2 WHERE id = $1`, [rows[0].id, rows[0].title]);
    const ids = rows.map((row) => row.id);
    const counts = async () => (await client.query(
      `SELECT (SELECT count(*)::int FROM activity WHERE issue_id = ANY($1::uuid[])) AS activity,
              (SELECT count(*)::int FROM audit_log WHERE entity_id = ANY($1::uuid[])) AS audit`, [ids],
    )).rows[0];
    const before = await counts();
    const scenarios = [];
    for (const kind of writeKinds) {
      let nextClient = 0;
      scenarios.push(await runScenario(`issue-${kind}`, tokens, {
        ...(writeRequests === undefined ? {} : { amount: writeRequests }),
        setupClient(connection) {
          const index = nextClient++;
          const row = rows[index];
          const path = `/api/projects/${fixture.projectId}/issues/${row.id}`;
          connection.setRequests([0, 1].map((step) => ({
            method: kind === "patch" ? "PATCH" : "POST",
            path: kind === "patch" ? path : `${path}/transition`,
            headers: { authorization: `Bearer ${tokens[index]}`, "content-type": "application/json" },
            body: JSON.stringify(kind === "patch"
              ? { title: step === 0 ? `${row.title} [INT-02]` : row.title }
              : { to: step === 0 ? progress.id : row.status_id }),
          })));
        },
      }));
      // Autocannon can close a socket with its final request still executing on the server.
      // Allow that request to finish before the snapshot is restored or the next scenario starts.
      await new Promise((resolveDrain) => setTimeout(resolveDrain, 1000));
    }
    const after = await counts();
    return { scenarios, mutation: { database: location.db, schema: location.schema, issueIds: ids,
      addedActivity: after.activity - before.activity, addedAudit: after.audit - before.audit } };
  } finally {
    try {
      for (const row of rows) {
        await client.query(
          `UPDATE issues SET title = $2, status_id = $3, rank = $4, updated_at = $5, done_at = $6, archived_at = $7 WHERE id = $1`,
          [row.id, row.title, row.status_id, row.rank, row.updated_at, row.done_at, row.archived_at],
        );
      }
    } finally { await client.end(); }
  }
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
let mutation;
if (writeMode) {
  const writes = await runWrites(tokens, fixture);
  scenarios.push(...writes.scenarios);
  mutation = writes.mutation;
} else {
  scenarios.push(await runScenario("project-bootstrap", tokens, { url: `${baseUrl}${prefix}` }));
  scenarios.push(await runScenario("issues-first-page", tokens, { url: `${baseUrl}${prefix}/issues?limit=200&offset=0` }));
  scenarios.push(await runScenario("issues-deep-page", tokens, { url: `${baseUrl}${prefix}/issues?limit=200&offset=${Math.max(0, issueCount - 200)}` }));
  scenarios.push(await runScenario("board-column-1500", tokens, { requests: boardRequests }));
}

const compact = scenarios.map(({ name, result, p50, p95, p99 }) => ({
  name,
  latencyMs: {
    average: result.latency.average,
    p50,
    p95,
    p99,
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
  durationSecondsPerScenario: writeMode && writeRequests !== undefined ? null : duration,
  ...(writeMode && writeRequests !== undefined ? { requestsPerScenario: writeRequests } : {}),
  ...(writeMode ? { writeKinds } : {}),
  timeoutSeconds: timeout,
  host: {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  },
  scenarios: compact,
  mutation,
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
