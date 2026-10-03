/** Reproducible UX audit fixture; no live API or database writes.
 * Run with AUDIT_BASE_URL=http://127.0.0.1:3107 npx tsx docs/design/audit-2026-10-03/capture.ts
 * Synthetic data only. Artifacts describe the actual UI, not production content.
 */
import { chromium, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mockApi } from '../../../e2e/fixtures';

const out = resolve(process.env.AUDIT_OUTPUT_DIR || 'docs/design/audit-2026-10-03');
await mkdir(resolve(out, 'screens'), { recursive: true });
const base = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3107';
const production = process.env.AUDIT_PRODUCTION === '1';
const names = ['Анна Смирнова', 'Игорь Петров', 'Мария Козлова', 'Екатерина Волкова', 'Алексей Соколов', 'Дмитрий Васильев'];
const users = names.map((name, n) => ({ id: `u${n + 1}`, username: `audit${n}`, name, initials: name.split(' ').map(s => s[0]).join(''), color: '', jobRole: n ? 'Специалист' : 'Менеджер проекта', globalRole: n ? 'member' : 'admin', isActive: true, authSource: 'local', favoriteProjectIds: ['p1'], notifyPrefs: {}, onboarding: { hidden: true } }));
const projects = [
  { id: 'p1', key: 'CORP', name: 'Корпоративные задачи', departmentId: 'dep1', color: 'violet' },
  { id: 'p2', key: 'PORTAL', name: 'Запуск клиентского портала', departmentId: 'dep1', color: 'teal' },
  { id: 'p3', key: 'DOC', name: 'Переход на электронный документооборот', departmentId: 'dep1', color: 'amber' },
  { id: 'p4', key: 'HR', name: 'Найм и адаптация сотрудников', departmentId: 'dep2', color: 'pink' },
  { id: 'p5', key: 'LEGAL', name: 'Договоры с поставщиками и согласование юридических документов', departmentId: 'dep2', color: 'sky' },
].map(p => ({ ...p, description: '', isShared: false, sprintsEnabled: false, defaultView: 'board', suggestedLabels: ['аналитика', 'дизайн', 'интеграция'], icon: null, background: null, backgroundPhoto: null, isDemo: false, startDate: '2026-09-14', targetDate: '2026-11-02' }));
const statuses = [
  { id: 's1', sid: 'todo', name: 'К выполнению', category: 'todo', position: 0 },
  { id: 's2', sid: 'inprogress', name: 'В работе', category: 'inprogress', position: 1 },
  { id: 's3', sid: 'review', name: 'На ревью', category: 'inprogress', position: 2 },
  { id: 's4', sid: 'done', name: 'Готово', category: 'done', position: 3 },
];
const titles = [
  'Собрать требования отдела продаж к личному кабинету', 'Согласовать макет главной страницы портала',
  'Подготовить шаблон договора поставки', 'Обновить инструкции для новых сотрудников',
  'Проверить права доступа внешних участников', 'Настроить маршрут согласования счетов',
  'Интеграция с 1С: выгрузка контрагентов', 'Чек-лист первого рабочего дня',
  'Исправить экспорт отчёта в PDF', 'Утвердить график запуска нового клиентского портала',
  'Проверить доступность интерфейса с клавиатуры', 'Обновить шаблон счёта',
  'Согласовать подробные требования по обработке заявок от региональных подразделений и внешних партнёров',
  'Прототип онбординга в мобильном браузере', 'Подготовить отчёт по воронке найма',
  'Документировать процесс обработки обращений', 'Сверить сроки по договорам', 'Провести ревью навигации',
  'Проверить уведомления о просроченных задачах', 'Добавить инструкции в базу знаний', 'Закрыть замечания пилотной группы',
];
const issues = titles.map((title, n) => ({
  id: `i${n + 1}`, key: `CORP-${n + 1}`, title, description: n === 0 ? 'Собрать требования от руководителей отделов и согласовать их перед началом разработки.\n\nКритерии готовности:\n- описаны основные рабочие сценарии;\n- согласованы роли участников;\n- утверждён список обязательных полей.' : '',
  typeId: n === 8 ? 'bug' : 'task', statusId: `s${Math.min(4, Math.floor(n / 6) + 1)}`,
  priorityId: ['high', 'medium', 'low', 'medium', 'critical'][n % 5],
  assigneeIds: n % 5 === 2 ? [] : [...new Set([users[n % users.length].id, ...(n % 7 === 0 ? ['u3'] : [])])],
  reporterId: 'u1', epicId: n % 3 === 0 ? 'e1' : n % 3 === 1 ? 'e2' : null,
  parentId: null, sprintId: null, labels: n % 4 === 0 ? ['аналитика', 'клиентский портал'] : n % 4 === 1 ? ['дизайн'] : n % 4 === 2 ? ['интеграция'] : [], complexity: null,
  dueDate: n % 4 === 0 ? '2026-10-01' : n % 4 === 1 ? '2026-10-05' : n % 4 === 2 ? '2026-10-09' : null,
  rank: n, createdAt: '2026-09-28T09:00:00Z', updatedAt: '2026-10-02T12:00:00Z',
  doneAt: n >= 18 ? '2026-10-02T12:00:00Z' : null, archivedAt: null,
  attachments: [], links: [], checklist: n === 0 ? [{ id: 'cl1', text: 'Получить обратную связь от отдела продаж', done: false, position: 0, createdAt: '2026-10-01T09:00:00Z' }] : [],
  customFieldValues: [], collaboratorIds: [], collaborators: [], comments: [], activity: [],
  watch: { watching: false, watchers: 2 }, subtasksSummary: { total: 0, done: 0 }, epicChildrenCount: 0,
}));
const epics = [
  { id: 'e1', key: 'CORP-100', title: 'Запуск клиентского портала', color: null, statusId: 's2', childTotal: 7, childDone: 1, tStart: 0, tSpan: 4 },
  { id: 'e2', key: 'CORP-101', title: 'Переход на электронный документооборот', color: null, statusId: 's2', childTotal: 7, childDone: 1, tStart: 2, tSpan: 5 },
];

async function fixture(page: Page, empty = false) {
  await mockApi(page, users[0] as any);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const q = url.searchParams;
    let body: any;
    if (path === '/projects') body = projects;
    else if (path === '/departments') body = [{ id: 'dep1', name: 'Общий отдел' }, { id: 'dep2', name: 'Отдел персонала и поддержки' }];
    else if (path === '/users') body = users;
    else if (path === '/me/onboarding') body = { done: [], hints: ['board.drag', 'home.new', 'home', 'board'], hidden: true };
    else if (/^\/projects\/p\d$/.test(path)) body = { project: projects.find(p => path.endsWith(p.id)), users, members: users.map(u => ({ userId: u.id, role: u.id === 'u1' ? 'admin' : 'employee' })), workflow: { statuses, transitions: statuses.flatMap(a => statuses.filter(b => b.id !== a.id).map(b => ({ id: `${a.id}-${b.id}`, fromId: a.id, toId: b.id, roles: ['admin', 'manager', 'employee'] }))) }, issueTemplates: [], customFields: [], sprints: [] };
    else if (path === '/issues/assigned-to-me') body = { items: empty ? [] : issues.filter(i => i.assigneeIds.includes('u1') && i.statusId !== 's4').map(i => ({ issueId: i.id, projectId: 'p1', key: i.key, title: i.title, typeId: i.typeId, priorityId: i.priorityId, statusId: i.statusId, statusName: statuses.find(s => s.id === i.statusId)!.name, statusCategory: statuses.find(s => s.id === i.statusId)!.category, dueDate: i.dueDate, projectKey: 'CORP', projectName: projects[0].name })), truncated: false, limit: 100 };
    else if (/^\/projects\/p\d\/issues(?:\/counts)?$/.test(path)) {
      const st = q.get('status') || q.get('statusId');
      const assignee = q.get('assignee') || q.get('assigneeId');
      let filtered = empty ? [] : issues.filter(i => (!st || i.statusId === st) && (!q.get('q') || `${i.title} ${i.key}`.toLowerCase().includes(q.get('q')!.toLowerCase())) && (!q.get('parentId') || i.parentId === q.get('parentId')) && (!assignee || (assignee === 'none' ? !i.assigneeIds.length : i.assigneeIds.includes(assignee))) && (!['true', '1'].includes(q.get('overdue') ?? '') || (i.dueDate && i.dueDate < '2026-10-03' && i.statusId !== 's4')));
      if (q.get('closed') === 'older') filtered = [];
      if (q.get('closed') === 'recent') filtered = filtered.filter(i => i.statusId === 's4');
      body = path.endsWith('/counts') ? { total: filtered.length, byStatus: Object.fromEntries(statuses.map(s => [s.id, filtered.filter(i => i.statusId === s.id).length])), byPriority: {}, overdue: filtered.filter(i => i.dueDate && i.dueDate < '2026-10-03' && i.statusId !== 's4').length } : { items: filtered, hasMore: false, nextCursor: null };
    }
    else if (path.endsWith('/issues/epics')) body = { items: empty ? [] : epics, truncated: false, limit: 200 };
    else if (path.endsWith('/issues/assignees')) body = { items: empty ? [] : users.map(u => ({ userId: u.id, count: 3 })), truncated: false, limit: 200 };
    else if (/\/issues\/i\d+$/.test(path)) body = issues.find(i => path.endsWith(`/${i.id}`));
    else if (/\/issues\/e[12]$/.test(path)) body = { ...issues[0], ...epics.find(e => path.endsWith(`/${e.id}`)), epicId: null, labels: [], parentId: null, assigneeIds: [], epicChildrenCount: 7 };
    else if (path === '/issues/resolve') body = { id: issues.find(i => i.key === q.get('key'))?.id ?? 'i1', projectId: 'p1', projectKey: 'CORP' };
    else if (path.endsWith('/activity') || path.endsWith('/comments') || path.endsWith('/subtasks') || path.endsWith('/collaborators')) body = [];
    else if (path === '/roadmap') body = { projects: projects.map(p => ({ ...p, projectId: p.id, projectKey: p.key, projectName: p.name, canEdit: true, total: 21, done: 3, milestones: [{ id: `m-${p.id}`, projectId: p.id, name: 'Пилотный запуск', date: '2026-10-15' }] })), dependencies: [] };
    else if (path === '/notifications') body = { items: [], nextCursor: null };
    else return route.fallback();
    return route.fulfill({ json: body });
  });
}

const browser = await chromium.launch({ headless: true });
const probe = process.argv.includes('--probe');
const followup = process.argv.includes('--followup') || probe;
const results: any[] = followup ? JSON.parse(await readFile(resolve(out, 'observations.json'), 'utf8')) : [];
async function newPage(theme = 'light', width = 1440, height = 900, empty = false, density = 'comfortable') {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', timezoneId: 'Asia/Tashkent', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-03T09:00:00Z'));
  await page.addInitScript(({ theme, density }) => { (window as any).__name = (fn: any) => fn; localStorage.setItem('taskira.theme', theme); localStorage.setItem('taskira.lang', 'ru'); localStorage.setItem('taskira.density', density); }, { theme, density });
  await fixture(page, empty);
  await page.routeWebSocket('**/api/ws', socket => socket.close());
  return page;
}
async function settle(page: Page) {
  await page.waitForFunction(() => !document.querySelector("#splash") && !!document.querySelector("h1"), { timeout: 15000 });
  await page.locator('main [aria-busy="true"]').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}
async function capture(page: Page, name: string, axe = true) {
  await settle(page);
  await page.screenshot({ path: resolve(out, 'screens', `${name}.png`), fullPage: true });
  const metrics = await page.evaluate(() => {
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
    const el = [...document.querySelectorAll('button,input,textarea,[role=tab],[role=combobox]')].filter(visible);
    return { viewport: { w: innerWidth, h: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      headings: [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e => ({ text: e.textContent, level: e.tagName, font: getComputedStyle(e).fontSize })),
      controls: el.map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName, name: e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 75) || e.getAttribute('placeholder'), role: e.getAttribute('role'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), font: getComputedStyle(e).fontSize }; }),
      smallText: [...document.querySelectorAll('main span,main p,main td,dialog span,dialog p')].filter(e => visible(e) && e.childElementCount === 0 && !!e.textContent?.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).slice(0, 30).map(e => ({ text: e.textContent?.slice(0, 85), font: getComputedStyle(e).fontSize })),
    };
  });
  let violations: any[] = [];
  if (axe) { try { const scan = await new AxeBuilder({ page }).exclude('[aria-disabled=true]').analyze(); violations = scan.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary, html: n.html.slice(0, 700) })) })); } catch (error) { violations = [{ error: String(error) }]; } }
  results.push({ name, path: new URL(page.url()).pathname, ...metrics, violations });
  console.log(JSON.stringify({ name, width: metrics.documentWidth, controls: metrics.controls.length, violations: violations.map(v => `${v.id}:${v.nodes?.length}`) }));
  await writeFile(resolve(out, 'observations.json'), JSON.stringify(results, null, 2));
}

try {
  if (!followup) {
  for (const theme of ['light', 'dark']) {
    const page = await newPage(theme);
    for (const [name, path] of [['home', '/'], ['board', '/p/CORP/board'], ['list', '/p/CORP/list'], ['calendar', '/p/CORP/calendar'], ['timeline', '/p/CORP/timeline'], ['settings', '/settings/appearance'], ['inbox', '/inbox']] as const) {
      await page.goto(base + path); await page.waitForTimeout(900); await capture(page, `${name}-${theme}`);
    }
    await page.goto(base + '/p/CORP/board'); await page.locator('article[data-issue-id]').first().waitFor();
    await page.locator('article[data-issue-id]').first().click(); await page.locator('dialog[open]').waitFor(); await capture(page, `issue-${theme}`);
    await page.keyboard.press('Escape');
    const create = page.getByRole('button', { name: 'Создать задачу', exact: true });
    await create.click(); await page.locator('dialog[open]').waitFor(); await capture(page, `create-${theme}`);
    if (process.env.AUDIT_OUTPUT_DIR) {
      await page.getByText('Дополнительные поля', { exact: true }).click();
      await capture(page, `create-expanded-${theme}`);
    }
    const input = page.locator('dialog[open] input').first();
    await input.fill('Черновик для проверки закрытия формы');
    await page.keyboard.press('Escape');
    await create.click(); await page.locator('dialog[open]').waitFor();
    results.push({ name: `create-draft-escape-${theme}`, initial: 'Черновик для проверки закрытия формы', reopened: await page.locator('dialog[open] input').first().inputValue() });
    await page.close();
  }
  for (const width of [390, 320]) {
    const page = await newPage('light', width, 844);
    for (const [name, path] of [['home', '/'], ['board', '/p/CORP/board'], ['list', '/p/CORP/list']] as const) {
      await page.goto(base + path); await page.waitForTimeout(900); await capture(page, `${name}-${width}`);
    }
    await page.locator('main').click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.close();
  }
  const empty = await newPage('light', 1440, 900, true);
  await empty.goto(base + '/'); await empty.waitForTimeout(900); await capture(empty, 'home-empty'); await empty.close();
  const compact = await newPage('light', 1440, 900, false, 'compact');
  await compact.goto(base + '/p/CORP/list'); await compact.waitForTimeout(900); await capture(compact, 'list-compact'); await compact.close();
  if (!production) {
    const ds = await newPage();
    await ds.goto(base + '/dev/ui?section=combobox'); await capture(ds, 'ds-combobox', false); await ds.close();
  }
  } else if (probe) {
    const layoutPage = await newPage();
    await layoutPage.goto(base + '/p/CORP/list');
    await layoutPage.locator('[role=row][data-issue-id]').first().waitFor();
    for (const width of [1440, 1280, 1065, 768, 720, 390, 320]) {
      await layoutPage.setViewportSize({ width, height: 900 }); await settle(layoutPage);
      const layout = await layoutPage.locator('[role=table]').evaluate(table => {
        const row = table.querySelector('[role=row][data-issue-id]')!;
        const rect = table.getBoundingClientRect();
        return { tableRight: rect.right, tableWidth: rect.width, overflow: getComputedStyle(table).overflowX,
          cells: [...row.children].map(e => { const r = e.getBoundingClientRect(); return { column: e.getAttribute('data-col'), text: e.textContent?.trim().slice(0, 60), x: r.x, right: r.right, width: r.width, outside: r.right > rect.right + 1 }; }) };
      });
      results.push({ name: `table-geometry-${width}`, viewport: width, ...layout });
    }
    await layoutPage.setViewportSize({ width: 1440, height: 900 });
    for (const density of ['comfortable', 'compact']) {
      await layoutPage.evaluate(d => document.documentElement.setAttribute('data-density', d), density);
      results.push({ name: `list-row-height-${density}`, height: await layoutPage.locator('[role=row][data-issue-id]').first().evaluate(e => e.getBoundingClientRect().height) });
    }
    await layoutPage.close();
    if (!process.env.AUDIT_OUTPUT_DIR) {
    // Visual hypotheses only: browser-local CSS, no product source changes.
    const conceptCss = `
      body { background: #f2f3f6 !important; }
      body::before, body::after { display: none !important; }
      .glass-side { background: #f5f6f8 !important; box-shadow: none !important; border: 1px solid #e2e4e9; }
      .glass-sheet { background: #fafbfc !important; box-shadow: none !important; border: 1px solid #e2e4e9; }
      .project-topbar { background: #fff !important; }
      .board-card { border-radius: 12px !important; box-shadow: none !important; border: 1px solid #e0e2e8; }
      .board-col-body { background: #f1f2f5 !important; }
      .board-card .meta-pill { box-shadow: none !important; background: transparent !important; font-size: 12px; }
      .board-card .meta-pill.is-late { background: #fff0f1 !important; }
      .board-view .hint-line { display: none !important; }
      .ds-btn[data-variant=primary] { box-shadow: none !important; }
    `;
    const concept = await newPage();
    await concept.goto(base + '/p/CORP/board'); await concept.locator('article[data-issue-id]').first().waitFor();
    await concept.addStyleTag({ content: conceptCss });
    await capture(concept, 'concept-board', false);
    await concept.goto(base + '/p/CORP/list'); await concept.locator('[role=row][data-issue-id]').first().waitFor();
    await concept.addStyleTag({ content: conceptCss + `
      .list-grid { grid-template-columns: 24px 68px minmax(300px,1fr) 88px 124px 64px 32px !important; }
      .list-grid > [data-col=direction], .list-grid > [data-col=labels] { display: none !important; }
      .list-grid { gap: 12px !important; }
      .list-head { font-size: 12px !important; }
      .list-grid[role=row][data-issue-id] { height: 48px !important; }
      .list-grid [role=cell]:not([data-col]) { font-size: 14px !important; }
      .hint-line { display: none !important; }
    ` });
    await capture(concept, 'concept-list', false);
    await concept.close();
    }
  } else {
    // Check asynchronous selection in the actual component gallery.
    if (!production) {
    const combo = await newPage();
    await combo.goto(base + '/dev/ui?section=combobox');
    const field = combo.getByRole('combobox');
    await field.focus();
    await combo.getByRole('option').first().waitFor();
    const oldOption = await combo.getByRole('option').first().innerText();
    await field.fill('Игорь');
    await combo.keyboard.press('Enter');
    const picked = await field.inputValue();
    results.push({ name: 'combobox-pending-enter', query: 'Игорь', previousFirstOption: oldOption, valueAfterEnter: picked, wrongSelection: picked !== 'Игорь Петров' });
    await capture(combo, 'combobox-pending-enter', false);
    await combo.close();
    }

    const mobile = await newPage('light', 320, 844);
    await mobile.goto(base + '/p/CORP/list');
    await mobile.locator('[role=row][data-issue-id]').first().waitFor();
    await settle(mobile);
    const row = mobile.locator('[role=row][data-issue-id]').first();
    const rowEvidence = await row.evaluate(e => {
      const r = e.getBoundingClientRect();
      const nodes = [...e.querySelectorAll('button,a,input,[tabindex]')];
      const children = nodes.map(n => { const b = n.getBoundingClientRect(); return { tag: n.tagName, name: n.getAttribute('aria-label') || n.textContent, width: b.width, height: b.height, tabindex: (n as HTMLElement).tabIndex, display: getComputedStyle(n).display }; });
      return { title: e.textContent, rowTabindex: (e as HTMLElement).tabIndex, rowY: r.y, controls: children };
    });
    const titleCell = await row.locator('[role=cell]').filter({ hasText: titles[0] }).last().boundingBox();
    await mobile.locator('h1').first().click();
    const focusOrder: any[] = [];
    for (let i = 0; i < 42; i++) {
      await mobile.keyboard.press('Tab');
      focusOrder.push(await mobile.evaluate(() => ({ tag: document.activeElement?.tagName, name: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 80), row: document.activeElement?.closest('[data-issue-id]')?.getAttribute('data-issue-id') })));
    }
    results.push({ name: 'mobile-list-keyboard', ...rowEvidence, titleCell, focusOrder });
    await mobile.close();

    // Measure the default title allocation and metadata density.
    const desktop = await newPage();
    await desktop.goto(base + '/p/CORP/list');
    await desktop.locator('[role=row][data-issue-id]').first().waitFor();
    const widths = await desktop.locator('[role=row][data-issue-id]').first().evaluate(e => ({ row: e.getBoundingClientRect().width, cells: [...e.children].map(c => ({ width: c.getBoundingClientRect().width, text: c.textContent?.trim().slice(0, 70), column: c.getAttribute('data-col') })), height: e.getBoundingClientRect().height }));
    results.push({ name: 'list-width-allocation', ...widths });
    await desktop.goto(base + '/p/CORP/board');
    await desktop.locator('article[data-issue-id]').first().waitFor();
    if (await desktop.locator('.workspace-filters > summary').count()) await desktop.locator('.workspace-filters > summary').click();
    await desktop.getByRole('button', { name: 'Мои задачи', exact: true }).last().click();
    await desktop.waitForTimeout(500);
    const filteredCards = await desktop.locator('article[data-issue-id]').count();
    await desktop.getByRole(process.env.AUDIT_OUTPUT_DIR ? 'link' : 'tab', { name: 'Список', exact: true }).click();
    await desktop.locator('[role=row][data-issue-id]').first().waitFor();
    results.push({ name: 'board-list-filter-continuity', boardCardsAfterMine: filteredCards, listRowsAfterSwitch: await desktop.locator('[role=row][data-issue-id]').count(), listUrl: desktop.url() });
    await desktop.close();

    // Error state against an intentionally failing synthetic read.
    const errorPage = await newPage();
    await errorPage.route('**/api/projects/p1/issues?*', r => r.fulfill({ status: 503, json: { error: 'Сервис временно недоступен. Повторите попытку.' } }));
    await errorPage.goto(base + '/p/CORP/list');
    await errorPage.waitForTimeout(1000);
    await capture(errorPage, 'list-error');
    await errorPage.close();
    // Narrow task panel, larger CSS viewport equivalent to 200% reflow, reports and roadmap.
    for (const [name, width, path] of [['list-720', 720, '/p/CORP/list'], ['board-720', 720, '/p/CORP/board'], ['reports-light', 1440, '/reports'], ['roadmap-light', 1440, '/roadmap']] as const) {
      const p = await newPage('light', width);
      await p.goto(base + path); await p.waitForTimeout(900); await capture(p, name); await p.close();
    }
    const issueMobile = await newPage('light', 390, 844);
    await issueMobile.goto(base + '/p/CORP/board');
    await issueMobile.locator('article[data-issue-id]').first().waitFor();
    await issueMobile.locator('article[data-issue-id]').first().click();
    await issueMobile.locator('dialog[open]').waitFor();
    await capture(issueMobile, 'issue-390');
    if (process.env.AUDIT_OUTPUT_DIR) {
      await issueMobile.keyboard.press('Escape');
      await issueMobile.getByRole('button', { name: 'Создать задачу', exact: true }).click();
      await issueMobile.locator('dialog[open]').waitFor();
      await capture(issueMobile, 'create-390');
    }
    await issueMobile.close();
  }
} finally {
  await writeFile(resolve(out, 'observations.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
