// Run inside the isolated server container, never on the working application.
const { createHash } = require('node:crypto');
const bcrypt = require('/app/node_modules/bcryptjs');

async function main() {
  const [mode, username, attachmentJson] = process.argv.slice(2);
  if (mode === 'hash') {
    console.log(bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12));
    return;
  }
  const origin = 'http://127.0.0.1:8080';
  const request = (path, options = {}) => fetch(`${origin}${path}`, {
    ...options, signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  const ready = await request('/ready');
  if (ready.status !== 200) throw new Error(`ready returned ${ready.status}`);
  const login = await request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.ADMIN_PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`login returned ${login.status}`);
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login returned no session cookie');
  const projects = await request('/api/projects', { headers: { cookie } });
  if (projects.status !== 200) throw new Error(`projects returned ${projects.status}`);
  const attachment = JSON.parse(attachmentJson);
  if (attachment) {
    const response = await request(`/api/projects/${attachment.projectId}/issues/${attachment.issueId}/attachments/${attachment.id}`, {
      headers: { cookie },
    });
    if (response.status !== 200) throw new Error(`attachment returned ${response.status}`);
    const hash = createHash('sha256');
    for await (const chunk of response.body) hash.update(chunk);
    if (hash.digest('hex') !== attachment.sha256) throw new Error('attachment checksum differs from the archive');
  }
  console.log('ready, login, projects and attachment probes passed');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
