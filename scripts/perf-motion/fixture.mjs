import assert from 'node:assert/strict';

const fallbackGets = new Set(['/api/admin/setup', '/api/me/onboarding', '/api/auth/me', '/api/auth/config', '/api/projects', '/api/departments', '/api/instance/brand', '/api/dashboards', '/api/notifications', '/api/notifications/unread-count', '/api/issues/assigned-to-me', '/api/issues/search']);
export function issuePage(issues, params) {
  let items = issues.filter(i => (!params.get('status') || i.statusId === params.get('status')) &&
    (!params.get('parentId') || i.parentId === params.get('parentId')) &&
    (!params.get('q') || i.title.toLowerCase().includes(params.get('q').toLowerCase())) &&
    (!params.get('overdue') || !!i.dueDate && i.dueDate < '2026-10-04' && i.statusId !== 's4') &&
    (params.get('closed') !== 'hide' || i.statusId !== 's4') && (params.get('closed') !== 'older' || false));
  const sort = params.get('sort') ?? 'rank';
  const field = { rank: 'rank', key: 'key', updated: 'updatedAt', due: 'dueDate', priority: 'priorityId' }[sort];
  if (!field) throw new Error('Unsupported issue sort: ' + sort);
  items = [...items].sort((a, b) => {
    const av = a[field] ?? '', bv = b[field] ?? '';
    return (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'en', { numeric: true })) * (params.get('dir') === 'desc' ? -1 : 1);
  });
  const offset = params.has('cursor') ? Number(params.get('cursor').replace(/^perf-/, '')) : 0;
  const limit = Number(params.get('limit') ?? 100);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid pagination');
  const hasMore = offset + limit < items.length;
  return { all: items, items: items.slice(offset, offset + limit), hasMore, nextCursor: hasMore ? 'perf-' + (offset + limit) : null };
}
export function widgetsFor(n) {
  const metrics = ['open', 'overdue', 'dueSoon', 'unassigned', 'closed', 'created'];
  return Array.from({ length: n }, (_, i) => ({ id: 'perf' + i, type: 'count', metric: metrics[i % metrics.length], periodDays: 30, x: (i % 3) * 4, y: Math.floor(i / 3) * 2, w: 4, h: 2 }));
}
/** Reuse application fixtures, then put an exact method/path guard in front of every API fallback. */
export async function fixture(page, boardFixture, { count = 200, allOpen = false, widgets = 12, sprints = false, maxWidgets = 24 } = {}) {
  // Visual fixtures freeze Date through Playwright's clock, which also replaces
  // performance.mark/RAF. Measurements must retain native browser clocks.
  const realTimePage = new Proxy(page, { get(target, key) {
    if (key === 'clock') return { setFixedTime: async () => {} };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const f = await boardFixture(realTimePage, 'light', 4, 'ru');
  const template = f.issues[0];
  f.project.sprintsEnabled = sprints;
  f.issues.splice(0, f.issues.length, ...Array.from({ length: count }, (_, i) => ({ ...template, id: 'i' + (i + 1), key: 'CORP-' + (i + 1), title: 'Задача ' + (i + 1) + ': подготовить и проверить выпуск', statusId: allOpen ? 's1' : 's' + (i % 4 + 1), rank: i,
    parentId: null, epicId: null, labels: [], sprintId: null, dueDate: '2026-10-04', doneAt: !allOpen && i % 4 === 3 ? '2026-10-03T12:00:00Z' : null })));
  const state = { ...f, unknown: [], requests: [], writes: [], value: 12, widgets: widgetsFor(widgets), delayTransition: false, releaseTransition: null };
  const detail = issue => ({ ...issue, attachments: [], links: [], checklist: [], customFieldValues: [], collaboratorIds: [], comments: [], activity: [], watch: { watching: false, watchers: 0 }, subtasksSummary: { total: 0, done: 0 } });
  const dashboard = () => ({ id: 'perf-dashboard', name: 'Производительность', kind: 'project', projectId: 'p1', ownerId: null, canEdit: true, widgets: state.widgets, updatedAt: '2026-10-04T07:00:00Z' });
  await page.route('**/api/**', async route => {
    const request = route.request(), method = request.method(), url = new URL(request.url()), path = url.pathname;
    const key = method + ' ' + path;
    state.requests.push({ method, path, query: url.search });
    const json = body => route.fulfill({ json: body });
    try {
      if (method === 'GET' && path === '/api/projects/p1/saved-views') return json([]);
      if (method === 'GET' && /^\/api\/projects\/p1\/issues\/i\d+\/automation$/.test(path)) return json({ recurrence: null, remindAt: null });
      if (method === 'GET' && path === '/api/issues/collaborating') return json([]);
      if (method === 'PUT' && path === '/api/me/lang') {
        if (!['ru', 'en'].includes(request.postDataJSON().lang)) throw new Error('Unexpected language');
        return route.fulfill({ status: 204 });
      }
      if (method === 'GET' && path === '/api/projects/p1') return json({ project: f.project, users: f.users, members: f.users.map(u => ({ userId: u.id, role: 'admin' })), workflow: { statuses: f.statuses, transitions: f.statuses.flatMap(a => f.statuses.filter(b => a !== b).map(b => ({ from: a.id, to: b.id }))) }, issueTemplates: [], customFields: [], sprints: [] });
      if (method === 'GET' && path === '/api/projects') return json([f.project]);
      if (method === 'GET' && path === '/api/projects/p1/overview') return json({ dashboard: dashboard(), canEdit: true });
      if (method === 'GET' && path === '/api/roadmap') return json({ projects: [{ projectId: 'p1', id: 'p1', key: 'CORP', name: f.project.name, milestones: [], canEdit: true }], dependencies: [] });
      if (method === 'GET' && (path === '/api/projects/p1/issues' || path === '/api/projects/p1/issues/counts')) {
        const result = issuePage(f.issues, url.searchParams);
        if (path.endsWith('/counts')) return json({ total: result.all.length, byStatus: Object.fromEntries(f.statuses.map(s => [s.id, result.all.filter(i => i.statusId === s.id).length])), byPriority: { critical: result.all.length }, overdue: 0 });
        const { all, ...page } = result; return json(page);
      }
      if (method === 'GET' && path === '/api/projects/p1/issues/epics') return json({ items: [], truncated: false, limit: 200 });
      if (method === 'GET' && path === '/api/projects/p1/issues/assignees') return json({ items: f.users.map(u => ({ userId: u.id, count })), truncated: false, limit: 24 });
      const match = /^\/api\/projects\/p1\/issues\/(i\d+)(?:\/(transition|comments|activity|collaborators))?$/.exec(path);
      if (match) {
        const issue = f.issues.find(i => i.id === match[1]);
        if (!issue) return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Missing benchmark issue' } });
        if (method === 'GET' && !match[2]) return json(detail(issue));
        if (method === 'GET' && ['comments', 'activity', 'collaborators'].includes(match[2])) return json([]);
        if (method === 'DELETE' && !match[2]) { state.writes.push(key); f.issues.splice(f.issues.indexOf(issue), 1); return route.fulfill({ status: 204 }); }
        if (method === 'POST' && match[2] === 'transition') {
          const body = request.postDataJSON();
          if (!f.statuses.some(s => s.id === body.to)) throw new Error('Unknown transition status');
          if (state.delayTransition) await new Promise(resolve => { state.releaseTransition = resolve; });
          state.writes.push(key); issue.statusId = body.to; issue.updatedAt = '2026-10-04T07:00:01Z';
          return json(detail(issue));
        }
      }
      if (method === 'PATCH' && path === '/api/projects/p1/issues/bulk') {
        const body = request.postDataJSON();
        if (body.action !== 'status' || !Array.isArray(body.issueIds) || !f.statuses.some(s => s.id === body.statusId)) throw new Error('Unexpected bulk body');
        const succeeded = [], failed = [];
        for (const id of body.issueIds) {
          const issue = f.issues.find(i => i.id === id);
          if (issue) { issue.statusId = body.statusId; succeeded.push(id); } else failed.push({ issueId: id, reason: 'Missing benchmark issue', code: 'NOT_FOUND' });
        }
        state.writes.push(key); return json({ succeeded, failed });
      }
      if (method === 'POST' && path === '/api/dashboards/data') {
        const body = request.postDataJSON();
        if (!Array.isArray(body.widgets) || body.widgets.length > maxWidgets || body.widgets.some(w => w.type !== 'count')) throw new Error('Dashboard payload exceeds actual contract or uses an unmocked widget');
        return json({ results: Object.fromEntries(body.widgets.map(w => [w.id, { type: 'count', value: state.value }])) });
      }
      if (method === 'GET' && fallbackGets.has(path)) return route.fallback();
      throw new Error('Unknown API route');
    } catch (error) {
      state.unknown.push({ key, query: url.search, reason: String(error) });
      return route.fulfill({ status: 501, json: { code: 'PERF_UNMOCKED', message: String(error) } });
    }
  });
  return state;
}
export async function fixtureSelfTest() {
  const issues = Array.from({ length: 201 }, (_, i) => ({ id: 'i' + i, rank: i, statusId: 's1', title: 'T' }));
  const a = issuePage(issues, new URLSearchParams('limit=100'));
  const b = issuePage(issues, new URLSearchParams('limit=100&cursor=' + a.nextCursor));
  const c = issuePage(issues, new URLSearchParams('limit=100&cursor=' + b.nextCursor));
  assert.equal(a.items.length, 100); assert.equal(b.items.length, 100); assert.equal(c.items.length, 1);
  assert.equal(c.hasMore, false); assert.equal(new Set([...a.items, ...b.items, ...c.items].map(i => i.id)).size, 201);
  assert.throws(() => issuePage(issues, new URLSearchParams('cursor=garbage')));
  assert.throws(() => issuePage(issues, new URLSearchParams('limit=500')));
  assert.equal(widgetsFor(6).length, 6); assert.equal(new Set(widgetsFor(6).map(w => w.metric)).size, 6);
  let handler;
  const fakePage = { route: async (_pattern, callback) => { handler = callback; } };
  const state = await fixture(fakePage, async () => ({ issues: [{ id: 'i1', statusId: 's1' }], users: [], statuses: [{ id: 's1' }], project: {} }), { count: 1 });
  const call = async (path, method = 'GET') => {
    let result;
    await handler({ request: () => ({ url: () => 'http://localhost' + path, method: () => method, postDataJSON: () => ({lang:'ru'}) }),
      fulfill: async response => { result = response; }, fallback: async () => { result = 'fallback'; } });
    return result;
  };
  assert.equal(await call('/api/auth/me'), 'fallback');
  assert.deepEqual((await call('/api/issues/collaborating')).json, []);
  assert.equal((await call('/api/me/lang', 'PUT')).status, 204);
  assert.equal((await call('/api/unexpected')).status, 501);
  assert.equal((await call('/api/auth/me', 'DELETE')).status, 501);
  assert.equal(state.unknown.length, 2);
  assert.equal((await call('/api/projects/p1/issues?limit=100')).json.items.length, 1);
  console.log('perf-motion fixture self-test passed (pagination, exact route/method refusal)');
}
