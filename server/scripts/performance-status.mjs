/** INT-14: некэшированные административные снимки на отдельной локальной БД с 50 000 задач. */
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.PERF_CONFIRM !== 'system-status' || !process.env.PERF_ADMIN_DATABASE_URL)
  throw new Error('Requires PERF_CONFIRM=system-status and PERF_ADMIN_DATABASE_URL');
const administrator = new URL(process.env.PERF_ADMIN_DATABASE_URL);
if (!['postgresql:', 'postgres:'].includes(administrator.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(administrator.hostname))
  throw new Error('Local PostgreSQL is required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.PERF_OUTPUT_DIR ?? join(root, 'var/perf-status'));
await mkdir(output, { recursive: true });
const name = `taskira_perf_int14_${Date.now()}`;
const url = new URL(administrator); url.pathname = '/' + name;
const admin = new pg.Client({ connectionString: String(administrator) });
let created = false, app, db;
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  Object.assign(process.env, { DATABASE_URL: String(url), NODE_ENV: 'test', AUTH_MODE: 'local',
    JWT_SECRET: 'local-system-status-benchmark-secret-00000000000000000', ADMIN_USERNAME: 'perf_admin', ADMIN_PASSWORD: 'Perf-Status-Admin-42!',
    NOTIFY_EMAIL_ENABLED: 'false', NOTIFY_WORKER_ENABLED: 'false', MAINTENANCE_ENABLED: 'false',
    STORAGE_DRIVER: 'local', STORAGE_PATH: join(output, 'storage'), WEBHOOKS_ENABLED: 'false', RATE_LIMIT_ENABLED: 'false', RECURRING_ENABLED: 'true' });
  db = await import('../src/db.js'); db.initPool(String(url)); await db.migrate();
  const config = await import('../src/config.js'); config.initConfig();
  const { seedAdmin } = await import('../src/seed.js'); await seedAdmin();
  const { seedInstance } = await import('../src/seedInstance.js'); await seedInstance();
  await promisify(execFile)(process.execPath, [join(root, 'scripts/performance-seed.mjs')], {
    cwd: root, env: { ...process.env, PERF_CONFIRM: 'seed-50000' }, windowsHide: true, timeout: 180000,
  });
  const { buildApp } = await import('../src/app.js'); app = buildApp(false); await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'perf_admin', password: 'Perf-Status-Admin-42!' } });
  if (login.statusCode !== 200) throw new Error('Benchmark login failed');
  const cookies = [login.headers['set-cookie']].flat().filter(Boolean).map(value => value.split(';')[0]).join('; ');
  const { clearSystemStatusCache } = await import('../src/services/systemStatus.js');
  const [fixture] = await db.q('SELECT count(*)::int AS issues FROM issues');
  if (fixture.issues !== 50000) throw new Error('Expected 50000 fixture issues');
  const samples = [];
  for (let n = 0; n < 35; n++) {
    clearSystemStatusCache(); const started = performance.now();
    const response = await app.inject({ method: 'GET', url: '/api/admin/status', headers: { cookie: cookies } });
    const elapsed = performance.now() - started;
    if (response.statusCode !== 200 || response.json().checks.length !== 11) throw new Error('Invalid status response');
    if (n >= 5) samples.push(elapsed);
  }
  const ordered = [...samples].sort((a, b) => a - b);
  const report = { fixture, node: process.version, platform: process.platform, poolMax: config.loadConfig().pgPoolMax,
    methodology: '30 uncached authenticated Fastify inject requests after five warmups; PostgreSQL on localhost; no scheduled jobs. Every request clears only the 15-second system-status cache. Scratch database dropped in finally.',
    latencyMs: { min: ordered[0], median: ordered[15], p95: ordered[28], max: ordered[29] }, samplesMs: samples };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.latencyMs));
  if (report.latencyMs.max >= 100) throw new Error('Uncached status exceeded 100 ms');
} finally {
  if (app) await app.close(); if (db) await db.closePool();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
