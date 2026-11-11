import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type WebSocketRoute,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function json(
  request: APIRequestContext,
  method: string,
  url: string,
  data?: object,
) {
  const res = await request.fetch(url, { method, data });
  expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
  return res.json();
}
const examples = [
  {
    name: "Проверка системы",
    object: "Корпоративный портал",
    doc: "Инструкция проверки портала",
    task: "Отключить устаревший протокол",
    steps: ["Проверить систему", "Устранить замечания", "Повторная проверка"],
  },
  {
    name: "Подготовка регламента",
    object: "Управление доступом",
    doc: "Регламент предоставления доступа",
    task: "Обновить настройки",
    steps: [
      "Подготовить регламент",
      "Внедрить регламент",
      "Подтвердить внедрение",
    ],
  },
  {
    name: "Запуск сервиса",
    object: "Новый внутренний сервис",
    doc: "Требования к сервису",
    task: "Настроить резервное копирование",
    steps: [
      "Подготовить инфраструктуру",
      "Настроить сервис",
      "Подтвердить готовность",
    ],
  },
];

test("unsaved document survives SPA navigation while collaboration is disconnected", async ({ page }) => {
  let offline = false;
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/documents\/[^/]+\/collaboration/, (socket) => {
    if (offline) { void socket.close({ code: 1013 }); return; }
    sockets.push(socket, socket.connectToServer());
  });
  await json(page.request, "POST", "/api/auth/login", { username: "admin", password: "password123" });
  const projects = await json(page.request, "GET", "/api/projects");
  const project = projects.find((p: { key: string }) => p.key === "CORP");
  const root = `/api/projects/${project.id}`;
  const first = await json(page.request, "POST", `${root}/documents`, { title: "Offline draft" });
  const second = await json(page.request, "POST", `${root}/documents`, { title: "Other document" });
  await page.goto(`/p/CORP/documents?document=${first.id}`);
  const editor = page.locator(".tiptap[contenteditable=true]");
  await expect(editor).toBeVisible();
  await expect(page.getByText("Сохранено на сервере", { exact: true })).toBeVisible();
  offline = true;
  await Promise.all(sockets.map((socket) => socket.close({ code: 1012 })));
  await expect(page.getByText("Связь потеряна. Правки остаются в этой вкладке.", { exact: true })).toBeVisible();
  await editor.click(); await page.keyboard.type("Pending text retained through navigation");
  await page.getByRole("button", { name: "Other document", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(second.id));
  await page.getByRole("button", { name: "Offline draft", exact: true }).click();
  await expect(editor).toContainText("Pending text retained through navigation");
  await page.getByRole("link", { name: "Доска", exact: true }).click();
  await page.getByRole("link", { name: "Документы", exact: true }).click();
  await page.getByRole("button", { name: "Offline draft", exact: true }).click();
  await expect(editor).toContainText("Pending text retained through navigation");
  offline = false;
  await expect(page.getByText("Сохранено на сервере", { exact: true })).toBeVisible({ timeout: 45000 });
  await expect.poll(async () => (await json(page.request, "GET", `${root}/documents/${first.id}`)).document.text)
    .toContain("Pending text retained through navigation");
  await page.reload();
  await expect(editor).toContainText("Pending text retained through navigation");
});
for (const example of examples)
  test(example.name, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as unknown as { cspErrors: string[] }).cspErrors = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        (window as unknown as { cspErrors: string[] }).cspErrors.push(
          `${e.violatedDirective}: ${e.blockedURI}`,
        ),
      );
    });
    await json(page.request, "POST", "/api/auth/login", {
      username: "admin",
      password: "password123",
    });
    const projects = await json(page.request, "GET", "/api/projects"),
      project = projects.find((p: { key: string }) => p.key === "CORP"),
      p = `/api/projects/${project.id}`;
    const me = await json(page.request, "GET", "/api/auth/me");
    await page.goto("/p/CORP/documents");
    await page
      .getByRole("button", { name: "Новый документ", exact: true })
      .click();
    const create = page.getByRole("dialog");
    await expect(create.getByLabel("Название", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(create).toHaveCount(0);
    await page
      .getByRole("button", { name: "Новый документ", exact: true })
      .press("Enter");
    await create.getByLabel("Название", { exact: true }).fill(example.doc);
    await create.getByRole("button", { name: "Создать", exact: true }).click();
    const editor = page.locator(".tiptap[contenteditable=true]");
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.keyboard.type(
      `${example.task}. Результат должен быть подтверждён.`,
    );
    await expect(
      page.getByText("Сохранено на сервере", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const docId = new URL(page.url()).searchParams.get("document")!;
    expect(docId).toBeTruthy();
    const d = await json(page.request, "GET", `${p}/documents/${docId}`);
    expect(d.document.text).toContain(example.task);
    await editor.evaluate((node) => {
      const p = node.querySelector("p")!;
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page
      .getByRole("button", { name: "Создать задачу из текста", exact: true })
      .click();
    const createdTaskResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/documents/${docId}/issues`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Создать", exact: true })
      .click();
    const taskResponse = await createdTaskResponse;
    expect(taskResponse.ok(), await taskResponse.text()).toBe(true);
    const sourceTask = await taskResponse.json();
    await page.goto(`/p/CORP/documents?document=${docId}`);
    await expect(editor).toBeVisible();
    await expect(editor.locator("[data-taskira-issue]")).toContainText(
      sourceTask.key,
    );
    await expect(
      page.getByText("Сохранено на сервере", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("document-light.png"),
      fullPage: true,
      animations: "disabled",
    });
    // Tables must work under the existing style-src-attr 'none' policy.
    await page.getByRole("button", { name: "Таблица", exact: true }).click();
    await expect(editor.locator("table")).toBeVisible();
    await page
      .getByLabel("Комментарий", { exact: true })
      .fill("Проверьте порядок подтверждения результата");
    await page
      .getByRole("button", { name: "Добавить комментарий", exact: true })
      .click();
    await expect(
      page.getByText("Проверьте порядок подтверждения результата", {
        exact: true,
      }),
    ).toBeVisible();
    const version = await json(
      page.request,
      "POST",
      `${p}/documents/${docId}/versions`,
      { name: "Согласованная редакция" },
    );
    await json(page.request, "POST", `${p}/documents/${docId}/verify`, {
      versionId: version.id,
      validUntil: "2027-02-10",
    });
    const type = await json(page.request, "POST", `${p}/object-types`, {
      name: `Системы · ${example.name}`,
      fields: [{ key: "address", name: "Адрес", type: "text" }],
    });
    const object = await json(page.request, "POST", `${p}/objects`, {
      typeId: type.id,
      title: example.object,
      ownerId: me.id,
      values: { address: "portal.corp.local" },
    });
    await json(page.request, "POST", `${p}/entity-links`, {
      source: { kind: "object", id: object.id },
      target: { kind: "document", id: docId },
    });
    const template = await json(
      page.request,
      "POST",
      `${p}/process-templates`,
      {
        name: example.name,
        steps: example.steps.map((title, i) => ({
          key: `step${i}`,
          title,
          dependsOn: i ? [`step${i - 1}`] : [],
          complexity: "medium",
          reviewerId: i === 2 ? me.id : null,
          documentVersionId: version.id,
        })),
      },
    );
    await json(
      page.request,
      "POST",
      `${p}/process-templates/${template.id}/publish`,
      {},
    );
    await page.goto("/p/CORP/processes");
    const card = page
      .locator("section.workspace-section")
      .filter({ hasText: example.name });
    // The catalogue provides a single explicit start action for each template.
    await card.getByRole("button", { name: "Запустить", exact: true }).click();
    const start = page.getByRole("dialog");
    await expect(
      start.getByText(example.steps[0], { exact: false }),
    ).toBeVisible();
    await start.getByRole("button", { name: "Запустить", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: example.name, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/run=/);
    const runId = new URL(page.url()).searchParams.get("run")!;
    expect(runId).toBeTruthy();
    let run = await json(page.request, "GET", `${p}/process-runs/${runId}`);
    expect(
      run.steps.filter((s: { issueId: string | null }) => s.issueId),
    ).toHaveLength(1);
    const work = await json(page.request, "GET", `${p}/plans/work-items`);
    const plan = await json(page.request, "POST", `${p}/plans`, {
      name: `План · ${example.name}`,
      items: work.items
        .filter((i: { id: string }) =>
          run.steps.some(
            (s: { id: string; issueId: string | null }) =>
              i.id === (s.issueId || s.id),
          ),
        )
        .map(
          ({
            kind,
            id,
            title,
            complexity,
            dependsOn,
          }: {
            kind: string;
            id: string;
            title: string;
            complexity: string | null;
            dependsOn: string[];
          }) => ({ kind, id, title, complexity, dependsOn }),
        ),
    });
    const prediction = await json(
      page.request,
      "GET",
      `${p}/plans/${plan.id}/forecast`,
    );
    expect(prediction.sufficientHistory).toBe(false);
    expect(prediction.medianWeek).toBeNull();
    await json(page.request, "POST", `${p}/plans`, {
      planId: plan.id,
      name: "Со срочной работой",
      items: plan.items,
    });
    const bootstrap = await json(page.request, "GET", p),
      done = bootstrap.workflow.statuses.find(
        (s: { category: string }) => s.category === "done",
      );
    for (let i = 0; i < 3; i++) {
      await json(
        page.request,
        "POST",
        `${p}/issues/${run.steps[i].issueId}/transition`,
        { to: done.id },
      );
      await expect
        .poll(
          async () => {
            run = await json(page.request, "GET", `${p}/process-runs/${runId}`);
            return run.steps[i].state;
          },
          { timeout: 10000 },
        )
        .toBe(i === 2 ? "review" : "completed");
    }
    await json(page.request, "POST", `${p}/process-runs/${runId}/review`, {
      reviewRevision: 0,
      stepId: run.steps[2].id,
      action: "approve",
    });
    await page.reload();
    await expect(
      page.getByText("Завершён", { exact: true }).first(),
    ).toBeVisible();
    await page.goto(`/p/CORP/objects?object=${object.id}`);
    await expect(
      page.getByRole("heading", { name: example.object, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Связи", exact: true }).click();
    await expect(
      page.getByRole("button", { name: example.doc, exact: true }),
    ).toBeVisible();
    await page.goto(`/p/CORP/planning?plan=${plan.id}`);
    await expect(
      page
        .getByText("В плане нет незавершённой работы", { exact: false })
        .first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    await expect(
      page.getByRole("heading", { name: "Планирование", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText("В плане нет незавершённой работы", { exact: false })
        .first(),
    ).toBeVisible();
    await expect(page.locator("#splash")).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page })
      .include(".workspace-page")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("planning-dark-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    const workspaceWidth = await page
      .locator(".workspace-page")
      .evaluate((el) => ({
        client: el.clientWidth,
        scroll: el.scrollWidth,
        right: el.getBoundingClientRect().right,
      }));
    expect(workspaceWidth.scroll).toBeLessThanOrEqual(
      workspaceWidth.client + 1,
    );
    expect(workspaceWidth.right).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { cspErrors: string[] }).cspErrors,
      ),
    ).toEqual([]);
  });

test("standalone reference: all scenarios, themes, error states and keyboard", async ({
  page,
}) => {
  await page.goto("/workspace-reference");
  const next = page.getByRole("button", {
    name: "Следующий шаг →",
    exact: true,
  });
  await next.focus();
  await expect(next).toBeFocused();
  await next.press("Enter");
  for (const value of ["audit", "policy", "service"]) {
    await page.getByLabel("Сценарий").selectOption(value);
    for (let i = 0; i < 7; i++)
      await page
        .getByRole("button", { name: "Следующий шаг →", exact: true })
        .click();
  }
  await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
  await page.getByRole("button", { name: "Узкий экран", exact: true }).click();
  await page.getByLabel("Состояние", { exact: true }).selectOption("offline");
  await expect(
    page.getByText("Соединение потеряно.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Восстановить связь", exact: true })
    .click();
  await page.getByLabel("Состояние", { exact: true }).selectOption("error");
  await expect(page.getByRole("alert")).toContainText("ещё не сохранён");
  await page.getByLabel("Состояние", { exact: true }).selectOption("normal");
  await page
    .getByRole("button", { name: "Широкий экран", exact: true })
    .click();
  await page.getByRole("button", { name: "Файлы", exact: true }).click();
  await expect(page.locator("#filerows tr")).toHaveCount(3);
  await page
    .getByLabel("Поиск файлов", { exact: true })
    .fill("portal-check-results");
  await expect(page.locator("#filerows tr:visible")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать результат", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("portal-check-results.txt");
  const violations = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(violations.violations).toEqual([]);
});

test("manager enables modules through project settings; board keeps editor lazy", async ({
  page,
}) => {
  await json(page.request, "POST", "/api/auth/login", {
    username: "mgr1",
    password: "password123",
  });
  const projects = await json(page.request, "GET", "/api/projects"),
    project = projects.find((p: { key: string }) => p.key === "CORP"),
    path = `/api/projects/${project.id}/workspace/modules`;
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/p/CORP/board");
  await expect(page.locator("#splash")).toHaveCount(0);
  expect(requested.some((url) => /DocumentEditor-[^/]+\.js/.test(url))).toBe(
    false,
  );
  await json(page.request, "PATCH", path, {
    documents: false,
    objects: false,
    processes: false,
    planning: false,
  });
  await page.goto("/p/CORP/settings/modules");
  await expect(page.getByRole("switch", { name: /^Спринты/ })).toBeDisabled();
  const documents = page.getByRole("switch", { name: /^Документы/ });
  await documents.click();
  await expect
    .poll(async () => (await json(page.request, "GET", path)).documents)
    .toBe(true);
  await page.reload();
  await expect(documents).toHaveAttribute("aria-checked", "true");
  await json(page.request, "PATCH", path, {
    documents: true,
    objects: true,
    processes: true,
    planning: true,
  });
  await page.reload();
  const files = page.getByRole("switch", { name: /^Файлы/ });
  await files.click();
  await expect
    .poll(async () => (await json(page.request, "GET", path)).files)
    .toBe(false);
  await page.goto("/p/CORP/files");
  await expect(
    page.locator('.project-view-tabs a[href$="/files"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Файлы проекта", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Отключение «Файлов» скрывает общий каталог/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Настроить модули", exact: true })
    .click();
  await expect(page).toHaveURL(/settings\/modules$/);
  await files.click();
  await expect
    .poll(async () => (await json(page.request, "GET", path)).files)
    .toBe(true);
});

test("help explains every module and a real-life workflow in both languages", async ({
  page,
}, testInfo) => {
  await json(page.request, "POST", "/api/auth/login", {
    username: "admin",
    password: "password123",
  });
  await page.goto("/help#modules");
  await expect(page.locator("#doc-modules")).toBeInViewport();
  await expect(page.locator("#doc-modules tbody tr")).toHaveCount(6);
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  await expect(page.locator("#doc-documents")).toBeInViewport();
  await expect(page.locator("#doc-documents")).toContainText(
    "Сохранено на сервере",
  );
  await page
    .getByRole("button", { name: "Пример: проверка портала", exact: true })
    .click();
  await expect(page.locator("#doc-workspace-example")).toBeInViewport();
  await expect(page.locator("#doc-workspace-example")).toContainText("Анна");
  await page.evaluate(() => localStorage.setItem("taskira.lang", "en"));
  await page.goto("/help#files");
  await page.reload();
  await expect(page.locator("#doc-en-files")).toBeInViewport();
  await expect(page.locator("#doc-en-files")).toContainText(
    "Archived sources remain searchable",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("help-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("project files collect task and document attachments; Taskira controls work with keyboard", async ({
  page,
}, testInfo) => {
  await json(page.request, "POST", "/api/auth/login", {
    username: "admin",
    password: "password123",
  });
  const project = (await json(page.request, "GET", "/api/projects")).find(
    (p: { key: string }) => p.key === "CORP",
  );
  const base = `/api/projects/${project.id}`;
  const doc = await json(page.request, "POST", `${base}/documents`, {
    title: "Протокол · каталог файлов",
  });
  const issue = await json(page.request, "POST", `${base}/issues`, {
    title: "Проверка · каталог файлов",
    typeId: "task",
    priorityId: "medium",
    assigneeIds: [],
    epicId: null,
    complexity: null,
  });
  const upload = await page.request.post(
    `${base}/issues/${issue.id}/attachments`,
    {
      multipart: {
        file: {
          name: "task-evidence.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("task evidence"),
        },
      },
    },
  );
  expect(upload.ok(), await upload.text()).toBeTruthy();
  await page.goto(`/p/CORP/documents?document=${doc.id}`);
  await expect(page.locator(".tiptap")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Добавить файл", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "document-result.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("document result"),
  });
  await expect(
    page.getByRole("link", { name: "document-result.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(
      '.workspace-page input[type="file"]:visible, .workspace-page input[type="date"], .workspace-page select',
    ),
  ).toHaveCount(0);
  expect(
    await page
      .locator('.workspace-page input[type="checkbox"]')
      .evaluateAll((inputs) =>
        inputs.every((input) => input.closest(".ds-check")),
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "Версии", exact: true }).click();
  const date = page.getByRole("button", { name: /^Актуален до:/ });
  await date.press("Enter");
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(date).toBeFocused();
  await page.goto("/p/CORP/files");
  await expect(
    page.getByRole("heading", { name: "Файлы проекта", exact: true }),
  ).toBeVisible();
  const tabs = await page
    .locator(".project-view-tabs a")
    .evaluateAll((elements) =>
      elements.map((element) =>
        new URL((element as HTMLAnchorElement).href).pathname.split("/").pop(),
      ),
    );
  expect(tabs).toEqual([
    "overview",
    "board",
    "list",
    "timeline",
    "calendar",
    "documents",
    "objects",
    "processes",
    "planning",
    "files",
  ]);
  const rows = page.locator(".workspace-files-table tbody tr");
  await expect(rows).toHaveCount(2);
  const source = page.getByRole("combobox", {
    name: "Где используется",
    exact: true,
  });
  await source.press("Space");
  await source.press("ArrowDown");
  await source.press("Enter");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("task-evidence.txt");
  await source.press("Space");
  await source.press("Home");
  await source.press("Enter");
  await expect(rows).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать: document-result.txt", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("document-result.txt");
  await page.getByRole("button", { name: doc.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`documents\\?document=${doc.id}`));
  await expect(page.locator(".tiptap")).toBeVisible();
  await page.goto("/p/CORP/files");
  await page.reload();
  await expect(rows).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await expect(
    page.locator('.project-view-tabs [aria-current="page"]'),
  ).toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "Файлы проекта", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const a11y = await new AxeBuilder({ page })
    .include(".workspace-page")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("files-dark-mobile.png"),
    fullPage: true,
  });
});
