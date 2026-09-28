/**
 * Характеризационные тесты `IssueModal` (ТЗ 5.12 d): фиксируют текущее ПОВЕДЕНИЕ карточки
 * задачи ДО визуальной переработки (две колонки, инлайн-правка с мгновенным сохранением,
 * единая лента комментариев+истории с переключателем, j/k) — не разметку и не CSS-классы.
 * Элементы выбираются по role/label/тексту, никогда по className.
 *
 * Харнесс скопирован из src/issueModal.lookups.test.tsx: StoreProvider + bootstrap против
 * замоканного ./api, I18nProvider, Grab-компонент для чтения состояния стора (аналог "probe").
 * Источники поведения: src/store/issueCrud.ts (updateIssue, moveStatus), src/store/issueSub.ts
 * (addComment), src/store/session.ts (openIssue — грузит comments+activity вместе с карточкой),
 * src/issueNav.ts (neighborIssue читает `main [data-issue-id]` — в тестах, где это нужно,
 * рендерим фиктивный `<main>` рядом с карточкой).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreProvider, useStore, useToasts } from "./store";
import {
  authApi,
  commentsApi,
  departmentsApi,
  issuesApi,
  notificationsApi,
  projectsApi,
  type ProjectBootstrap,
  type ServerActivity,
  type ServerComment,
  type ServerIssue,
} from "./api";
import { I18nProvider } from "./i18n";
import IssueModal from "./components/IssueModal";

function useStoreSnapshot() {
  return { ...useStore(), toasts: useToasts() };
}

const user = {
  id: "u1",
  username: "u1",
  name: "Пользователь",
  initials: "П",
  color: "#0B5FD9",
  jobRole: "Тест",
  globalRole: "member" as const,
  isActive: true,
  authSource: "local" as const,
};
const project = {
  id: "p1",
  key: "A21",
  name: "Проект",
  description: "",
  departmentId: "d1",
  isShared: false,
  sprintsEnabled: false,
  defaultView: null,
  suggestedLabels: [],
  icon: null,
  color: null,
  background: null,
  backgroundPhoto: null,
  isDemo: false,
};

/** Три статуса и ровно один разрешённый переход (s1 → s2), s1 → s3 запрещён —
 *  нужно, чтобы пин №3 («только разрешённые переходы предлагаются») имел что проверять. */
function makeBoot(memberRole: "manager" | "viewer" = "manager"): ProjectBootstrap {
  return {
    project,
    users: [user as never],
    members: [{ userId: "u1", role: memberRole }],
    workflow: {
      statuses: [
        { id: "s1", sid: "todo", name: "К работе", category: "todo", position: 0 },
        { id: "s2", sid: "inprogress", name: "В работе", category: "inprogress", position: 1 },
        { id: "s3", sid: "done", name: "Готово", category: "done", position: 2 },
      ],
      transitions: [{ id: "t1", from: "s1", to: "s2" }],
    },
    issueTemplates: [],
    customFields: [],
    sprints: [],
  };
}

const dto = (id: string, over: Partial<ServerIssue> = {}): ServerIssue =>
  ({
    id,
    key: `A21-${id}`,
    title: `Задача ${id}`,
    description: "",
    typeId: "task",
    statusId: "s1",
    priorityId: "medium",
    assigneeIds: [],
    reporterId: "u1",
    epicId: null,
    parentId: null,
    labels: [],
    complexity: null,
    dueDate: null,
    rank: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
    archivedAt: null,
    ...over,
  }) as unknown as ServerIssue;

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () =>
  act(async () => {
    await flush();
    await flush();
    await flush();
    await flush();
  });

async function setup(opts: {
  listed: ServerIssue[];
  get: (id: string) => ServerIssue;
  memberRole?: "manager" | "viewer";
  mode?: "panel" | "page";
  withMain?: boolean;
  comments?: ServerComment[];
  activity?: ServerActivity[];
}) {
  const { listed, get, memberRole = "manager", mode = "panel", withMain = false, comments = [], activity = [] } = opts;

  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(makeBoot(memberRole));
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: listed, hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
  vi.spyOn(commentsApi, "list").mockResolvedValue(comments);
  vi.spyOn(issuesApi, "activity").mockResolvedValue(activity);
  // SubtasksField (правая панель) всегда запрашивает детей по parentId — не относится
  // к тому, что здесь пиннуется, но без мока запрос падает и засоряет вывод теста.
  vi.spyOn(issuesApi, "page").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  const getSpy = vi.spyOn(issuesApi, "get").mockImplementation(async (_p, id) => get(id) as never);

  let store!: ReturnType<typeof useStoreSnapshot>;
  function Grab() {
    store = useStoreSnapshot();
    return null;
  }

  const ui = render(
    <I18nProvider>
      <StoreProvider>
        <Grab />
        {withMain && (
          <main>
            {listed.map((i) => (
              <div key={i.id} data-issue-id={i.id} />
            ))}
          </main>
        )}
        <IssueModal mode={mode} />
      </StoreProvider>
    </I18nProvider>,
  );
  await act(async () => {
    await store.bootstrap();
  });
  return { store: () => store, get: getSpy, ui };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("IssueModal — характеризационные тесты (ТЗ 5.12 d, до переработки)", () => {
  test("открытие задачи грузит комментарии и историю (по projectId+issueId) и показывает заголовок и описание", async () => {
    const comment: ServerComment = {
      id: "c1",
      issueId: "i1",
      authorId: "u1",
      author: { id: "u1", name: user.name, initials: user.initials, color: user.color },
      body: "Существующий комментарий",
      createdAt: new Date().toISOString(),
    };
    const activityRow: ServerActivity = {
      id: "a1",
      actorId: "u1",
      actor: { id: "u1", name: user.name, initials: user.initials, color: user.color },
      text: "создал(а) задачу",
      createdAt: new Date().toISOString(),
    };
    const h = await setup({
      listed: [dto("i1", { title: "Открытая задача", description: "Описание тестовое" })],
      get: (id) => dto(id, { title: "Открытая задача", description: "Описание тестовое" }),
      comments: [comment],
      activity: [activityRow],
    });
    const commentsList = vi.mocked(commentsApi.list);
    const activityList = vi.mocked(issuesApi.activity);

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    expect(commentsList).toHaveBeenCalledWith("p1", "i1");
    expect(activityList).toHaveBeenCalledWith("p1", "i1");
    expect(screen.getByText("Открытая задача")).toBeTruthy();
    expect(screen.getByText("Описание тестовое")).toBeTruthy();
    // По умолчанию лента «Всё» — уже загруженный комментарий виден без переключения.
    expect(screen.getByText("Существующий комментарий")).toBeTruthy();
    h.ui.unmount();
  });

  test("инлайн-правка заголовка (blur/Enter) вызывает patch с { title } и показывает новое значение", async () => {
    const base = dto("i1", { title: "Старый заголовок" });
    const h = await setup({ listed: [base], get: (id) => dto(id, { title: "Старый заголовок" }) });
    const patch = vi.spyOn(issuesApi, "patch").mockImplementation(async (_p, id, body) => ({ ...base, ...body }) as ServerIssue);

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    const renameBtn = screen.getByRole("button", { name: "Переименовать задачу: Старый заголовок" });
    fireEvent.click(renameBtn);
    const textarea = screen.getByDisplayValue("Старый заголовок") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Новый заголовок" } });
    fireEvent.blur(textarea);
    await settle();

    expect(patch).toHaveBeenCalledWith("p1", "i1", { title: "Новый заголовок" });
    expect(screen.getByRole("button", { name: "Переименовать задачу: Новый заголовок" })).toBeTruthy();
    h.ui.unmount();
  });

  test("описание сохраняется сразу при выходе из поля; Esc — отмена без запроса (ТЗ 5.12 d)", async () => {
    const base = dto("i1", { description: "Было" });
    const h = await setup({ listed: [base], get: (id) => dto(id, { description: "Было" }) });
    const patch = vi.spyOn(issuesApi, "patch").mockImplementation(async (_p, _id, body) => ({ ...base, ...body }) as ServerIssue);
    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    fireEvent.click(screen.getByText("Было"));
    let area = screen.getByDisplayValue("Было") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "Отменённое" } });
    fireEvent.keyDown(area, { key: "Escape" });
    await settle();
    expect(patch).not.toHaveBeenCalled();
    expect(h.store().ui.selectedIssueId).toBe("i1"); // Esc в поле не закрывает задачу

    fireEvent.click(screen.getByText("Было"));
    area = screen.getByDisplayValue("Было") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "Стало" } });
    fireEvent.blur(area);
    await settle();
    expect(patch).toHaveBeenCalledWith("p1", "i1", { description: "Стало" });
    h.ui.unmount();
  });

  test("смена статуса вызывает transition с id целевого статуса; запрещённый переход недоступен для клика", async () => {
    const base = dto("i1", { statusId: "s1" });
    const h = await setup({ listed: [base], get: (id) => dto(id, { statusId: "s1" }) });
    const transition = vi
      .spyOn(issuesApi, "transition")
      .mockImplementation(async (_p, id, to) => ({ ...base, statusId: to as string }) as ServerIssue);

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /К выполнению/ }));
    // «Готово» — переход s1→s3 не в списке transitions, пункт задизейблен.
    const forbidden = screen.getByRole("button", { name: /Готово/ });
    expect((forbidden as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(forbidden);
    expect(transition).not.toHaveBeenCalled();

    // «В работе» — s1→s2 разрешён.
    fireEvent.click(screen.getByRole("button", { name: /В работе/ }));
    await settle();

    expect(transition).toHaveBeenCalledWith("p1", "i1", "s2", null);
    h.ui.unmount();
  });

  test("смена приоритета вызывает patch с { priorityId }", async () => {
    const base = dto("i1", { priorityId: "medium" });
    const h = await setup({ listed: [base], get: (id) => dto(id, { priorityId: "medium" }) });
    const patch = vi.spyOn(issuesApi, "patch").mockImplementation(async (_p, id, body) => ({ ...base, ...body }) as ServerIssue);

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /Средний/ }));
    fireEvent.click(screen.getByRole("button", { name: /Высокий/ }));
    await settle();

    expect(patch).toHaveBeenCalledWith("p1", "i1", { priorityId: "high" });
    h.ui.unmount();
  });

  test("смена срока вызывает patch с { dueDate }", async () => {
    const base = dto("i1", { dueDate: null });
    const h = await setup({ listed: [base], get: (id) => dto(id, { dueDate: null }) });
    const patch = vi.spyOn(issuesApi, "patch").mockImplementation(async (_p, id, body) => ({ ...base, ...body }) as ServerIssue);

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    fireEvent.change(dateInput, { target: { value: "2026-10-01" } });
    await settle();

    expect(patch).toHaveBeenCalledWith("p1", "i1", { dueDate: "2026-10-01" });
    h.ui.unmount();
  });

  test("добавление комментария вызывает commentsApi.create с текстом и комментарий появляется; пустой комментарий не отправляется", async () => {
    const h = await setup({ listed: [dto("i1")], get: (id) => dto(id) });
    const create = vi.spyOn(commentsApi, "create").mockResolvedValue({
      id: "c-new",
      issueId: "i1",
      authorId: "u1",
      author: { id: "u1", name: user.name, initials: user.initials, color: user.color },
      body: "Привет команда",
      createdAt: new Date().toISOString(),
    });

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    const sendBtn = screen.getByRole("button", { name: /Отправить/ });
    // Пустой комментарий: кнопка недоступна, запрос не уходит.
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sendBtn);
    expect(create).not.toHaveBeenCalled();

    const textarea = screen.getByPlaceholderText("Добавить комментарий… (Ctrl+Enter — отправить)");
    fireEvent.change(textarea, { target: { value: "Привет команда" } });
    fireEvent.click(screen.getByRole("button", { name: /Отправить/ }));
    await settle();

    expect(create).toHaveBeenCalledWith("p1", "i1", "Привет команда");
    expect(screen.getByText("Привет команда")).toBeTruthy();
    h.ui.unmount();
  });

  test("комментарии и история — одна лента (ТЗ 5.12 d): «Всё» по умолчанию, переключатель сужает до комментариев или истории", async () => {
    const comment: ServerComment = {
      id: "c1",
      issueId: "i1",
      authorId: "u1",
      author: { id: "u1", name: user.name, initials: user.initials, color: user.color },
      body: "Видимый комментарий",
      createdAt: new Date().toISOString(),
    };
    const activityRow: ServerActivity = {
      id: "a1",
      actorId: "u1",
      actor: { id: "u1", name: user.name, initials: user.initials, color: user.color },
      text: "переименовал(а) задачу",
      createdAt: new Date().toISOString(),
    };
    const h = await setup({ listed: [dto("i1")], get: (id) => dto(id), comments: [comment], activity: [activityRow] });

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    // Намеренное изменение ТЗ 5.12 d: по умолчанию «Всё» — и комментарий, и событие в одной ленте.
    expect(screen.getByText("Видимый комментарий")).toBeTruthy();
    expect(screen.getByText(/переименовал\(а\) задачу/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Комментарии/ }));
    expect(screen.getByText("Видимый комментарий")).toBeTruthy();
    expect(screen.queryByText("переименовал(а) задачу", { exact: false })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /История/ }));

    expect(screen.queryByText("Видимый комментарий")).toBeNull();
    expect(screen.getByText(/переименовал\(а\) задачу/)).toBeTruthy();
    h.ui.unmount();
  });

  test("read-only (роль viewer): элементы редактирования недоступны, показан бейдж «Только чтение»", async () => {
    const h = await setup({
      listed: [dto("i1", { title: "Задача только для чтения", priorityId: "medium" })],
      get: (id) => dto(id, { title: "Задача только для чтения", priorityId: "medium" }),
      memberRole: "viewer",
    });

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    expect(screen.getByText("Только чтение")).toBeTruthy();
    // Заголовок не кликабелен для переименования.
    expect(screen.queryByRole("button", { name: /Переименовать задачу/ })).toBeNull();
    // Нет поля выбора даты (LockedField вместо <input type="date">).
    expect(document.querySelector('input[type="date"]')).toBeNull();
    // Приоритет показан текстом, но не как интерактивная кнопка-дропдаун.
    expect(screen.getByText("Средний")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Средний/ })).toBeNull();
    // Комментировать нельзя: вместо поля ввода — сообщение об отказе.
    expect(screen.queryByPlaceholderText("Добавить комментарий… (Ctrl+Enter — отправить)")).toBeNull();
    expect(screen.getByText("Ваша роль не позволяет оставлять комментарии")).toBeTruthy();
    h.ui.unmount();
  });

  test("закрытие крестиком сбрасывает ui.selectedIssueId в null", async () => {
    const h = await setup({ listed: [dto("i1")], get: (id) => dto(id) });
    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();
    expect(h.store().ui.selectedIssueId).toBe("i1");

    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));

    expect(h.store().ui.selectedIssueId).toBeNull();
    h.ui.unmount();
  });

  test("Esc сбрасывает ui.selectedIssueId в null (панельный режим — карточка внутри <Modal>)", async () => {
    const h = await setup({ listed: [dto("i1")], get: (id) => dto(id) });
    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();
    expect(h.store().ui.selectedIssueId).toBe("i1");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(h.store().ui.selectedIssueId).toBeNull();
    h.ui.unmount();
  });

  test("панельный режим: кнопка «следующая» переключает на соседнюю задачу по DOM-порядку представления", async () => {
    const h = await setup({
      listed: [dto("i1", { title: "Первая" }), dto("i2", { title: "Вторая" })],
      get: (id) => (id === "i1" ? dto("i1", { title: "Первая" }) : dto("i2", { title: "Вторая" })),
      withMain: true,
    });

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    const prevBtn = screen.getByRole("button", { name: "Предыдущая задача" });
    const nextBtn = screen.getByRole("button", { name: "Следующая задача" });
    // i1 — первый элемент фиктивного <main>: нет предыдущей, есть следующая.
    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(nextBtn);
    await settle();

    expect(h.store().ui.selectedIssueId).toBe("i2");
    expect(screen.getByText("Вторая")).toBeTruthy();
    h.ui.unmount();
  });

  test("полностраничный режим (mode=\"page\") не показывает кнопки «следующая»/«предыдущая»", async () => {
    const h = await setup({
      listed: [dto("i1", { title: "Первая" }), dto("i2", { title: "Вторая" })],
      get: (id) => (id === "i1" ? dto("i1", { title: "Первая" }) : dto("i2", { title: "Вторая" })),
      withMain: true,
      mode: "page",
    });

    await act(async () => {
      h.store().openIssue("i1");
    });
    await settle();

    expect(screen.getByText("Первая")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Предыдущая задача" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Следующая задача" })).toBeNull();
    h.ui.unmount();
  });
});
