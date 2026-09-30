// Defensive regression checks for the disposable nginx/API CI stack only.
import assert from 'node:assert/strict';

const base = new URL(process.env.TASKIRA_PROXY_TEST_URL);
assert.equal(base.hostname, '127.0.0.1', 'proxy smoke must target the disposable loopback stack');
const maxBytes = Number(process.env.TASKIRA_PROXY_TEST_MAX_BYTES);
assert.ok(Number.isSafeInteger(maxBytes) && maxBytes >= 2 * 1024 * 1024);
const loginBody = { username: 'smoke_admin', password: 'Temporary-CI-Secret42!' };
const login = await fetch(new URL('/api/auth/login', base), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginBody),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const headers = { Authorization: `Bearer ${token}` };
const projects = await (await fetch(new URL('/api/projects', base), { headers })).json();
assert.ok(projects.length);
const created = await fetch(new URL(`/api/projects/${projects[0].id}/issues`, base), {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Proxy upload smoke', typeId: 'task', priorityId: 'medium', assigneeIds: [], epicId: null, complexity: null }),
});
assert.equal(created.status, 201);
const issue = await created.json();
for (const size of [2 * 1024 * 1024, maxBytes, maxBytes + 1]) {
  const form = new FormData();
  form.set('file', new Blob([Buffer.alloc(size, 0x61)], { type: 'text/plain' }), 'upload.txt');
  const response = await fetch(new URL(`/api/projects/${projects[0].id}/issues/${issue.id}/attachments`, base), {
    method: 'POST', headers, body: form,
  });
  assert.equal(response.status, size > maxBytes ? 413 : 201);
  const body = await response.json();
  if (size > maxBytes) assert.equal(body.error?.code, 'ATTACHMENT_TOO_LARGE');
  else assert.equal(body.byteSize, size);
}
// Client-supplied forwarding headers must not create independent limiter buckets.
let limited = false;
for (let i = 1; i <= 25; i++) {
  const response = await fetch(new URL('/api/auth/login', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${i}` },
    body: JSON.stringify({ username: 'nonexistent_smoke_user', password: 'Incorrect-CI-Password42!' }),
  });
  if (response.status === 429) { limited = true; break; }
  assert.equal(response.status, 401);
}
assert.ok(limited, 'nginx must preserve one real client IP for the login limiter');
// Ordinary JSON endpoints keep nginx's finite body limit.
const oversizedJson = await fetch(new URL('/api/auth/login', base), {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x'.repeat(1024 * 1024), password: 'unused' }),
});
assert.equal(oversizedJson.status, 413);
assert.match(oversizedJson.headers.get('content-type'), /text\/html/);
console.log(`nginx proxy smoke passed (maxBytes=${maxBytes})`);
