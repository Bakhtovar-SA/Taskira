#!/usr/bin/env node
/** Manual-only production benchmark. No app runtime switches, dependencies, or CI integration. */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, platform, release, totalmem, tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { metrics, summarize, traceLayouts, selfTest } from './metrics.mjs';
import { fixtureSelfTest } from './fixture.mjs';
import { installProbe } from './probe.mjs';
import { probeSelfTest } from './probe-self-test.mjs';
import { SCENARIOS, prepare, unavailable } from './scenarios.mjs';

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PROFILES = {
  office: { rate: 1, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, args: [] },
  weak: { rate: 4, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, args: [] },
  vdi: { rate: 6, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.25, args: ['--disable-gpu', '--disable-gpu-compositing'] },
};
const help = [
  'node scripts/perf-motion/run.mjs [options]',
  '  --self-test             Calculation/pagination self-tests only; no browser/server/build',
  '  --repo PATH             Source checkout for fixtures/CSP/facts (REPO_ROOT; default tool checkout)',
  '  --dist PATH             Already-built client (DIST_DIR; default <repo>/dist)',
  '  --profiles office,weak,vdi  Default all three, sequential browsers',
  '  --scenarios S1,S2,...,S9    Default all, or exact IDs shown by --list',
  '  --runs N                Repetitions per profile/scenario (default 3)',
  '  --port N                Loopback preview port (default 3564)',
  '  --output PATH           Raw JSON path (default <repo>/docs/PERFORMANCE.motion-YYYY-MM-DD.raw.json)',
  '  --save-traces           Save full CDP traces beside raw JSON (large files)',
  '  --list                  Print profiles and scenario IDs; no browser',
  '  --help                  Show this help',
  'CHROMIUM_PATH optionally selects the installed executable. All execution is serial.',
].join('\n');
function options(argv) {
  const values = {}, flags = new Set(['self-test', 'save-traces', 'list', 'help']);
  const fields = new Set(['repo', 'dist', 'profiles', 'scenarios', 'runs', 'port', 'output']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !flags.has(key) && !fields.has(key)) throw new Error('Unknown argument: ' + argv[i]);
    if (key in values) throw new Error('Duplicate option: ' + key);
    values[key] = flags.has(key) ? true : argv[++i];
    if (values[key] === undefined || typeof values[key] === 'string' && values[key].startsWith('--')) throw new Error('Missing value for --' + key);
  }
  const runs = Number(values.runs ?? 3), port = Number(values.port ?? 3564);
  if (!Number.isInteger(runs) || runs < 1 || runs > 30) throw new Error('--runs must be 1..30');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be 1024..65535');
  const profiles = (values.profiles ?? 'office,weak,vdi').split(',');
  if (profiles.some(p => !PROFILES[p]) || new Set(profiles).size !== profiles.length) throw new Error('Invalid/duplicate profile');
  const selectors = values.scenarios?.split(',');
  if (selectors?.some(s => !SCENARIOS.some(spec => spec.id === s || spec.id.split('/')[0] === s))) throw new Error('Unknown scenario selector');
  const scenarios = selectors ? SCENARIOS.filter(spec => selectors.some(s => s === spec.id || s === spec.id.split('/')[0])) : SCENARIOS;
  const repo = resolve(values.repo ?? process.env.REPO_ROOT ?? toolRoot), dist = resolve(values.dist ?? process.env.DIST_DIR ?? join(repo, 'dist'));
  const output = resolve(values.output ?? join(repo, 'docs', 'PERFORMANCE.motion-' + new Date().toISOString().slice(0, 10) + '.raw.json'));
  return { ...values, runs, port, profiles, scenarios, repo, dist, output };
}
const hash = value => createHash('sha256').update(value).digest('hex');
function git(repo, args) {
  try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return null; }
}
async function sourceFacts(repo, maxWidgets) {
  const dataPath = 'src/dashboards/useDashboardData.ts', source = await readFile(join(repo, dataPath), 'utf8');
  const files = ['src/motion.ts', 'src/boardFlip.ts', 'src/CountUp.tsx', 'src/index.css', 'server/src/contract.ts', dataPath, 'e2e/board-fixture.ts', 'e2e/motion-helpers.ts'];
  return { maxWidgets, contract: 'server/src/contract.ts LIMITS.widgetsPerDashboard', hasPolling: /\bsetInterval\s*\(/.test(source),
    refreshSource: { path: dataPath, sha256: hash(source), excerpt: source.split(/\r?\n/).filter(line => /STALE_MS|onFocus|visibilitychange|refresh =|setInterval/.test(line)) },
    hashes: Object.fromEntries(await Promise.all(files.map(async path => [path, hash(await readFile(join(repo, path)))]))) };
}
async function startServer(opts) {
  const baseURL = 'http://127.0.0.1:' + opts.port;
  // An existing service must never be mistaken for the server this run owns.
  try { await fetch(baseURL, { signal: AbortSignal.timeout(500) }); throw new Error('Benchmark port is already in use: ' + opts.port); }
  catch (error) { if (String(error).includes('already in use')) throw error; }
  const index = await readFile(join(opts.dist, 'index.html'));
  const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(await readFile(join(opts.repo, 'nginx.conf'), 'utf8'))?.[1];
  if (!csp) throw new Error('Production CSP missing in target repo');
  const child = spawn(process.execPath, [join(toolRoot, 'scripts/preview-production.mjs')], {
    cwd: opts.repo, env: { ...process.env, DIST_DIR: opts.dist, PLAYWRIGHT_PORT: String(opts.port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', b => { logs = (logs + b).slice(-4000); }); child.stderr.on('data', b => { logs = (logs + b).slice(-4000); });
  let spawnError; child.on('error', error => { spawnError = error; });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null || spawnError) return;
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  };
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (spawnError || child.exitCode !== null) throw new Error('Preview failed: ' + (spawnError ?? logs));
      try {
        const response = await fetch(baseURL, { signal: AbortSignal.timeout(1000) });
        const content = Buffer.from(await response.arrayBuffer());
        if (!response.ok || hash(content) !== hash(index) || response.headers.get('content-security-policy') !== csp) throw new Error('Preview identity or exact production CSP mismatch');
        return { baseURL, close, csp, indexSha256: hash(index), indexModifiedAt: (await stat(join(opts.dist, 'index.html'))).mtime.toISOString() };
      } catch (error) { if (String(error).includes('mismatch')) throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Preview readiness timed out: ' + logs);
  } catch (error) { await close(); throw error; }
}
async function stopTrace(session) {
  const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
  await session.send('Tracing.end');
  const { stream } = await complete;
  if (!stream) throw new Error('CDP tracing returned no stream');
  try {
    const chunks = [];
    for (;;) { const part = await session.send('IO.read', { handle: stream }); chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8')); if (part.eof) break; }
    const text = Buffer.concat(chunks).toString('utf8');
    return { text, events: JSON.parse(text).traceEvents };
  } finally { await session.send('IO.close', { handle: stream }); }
}
async function measure(browser, profileName, profile, spec, run, dependencies, opts, server) {
  const row = { profile: profileName, scenario: spec.id, supplemental: !!spec.supplemental, run, status: 'unmeasured' };
  const reason = unavailable(spec, dependencies.facts);
  if (reason) return { ...row, reason };
  const context = await browser.newContext({ baseURL: server.baseURL, viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, reducedMotion: 'no-preference', locale: 'ru-RU', serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(60_000); page.setDefaultNavigationTimeout(60_000);
  let prepared, session, tracing = false;
  const errors = [], violations = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(installProbe);
  await page.addInitScript(() => { window.__motionCspViolations = []; document.addEventListener('securitypolicyviolation', event => window.__motionCspViolations.push({ directive: event.violatedDirective, blockedURI: event.blockedURI })); });
  try {
    session = await context.newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    prepared = await prepare(page, spec, dependencies);
    await session.send('Emulation.setCPUThrottlingRate', { rate: profile.rate });
    await dependencies.settle(page, 60000);
    row.setupCpuRate = 1;
    row.actionCpuRate = profile.rate;
    row.setup = prepared.info;
    row.nativeClocks = await page.evaluate(() => ({ performance: performance.now.toString().includes('[native code]'), mark: performance.mark.toString().includes('[native code]'), raf: requestAnimationFrame.toString().includes('[native code]') }));
    if (Object.values(row.nativeClocks).some(native => !native)) throw new Error('Benchmark requires native performance/mark/RAF; a fixture installed a fake clock');
    row.actualDeviceScaleFactor = await page.evaluate(() => devicePixelRatio);
    await session.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing', transferMode: 'ReturnAsStream' }); tracing = true;
    await page.evaluate(() => { performance.clearMarks('taskira-motion-start'); performance.clearMarks('taskira-motion-end'); window.__motionBenchmark.arm(900); });
    const actionStart = performance.now();
    await prepared.action();
    row.actionCommandMs = performance.now() - actionStart;
    row.raw = await page.evaluate(() => Promise.race([window.__motionBenchmark.result(), new Promise((_, reject) => setTimeout(() => reject(new Error('No trusted action or probe stalled')), 15_000))]));
    if (row.raw.aborted || row.raw.frames.length === 0) throw new Error('No complete RAF sample');
    const trace = await stopTrace(session); tracing = false;
    row.trace = traceLayouts(trace.events);
    if (!row.trace.available) {
      row.trace.diagnostics = trace.events.filter(e => String(e.cat).includes('user_timing') || String(e.name).includes('taskira')).slice(0, 16);
      await writeFile(opts.output + '.missing-marks.trace.json', trace.text);
      throw new Error('Trace lacks action-window marks');
    }
    if (opts['save-traces']) {
      const name = profileName + '-' + spec.id.replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + run + '.trace.json';
      const path = join(opts.output + '.traces', name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, trace.text); row.fullTrace = path;
    }
    row.validation = await prepared.validate();
    violations.push(...await page.evaluate(() => window.__motionCspViolations));
    if (prepared.state.unknown.length) throw new Error('Unknown API requests: ' + JSON.stringify(prepared.state.unknown));
    if (errors.length || violations.length) throw new Error('Page errors or production CSP violations');
    row.metrics = metrics(row.raw, row.trace); row.status = 'measured';
  } catch (error) {
    row.reason = String(error); row.failureAt = new Date().toISOString();
    if (!row.raw) row.raw = await page.evaluate(async () => {
      let pending;
      try { pending = window.__motionBenchmark?.result(); } catch { /* Setup failed before arm. */ }
      window.__motionBenchmark?.cancel();
      return { ...(pending ? await pending : {}), scenario: window.__motionScenario ? { wheel: window.__motionScenario.wheel, replayed: window.__motionScenario.replayed } : null };
    }).catch(() => null);
    if (tracing) {
      try { const trace = await stopTrace(session); row.trace = traceLayouts(trace.events); }
      catch (traceError) { row.traceError = String(traceError); }
      tracing = false;
    }
  } finally {
    const state = prepared?.state ?? page.__motionFixture;
    row.api = state ? { requests: state.requests, writes: state.writes, unknown: state.unknown } : null;
    row.pageErrors = errors;
    row.cspViolations = await page.evaluate(() => window.__motionCspViolations ?? []).catch(() => violations);
    await prepared?.dispose().catch(error => { row.cleanupError = String(error); });
    await context.close();
  }
  return row;
}
async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) { console.log(help); return; }
  if (opts.list) { console.log(JSON.stringify({ profiles: PROFILES, scenarios: SCENARIOS }, null, 2)); return; }
  if (opts['self-test']) {
    selfTest(); await fixtureSelfTest(); await probeSelfTest();
    assert.throws(() => options(['--runs', '0'])); assert.throws(() => options(['--runs', 'Infinity']));
    assert.throws(() => options(['--profiles', 'weak,weak'])); assert.throws(() => options(['--scenarios', 'S10']));
    assert.throws(() => options(['--port'])); assert.throws(() => options(['--bogus']));
    assert.equal(options(['--scenarios', 'S1']).scenarios.length, 2);
    assert.equal(options([]).runs, 3); assert.equal(PROFILES.vdi.rate, 6);
    assert.equal(PROFILES.weak.deviceScaleFactor, 1.25);
    assert.match(unavailable(SCENARIOS.find(s => s.id === 'S6/move-40'), { maxWidgets: 24 }), /exceed/);
    assert.equal(unavailable(SCENARIOS.find(s => s.supportedMaximum), { maxWidgets: 24 }), null);
    assert.match(unavailable(SCENARIOS.find(s => s.kind === 'poll'), { hasPolling: false }), /No automatic/);
    console.log('perf-motion CLI/scenario self-test passed. No server or browser started.'); return;
  }
  const require = createRequire(import.meta.url);
  const { chromium } = require('@playwright/test');
  const { tsImport } = require('tsx/esm/api');
  // tsx keepNames injects __name into callbacks serialized to the browser.
  // Compile unchanged fixture/helper sources without keepNames instead.
  const helperDir = await mkdtemp(join(tmpdir(), 'motion-benchmark-helpers-'));
  await build({ entryPoints: [join(opts.repo, 'e2e/board-fixture.ts'), join(opts.repo, 'e2e/motion-helpers.ts')],
    outdir: helperDir, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', keepNames: false,
    plugins: [{ name: 'installed-playwright', setup(builder) { builder.onResolve({ filter: /^@playwright\/test$/ }, () => ({ path: import.meta.resolve('@playwright/test'), external: true })); } }], logLevel: 'error' });
  const [{ boardFixture }, helpers, contract] = await Promise.all([
    import(pathToFileURL(join(helperDir, 'board-fixture.mjs')).href),
    import(pathToFileURL(join(helperDir, 'motion-helpers.mjs')).href),
    tsImport(pathToFileURL(join(opts.repo, 'server/src/contract.ts')).href, import.meta.url),
  ]);
  const facts = await sourceFacts(opts.repo, contract.LIMITS.widgetsPerDashboard);
  const loadMotion = async page => {
    const response = await page.waitForResponse(r => /motionEngine/.test(r.url()) && r.request().resourceType() === 'script', { timeout: 60_000 });
    if (!response.ok()) throw new Error('Motion engine failed to load');
    await response.finished(); await page.evaluate(async url => { await import(url); }, response.url());
    await helpers.settle(page, 60_000);
  };
  const dependencies = { boardFixture, ...helpers, loadMotion, maxWidgets: facts.maxWidgets, facts };
  await mkdir(dirname(opts.output), { recursive: true });
  const server = await startServer(opts);
  const report = { schemaVersion: 1, plannedAttempts: opts.profiles.length * opts.scenarios.length * opts.runs, startedAt: new Date().toISOString(), finishedAt: null,
    repo: opts.repo, dist: opts.dist, sourceCommit: git(opts.repo, ['rev-parse', 'HEAD']), sourceDirty: git(opts.repo, ['status', '--porcelain']),
    toolCommit: git(toolRoot, ['rev-parse', 'HEAD']), toolDirty: git(toolRoot, ['status', '--porcelain']),
    build: { indexSha256: server.indexSha256, indexModifiedAt: server.indexModifiedAt, provenance: 'Checkout commit is recorded separately; a dist supplied by the operator is not assumed to have been built from that commit.' },
    sourceFacts: facts, productionCsp: server.csp, machine: { platform: platform(), release: release(), cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, ramBytes: totalmem() },
    method: { windowMs: 900, clock: 'Native performance.now inside native RAF; Playwright fixture setFixedTime is intentionally ignored; starts at first trusted pointerdown/keydown', repeats: opts.runs, profiles: Object.fromEntries(opts.profiles.map(name => [name, PROFILES[name]])),
      longtask: 'Observer entries overlapping nominal 900ms action window', event: 'Event Timing durationThreshold16; max is an input latency candidate, not field INP. No entries means 0 above API resolution.',
      frames: 'The RAF crossing 900ms is retained, including a long stall; actualWindowMs reports overshoot.',
      layouts: 'Stack-bearing Layout enclosed by EventDispatch is a forced-layout proxy. Counts cover the action window, not identified React commits; do not apply per-commit threshold automatically.',
      setup: 'Fixture pagination, module warmup and scenario preparation run at CPU1 outside measurement; requested profile rate is applied before final settle, tracing and input. This is an interaction benchmark, not an initial-load benchmark.',
      overhead: 'RAF probe samples document.getAnimations and CountUp attributes; CDP stack tracing adds overhead. S9 additionally observes the wheel-time clone rect.', thresholds: 'Track O suggestions remain unapproved; no runtime budgets or pass/fail thresholds changed.' },
    browsers: {}, rows: [], summary: [] };
  const save = async () => { report.summary = summarize(report.rows); await writeFile(opts.output, JSON.stringify(report, null, 2) + '\n'); };
  let activeBrowser, stopping = false;
  const onSignal = () => {
    stopping = true; process.exitCode = 130;
    void activeBrowser?.close().catch(() => {}); void server.close().catch(() => {});
  };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    for (const profileName of opts.profiles) {
      if (stopping || existsSync(opts.output + '.stop')) { stopping = true; process.exitCode = 130; break; }
      const profile = PROFILES[profileName];
      const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: profile.args });
      activeBrowser = browser;
      try {
        if (stopping) break;
        const browserSession = await browser.newBrowserCDPSession();
        const gpu = await browserSession.send('SystemInfo.getInfo');
        report.browsers[profileName] = { version: browser.version(), gpu: gpu.gpu, launchArgs: profile.args };
        await browserSession.detach();
        for (let run = 1; run <= opts.runs; run++) for (const spec of opts.scenarios) {
          if (stopping) break;
          console.log(profileName + ' ' + spec.id + ' run ' + run + '/' + opts.runs);
          const row = await measure(browser, profileName, profile, spec, run, dependencies, opts, server);
          report.rows.push(row); await save();
          console.log('  ' + row.status + (row.reason ? ': ' + row.reason.split('\n')[0] : ' p95=' + row.metrics.frameP95Ms + 'ms max=' + row.metrics.frameMaxMs + 'ms'));
        }
      } finally { await browser.close(); activeBrowser = undefined; }
    }
  } finally { await server.close(); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); report.interrupted = stopping; report.finishedAt = new Date().toISOString(); await save(); }
  const failures = report.rows.filter(row => row.status !== 'measured' && !unavailable(SCENARIOS.find(s => s.id === row.scenario), facts));
  if (failures.length) { console.error(failures.length + ' unexpected unmeasured attempts; inspect raw JSON.'); process.exitCode = 1; }
  console.log(opts.output);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
