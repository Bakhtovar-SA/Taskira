import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Opt-in local fixture only. Never migrate, seed or drop the administrator connection's own database.
if (process.env.PERF_CONFIRM !== 'webhook-drain' || !process.env.PERF_ADMIN_DATABASE_URL)
  throw new Error('Requires PERF_CONFIRM=webhook-drain and PERF_ADMIN_DATABASE_URL for local PostgreSQL');
const administrator = new URL(process.env.PERF_ADMIN_DATABASE_URL);
if (!['postgresql:', 'postgres:'].includes(administrator.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(administrator.hostname)) throw new Error('Local PostgreSQL is required');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.env.PERF_OUTPUT_DIR ?? join(repo, 'server/var/perf-webhooks'));
await mkdir(dir, { recursive: true });
const require = createRequire(join(repo, 'server/package.json'));
const pg = require('pg'), run = promisify(execFile);
const { seal, webhookSecretContext } = await import(pathToFileURL(join(repo, 'server/src/services/secretBox.ts')));
const name = `taskira_perf_int04_${Date.now()}`;
const admin = new pg.Client({ connectionString: String(administrator) });
const url = new URL(administrator);
url.pathname = '/' + name; url.searchParams.set('options', '-c search_path=taskira_perf');
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: String(url), MAINTENANCE_ENABLED: 'false',
  NOTIFY_WORKER_ENABLED: 'false', RATE_LIMIT_ENABLED: 'false', JWT_SECRET: 'local-webhook-benchmark-secret-00000000000000000',
  ADMIN_USERNAME: 'perf_admin', ADMIN_PASSWORD: 'Perf-Load-Admin-42!', STORAGE_DIR: join(dir, 'webhook-perf-storage'),
  WEBHOOKS_ENABLED: 'true', WEBHOOK_ALLOWED_TARGETS: '127.0.0.0/8', WEBHOOK_ALLOW_HTTP: 'true',
  WEBHOOK_DENY_CIDRS: '', WEBHOOK_SECRET_KEY: '09'.repeat(32), PERF_SERVER_ROOT: join(repo, 'server') };
const children = [];
let client, created = false;
const report = { fixture: { issues: 50000, users: 200, patchConnections: 1, patchRequests: 4000,
  subscriptions: 4, deliveries: 10000, receiverDelayMs: 50 }, reports: [], plans: {},
  resultPersistence: 'One transaction at a time; up to four successful results use one bulk UPDATE per subscription; round-robin selection; lock only the selected sixteen deliveries',
  methodology: 'API/worker, receiver and performance-load each have a separate Node process. Three paired rounds; PATCH is measured by performance-load.mjs. Every loaded window finishes while the seeded queue is nonempty. Same source and active subscriptions in idle/dispatch variants. All scratch objects are deleted.' };
const output = resolve(process.env.PERF_OUTPUT ?? join(dir, 'report.json'));
async function save() { await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
function start(file, tsx = false) {
  const child = fork(join(repo, 'server/scripts', file), [], { cwd: join(repo, 'server'), env, execArgv: tsx ? ['--import', 'tsx'] : [],
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.on('data', data => process.stderr.write(data)); children.push(child); return child;
}
function response(child, kind, send) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Child timed out: ' + kind)); }, 330000);
    const done = message => { if (message.kind === kind) { cleanup(); resolve(message); } };
    const exit = code => { cleanup(); reject(new Error('Child exited: ' + code)); };
    const cleanup = () => { clearTimeout(timer); child.off('message', done); child.off('exit', exit); };
    child.on('message', done); child.once('exit', exit); if (send) child.send(send);
  });
}
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  client = new pg.Client({ connectionString: String(url) }); await client.connect(); await client.query('CREATE SCHEMA taskira_perf');
  const receiver = start('performance-webhook-receiver.mjs'), receiverInfo = await response(receiver, 'ready');
  const server = start('performance-webhook-server.mjs', true), info = await response(server, 'ready');
  await run(process.execPath, [join(repo, 'server/scripts/performance-seed.mjs')], { cwd: dir, windowsHide: true, env: { ...env, PERF_CONFIRM: 'seed-50000' }, timeout: 180000 });
  const project = (await client.query("SELECT id FROM projects WHERE key='PERF'")).rows[0].id;
  const key = Buffer.alloc(32, 9);
  for (let n = 0; n < 4; n++) {
    const id = crypto.randomUUID();
    await client.query(`INSERT INTO webhooks (id,project_id,name,url_enc,url_display,secret_enc,events)
      VALUES ($1,$2,$3,$4,$5,$6,ARRAY['issue.created'])`, [id,project,'Perf '+n,seal(receiverInfo.url,key,webhookSecretContext(id,'url')),receiverInfo.url,seal('fixture-secret',key,webhookSecretContext(id,'secret'))]);
  }
  const load = async (variant, round, requests = 4000) => {
    const file = join(dir, `webhook-patch-${variant}-${round}.json`);
    await run(process.execPath, [join(repo, 'server/scripts/performance-load.mjs')], { cwd: dir, windowsHide: true, timeout: 120000,
      env: { ...env, PERF_BASE_URL: info.url, PERF_SCENARIO: 'integration-writes', PERF_WRITE_KINDS: 'patch',
        PERF_CONFIRM: 'load-writes', PERF_CONNECTIONS: '1', PERF_DURATION_SECONDS: '2', PERF_REQUESTS_PER_SCENARIO: String(requests), PERF_OUTPUT: file } });
    const result = JSON.parse(await readFile(file,'utf8'));
    assert.equal(result.scenarios[0].requests, requests);
    console.log(JSON.stringify({ variant, round, latency: result.scenarios[0].latencyMs }));
    return result;
  };
  await load('warmup',0,1000);
  for (let round = 1; round <= 3; round++) {
    await client.query('TRUNCATE integration_events RESTART IDENTITY CASCADE');
    const idle = await load('idle',round); await client.query('TRUNCATE integration_events RESTART IDENTITY CASCADE');
    await client.query(`INSERT INTO integration_events (type,project_id,dedupe_key)
      SELECT 'issue.created',$1,'bench:'||n FROM generate_series(1,2500)n`,[project]);
    await response(server,'fanout','fanout');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM webhook_deliveries')).rows[0].n,10000);
    await response(receiver,'reset','reset');
    const drained = response(server,'drained','drain');
    void drained.catch(() => undefined); // cleanup can close the child before this result is awaited
    const loaded = await load('dispatch',round);
    const remainingAfterLoad = (await client.query("SELECT count(*)::int AS n FROM webhook_deliveries WHERE state IN ('pending','sending')")).rows[0].n;
    assert.ok(remainingAfterLoad > 0, 'PATCH window must finish before the queue drains');
    const drain = await drained, received = await response(receiver,'stats','stats');
    assert.equal(received.count,10000); assert.equal(received.duplicates,0); assert.ok(received.peak<=16);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM webhook_deliveries WHERE state='succeeded'")).rows[0].n,10000);
    report.reports.push({round,idle,loaded,drain,receiver:received,remainingAfterLoad}); await save();
    console.log(JSON.stringify({round,drain,received}));
  }
  await client.query('TRUNCATE integration_events RESTART IDENTITY CASCADE');
  await client.query(`INSERT INTO integration_events (type,project_id,dedupe_key,payload,dispatched_at)
    SELECT 'issue.created',$1,'plan:'||n,'{}',CASE WHEN n<=99900 THEN now() ELSE NULL END FROM generate_series(1,100000)n`,[project]);
  await client.query(`INSERT INTO webhook_deliveries (webhook_id,event_id,state)
    SELECT w.id,e.id,CASE WHEN e.id<=99900 THEN 'succeeded' ELSE 'pending' END FROM integration_events e
    JOIN (SELECT id,row_number() OVER(ORDER BY id) AS n FROM webhooks) w ON (e.id-1)%4+1=w.n`);
  await client.query('ANALYZE integration_events'); await client.query('ANALYZE webhook_deliveries');
  const source = await readFile(join(repo,'server/src/services/webhookDispatch.ts'),'utf8');
  for (const [kind,regexp] of [['fanout',/client\.query<FanOutRow>\(`([\s\S]*?)`/],['claim',/client\.query<ClaimedDelivery>\(`([\s\S]*?)`/]]) {
    const sql = source.match(regexp)?.[1]; assert.ok(sql,kind);
    await client.query('BEGIN');
    try { report.plans[kind]=(await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql, kind==='claim' ? [null] : [])).rows[0]['QUERY PLAN'][0]; }
    finally { await client.query('ROLLBACK'); }
  }
  await client.query("UPDATE webhook_deliveries SET state='pending'"); await client.query('ANALYZE webhook_deliveries');
  await client.query('BEGIN');
  try { report.plans.claimDense=(await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+source.match(/client\.query<ClaimedDelivery>\(`([\s\S]*?)`/)[1], [null])).rows[0]['QUERY PLAN'][0]; }
  finally { await client.query('ROLLBACK'); }
  report.plans.eventLookup=(await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM webhook_deliveries WHERE event_id=99999')).rows[0]['QUERY PLAN'][0];
  await save();
} finally {
  for (const child of children) if (child.exitCode===null && child.signalCode===null) await new Promise(resolve=>{child.once('exit',resolve);child.send('close');});
  if (client) await client.end();
  if (created) { assert.match(name,/^taskira_perf_int04_[0-9]+$/); await admin.query(`DROP DATABASE "${name}"`); console.log('Dropped scratch database '+name); }
  await admin.end();
}
