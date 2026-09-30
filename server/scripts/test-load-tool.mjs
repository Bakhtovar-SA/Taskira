// Run the actual load script against a disposable loopback fixture after UUID updates.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const server = createServer((req, res) => {
  req.resume();
  res.setHeader('Content-Type', 'application/json');
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const body = path === '/api/auth/login' ? { token: 'smoke-token' }
    : path === '/api/projects' ? [{ id: 'smoke', key: 'PERF' }]
    : path === '/api/projects/smoke' ? { workflow: { statuses: [{ id: 'todo', sid: 'todo' }] } }
    : { items: [], total: 0 };
  res.end(JSON.stringify(body));
});
const dir = await mkdtemp(join(tmpdir(), 'taskira-load-tool-'));
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const output = join(dir, 'result.json');
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./performance-load.mjs', import.meta.url))], {
    env: { ...process.env, PERF_BASE_URL: `http://127.0.0.1:${server.address().port}`, PERF_CONNECTIONS: '2', PERF_DURATION_SECONDS: '1', PERF_EXPECTED_ISSUES: '8', PERF_OUTPUT: output },
    timeout: 30000, windowsHide: true,
  });
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.scenarios.length, 4);
  for (const scenario of report.scenarios) {
    assert.ok(scenario.requests > 0);
    assert.equal(scenario.errors, 0);
    assert.equal(scenario.non2xx, 0);
    assert.equal(scenario.timeouts, 0);
  }
  console.log('load tool compatibility: all four scenarios passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\') || resolve(dir).startsWith(resolve(tmpdir()) + '/'));
  await rm(dir, { recursive: true, force: true });
}
