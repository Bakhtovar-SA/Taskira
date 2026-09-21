/** Sequential baseline for first and deep keyset pages on the PERF fixture. */
const baseUrl = (process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const password = process.env.PERF_USER_PASSWORD ?? "Perf-Load-User-42!";
const limit = 200;

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "perf_001", password }),
});
if (!login.ok) throw new Error(`login failed: ${login.status} ${await login.text()}`);
const token = (await login.json()).token;
const headers = { authorization: `Bearer ${token}` };

const projectsResponse = await fetch(`${baseUrl}/api/projects`, { headers });
if (!projectsResponse.ok) throw new Error(`projects failed: ${projectsResponse.status}`);
const project = (await projectsResponse.json()).find((item) => item.key === "PERF");
if (!project) throw new Error("PERF project not found");
const endpoint = `${baseUrl}/api/projects/${project.id}/issues`;

async function page(cursor) {
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  const started = performance.now();
  const response = await fetch(url, { headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`page failed: ${response.status} ${JSON.stringify(body)}`);
  return { body, ms: performance.now() - started };
}

async function sample(cursor) {
  for (let i = 0; i < 5; i += 1) await page(cursor);
  const values = [];
  for (let i = 0; i < 10; i += 1) values.push((await page(cursor)).ms);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    values: values.map((value) => Number(value.toFixed(3))),
    median: Number(((sorted[4] + sorted[5]) / 2).toFixed(3)),
    min: Number(sorted[0].toFixed(3)),
    max: Number(sorted.at(-1).toFixed(3)),
  };
}

const first = await sample(undefined);
let cursor;
for (let pageNumber = 0; pageNumber < 249; pageNumber += 1) {
  const result = await page(cursor);
  cursor = result.body.nextCursor;
  if (!cursor) throw new Error(`fixture ended before page ${pageNumber + 1}`);
}
const deepProbe = await page(cursor);
if (deepProbe.body.items.length !== 200) throw new Error(`deep page returned ${deepProbe.body.items.length} items`);
const deep = await sample(cursor);

process.stdout.write(`${JSON.stringify({ projectId: project.id, first, deepAtOffset: 49_800, deep }, null, 2)}\n`);
