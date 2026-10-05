import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WebhookDto, WebhookDeliveryDto, WebhookDeliveryDetailDto } from "../../../server/src/contract";
import { I18nProvider, loadLang, useT } from "../../i18n";
import en from "../../i18n/en";
import { allowedSections } from "../../settings/access";
import { ApiError, integrationsApi, webhooksApi } from "../../api";

const { toast,openIssue,switchProject } = vi.hoisted(() => ({ toast: vi.fn(),openIssue: vi.fn(),switchProject: vi.fn() }));
vi.mock("../../store",() => ({ useStore: () => ({ toast,openIssue,switchProject,
  data: { currentProjectId: "p1",project: { key: "TEST" },projects: [{ id: "p1",key: "TEST" }] } }) }));
vi.mock("../../api",async importOriginal => ({ ...await importOriginal<typeof import("../../api")>(),
  integrationsApi: { config: vi.fn() },webhooksApi: {
    list: vi.fn(),create: vi.fn(),update: vi.fn(),remove: vi.fn(),rotateSecret: vi.fn(),ping: vi.fn(),
    deliveries: vi.fn(),delivery: vi.fn(),redeliver: vi.fn(),redeliverFailed: vi.fn(),
  },
}));
import ProjectIntegrations from "./ProjectIntegrations";
import WebhookDeliveries from "./WebhookDeliveries";
import { SecretOnceDialog } from "./SecretOnceDialog";

const hook: WebhookDto = { id: "h1",projectId: "p1",name: "CRM",urlDisplay: "https://crm.example/hook",
  events: ["issue.created"],state: "active",disabledReason: null,failureStreak: 0,lastSuccessAt: null,lastFailureAt: null,
  secretRotatedUntil: null,createdAt: "2026-10-04T12:00:00Z",updatedAt: "2026-10-04T12:00:00Z" };
const delivery: WebhookDeliveryDto = { id: "d1",eventId: "event1",eventType: "issue.created",issueKey: "TEST-1",state: "failed",
  attempts: 8,nextAttemptAt: "2026-10-04T12:00:00Z",lastStatus: 503,lastError: "http_status",lastDurationMs: 40,manual: false,
  createdAt: "2026-10-04T12:00:00Z",updatedAt: "2026-10-04T12:00:00Z" };
const secret = "whsec_test_fixture_only";
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator,"clipboard");
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(integrationsApi.config).mockResolvedValue({ webhooksEnabled: true,allowHttp: false,allowedTargets: ["crm.example:443"] });
  vi.mocked(webhooksApi.list).mockResolvedValue([]);
  vi.mocked(webhooksApi.create).mockResolvedValue({ webhook: hook,secret });
  vi.mocked(webhooksApi.update).mockResolvedValue(hook);
  vi.mocked(webhooksApi.deliveries).mockResolvedValue({ items: [delivery],nextCursor: null });
  vi.mocked(webhooksApi.delivery).mockResolvedValue({ ...delivery,payload: { version: 1 },headers: {},responseExcerpt: "Retry later" });
  vi.mocked(webhooksApi.redeliver).mockResolvedValue({ deliveryId: "d2" });
  vi.mocked(webhooksApi.redeliverFailed).mockResolvedValue({ count: 2 });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear();
  if (clipboardDescriptor) Object.defineProperty(navigator,"clipboard",clipboardDescriptor);
  else Reflect.deleteProperty(navigator,"clipboard");
});
const show = (component = <ProjectIntegrations />) => render(<I18nProvider>{component}</I18nProvider>);
async function createForm() {
  const add = await screen.findByRole("button",{ name: "Добавить вебхук" }); add.focus(); fireEvent.click(add);
  fireEvent.change(screen.getByRole("textbox",{ name: "Название" }),{ target: { value: "CRM" } });
  fireEvent.change(screen.getByRole("textbox",{ name: "URL получателя" }),{ target: { value: "https://crm.example/hook?token=example" } });
  return add;
}
test("feature disabled gives configuration help and a read-only list",async () => {
  vi.mocked(integrationsApi.config).mockResolvedValue({ webhooksEnabled: false,allowHttp: false,allowedTargets: [] });
  vi.mocked(webhooksApi.list).mockResolvedValue([hook]); show();
  expect(await screen.findByText(/WEBHOOKS_ENABLED/)).toBeTruthy();
  expect(screen.queryByRole("button",{ name: "Добавить вебхук" })).toBeNull();
  fireEvent.click(screen.getByRole("button",{ name: "Действия: CRM" }));
  expect(screen.queryByRole("menuitem",{ name: "Изменить вебхук",hidden: true })).toBeNull();
  expect(screen.getByRole("menuitem",{ name: "Журнал доставок",hidden: true })).toBeTruthy();
});
test("creation shows a secret once and close/Escape require acknowledgement, then restore focus",async () => {
  show(); const add = await createForm(); fireEvent.click(screen.getByRole("button",{ name: "Сохранить" }));
  const field = await screen.findByRole("textbox",{ name: "Секрет" });
  expect((field as HTMLInputElement).value).toBe(secret);
  const done = screen.getByRole("button",{ name: "Готово" }); expect(done.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(done); fireEvent.keyDown(field,{ key: "Escape" });
  fireEvent.click(within(screen.getByRole("dialog",{ name: "Сохраните секрет" })).getByRole("button",{ name: "Закрыть" }));
  expect(screen.getByRole("textbox",{ name: "Секрет" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox",{ name: "Я сохранил(а) секрет" })); fireEvent.click(done);
  expect(screen.queryByRole("textbox",{ name: "Секрет" })).toBeNull(); expect(document.activeElement).toBe(add);
  expect(webhooksApi.create).toHaveBeenCalledWith("p1",{ name: "CRM",url: "https://crm.example/hook?token=example",events: ["issue.created"] });
});
test("copy uses the clipboard and a rotation shows the previous-secret deadline",async () => {
  const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator,"clipboard",{ configurable: true,value: { writeText: copy } });
  show(<SecretOnceDialog secret={secret} previousValidUntil="2026-10-05T12:00:00Z" onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button",{ name: "Копировать" }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(secret));
  expect(await screen.findByText(/Прежний секрет действует до/)).toBeTruthy();
  expect(toast).toHaveBeenCalledWith("success","Секрет скопирован");
});
for (const lang of ["ru","en"] as const) test(`target rejection is attached to the URL in ${lang}`,async () => {
  await loadLang(lang); localStorage.setItem("taskira.lang",lang);
  vi.mocked(webhooksApi.create).mockRejectedValue(new ApiError(400,"WEBHOOK_TARGET_NOT_ALLOWED","Адрес запрещён настройками сервера"));
  show(); fireEvent.click(await screen.findByRole("button",{ name: lang === "ru" ? "Добавить вебхук" : "Add webhook" }));
  fireEvent.change(screen.getByRole("textbox",{ name: lang === "ru" ? "Название" : "Name" }),{ target: { value: "CRM" } });
  const url = screen.getByRole("textbox",{ name: lang === "ru" ? "URL получателя" : "Destination URL" });
  fireEvent.change(url,{ target: { value: "https://crm.example/hook" } });
  fireEvent.click(screen.getByRole("button",{ name: lang === "ru" ? "Сохранить" : "Save" }));
  const error = await screen.findByRole("alert"); expect(error.textContent).toBe(lang === "ru" ? "Адрес запрещён настройками сервера" : en["apiError.WEBHOOK_TARGET_NOT_ALLOWED"]);
  expect(url.getAttribute("aria-describedby")).toBe(error.id);
});
test("disabled subscription explains the reason and can be enabled",async () => {
  vi.mocked(webhooksApi.list).mockResolvedValue([{ ...hook,state: "disabled",disabledReason: "failing" }]); show();
  expect(await screen.findByText("Отключён после продолжительных ошибок доставки.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{ name: "Включить" }));
  await waitFor(() => expect(webhooksApi.update).toHaveBeenCalledWith("p1","h1",{ state: "active" }));
  expect(await screen.findByText("Активен")).toBeTruthy();
});
test("editing preserves a secret-bearing URL when the URL field is empty",async () => {
  vi.mocked(webhooksApi.list).mockResolvedValue([hook]); show();
  fireEvent.click(await screen.findByRole("button",{ name: "Действия: CRM" }));
  fireEvent.click(screen.getByRole("menuitem",{ name: "Изменить вебхук",hidden: true }));
  expect((screen.getByRole("textbox",{ name: "URL получателя" }) as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button",{ name: "Сохранить" }));
  await waitFor(() => expect(webhooksApi.update).toHaveBeenCalledWith("p1","h1",{ name: "CRM",events: ["issue.created"] }));
});

function LanguageToggle() {
  const { setLang } = useT();
  return <button onClick={() => setLang("en")}>English</button>;
}
async function startPing(component = <ProjectIntegrations />) {
  vi.mocked(webhooksApi.list).mockResolvedValue([hook]);
  vi.mocked(webhooksApi.ping).mockResolvedValue({ deliveryId: "d1" });
  const view = show(component);
  fireEvent.click(await screen.findByRole("button",{ name: "Действия: CRM" }));
  vi.useFakeTimers();
  await act(async () => fireEvent.click(screen.getByRole("menuitem",{ name: "Проверить связь",hidden: true })));
  return view;
}
test.each(["succeeded","failed"] as const)("ping reports the terminal delivery result: %s",async state => {
  vi.mocked(webhooksApi.delivery).mockResolvedValue({ ...delivery,state,lastStatus: state === "succeeded" ? 200 : 503,lastDurationMs: 85,
    lastError: state === "succeeded" ? null : "http_status",payload: {},headers: {},responseExcerpt: null });
  await startPing(); await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole("status").textContent).toMatch(state === "succeeded" ? /200.*85/ : /Доставка не выполнена.*HTTP/);
  expect(vi.getTimerCount()).toBe(0);
});
test("ping cancels a hanging HTTP read at the 15-second deadline and releases controls",async () => {
  let signal!: AbortSignal;
  vi.mocked(webhooksApi.delivery).mockImplementation((_project,_hook,_delivery,requestSignal) => {
    signal = requestSignal!;
    return new Promise((_resolve,reject) => signal.addEventListener("abort",() => reject(new DOMException("Aborted","AbortError")),{ once: true }));
  });
  await startPing(); await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(signal.aborted).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(13_999)); expect(signal.aborted).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(1)); expect(signal.aborted).toBe(true);
  expect(screen.getByRole("status").textContent).toMatch(/журнал/);
  expect(screen.getByRole("button",{ name: "Действия: CRM" }).getAttribute("aria-disabled")).not.toBe("true");
  expect(toast).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
test("leaving integrations aborts the pending ping without a stale error toast",async () => {
  let signal!: AbortSignal;
  vi.mocked(webhooksApi.delivery).mockImplementation((_project,_hook,_delivery,requestSignal) => {
    signal = requestSignal!;
    return new Promise((_resolve,reject) => signal.addEventListener("abort",() => reject(new DOMException("Aborted","AbortError")),{ once: true }));
  });
  const view = await startPing(); await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => view.unmount());
  expect(signal.aborted).toBe(true); expect(toast).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
test("changing language preserves a pending ping and translates its terminal result",async () => {
  await loadLang("en"); let signal!: AbortSignal, finish!: (value: WebhookDeliveryDetailDto) => void;
  vi.mocked(webhooksApi.delivery).mockImplementation((_project,_hook,_delivery,requestSignal) => {
    signal = requestSignal!; return new Promise(resolve => { finish = resolve; });
  });
  await startPing(<><LanguageToggle /><ProjectIntegrations /></>);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => fireEvent.click(screen.getByRole("button",{ name: "English" })));
  expect(signal.aborted).toBe(false); expect(webhooksApi.list).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...delivery,state: "succeeded",lastStatus: 200,lastError: null,payload: {},headers: {},responseExcerpt: null }));
  expect(screen.getByRole("status").textContent).toMatch(/Delivered: response 200/);
  expect(screen.getByRole("button",{ name: "Actions: CRM" }).getAttribute("aria-disabled")).not.toBe("true");
});
test("acknowledging one secret does not acknowledge a replacement credential",async () => {
  const close = vi.fn(); const view = show(<SecretOnceDialog secret={secret} onClose={close} />);
  fireEvent.click(screen.getByRole("checkbox",{ name: "Я сохранил(а) секрет" }));
  view.rerender(<I18nProvider><SecretOnceDialog secret="whsec_replacement_fixture" onClose={close} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button",{ name: "Готово" }));
  expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole("checkbox",{ name: "Я сохранил(а) секрет" }) as HTMLInputElement).checked).toBe(false);
});
test("journal filters failed deliveries, exposes details and queues a new retry",async () => {
  vi.mocked(webhooksApi.deliveries).mockResolvedValue({ items: [{ ...delivery,eventType: "ping",issueKey: null }],nextCursor: null });
  show(<WebhookDeliveries projectId="p1" hook={hook} enabled onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button",{ name: "Неудачные" }));
  await waitFor(() => expect(webhooksApi.deliveries).toHaveBeenLastCalledWith("p1","h1",{ state: "failed" }));
  const table = await screen.findByRole("table"); fireEvent.click(within(table).getAllByRole("button")[0]);
  expect(screen.getByText("Проверка связи")).toBeTruthy();
  expect(await screen.findByText("Retry later")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{ name: "Повторить доставку" }));
  await waitFor(() => expect(webhooksApi.redeliver).toHaveBeenCalledWith("p1","h1","d1"));
});
test("journal cursor pagination and bulk retry confirmation use the returned count",async () => {
  vi.mocked(webhooksApi.deliveries).mockResolvedValueOnce({ items: [delivery],nextCursor: "cursor-one" })
    .mockResolvedValue({ items: [{ ...delivery,id: "d2",issueKey: "TEST-2" }],nextCursor: null });
  show(<WebhookDeliveries projectId="p1" hook={hook} enabled onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button",{ name: "Показать ещё" }));
  await waitFor(() => expect(webhooksApi.deliveries).toHaveBeenLastCalledWith("p1","h1",{ cursor: "cursor-one" }));
  expect(await screen.findByText("TEST-2")).toBeTruthy(); expect(screen.getByText("TEST-1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{ name: "Повторить неудачные за 24 ч" }));
  const confirm = screen.getByRole("dialog",{ name: "Повторить неудачные за 24 ч" });
  expect(webhooksApi.redeliverFailed).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button",{ name: "Повторить доставку" }));
  expect(await screen.findByText("Создано новых доставок: 2")).toBeTruthy();
  expect(webhooksApi.redeliverFailed).toHaveBeenCalledWith("p1","h1");
});
test("late responses from an old delivery filter cannot replace the current list",async () => {
  let finish!: (value: { items: WebhookDeliveryDto[]; nextCursor: null }) => void;
  vi.mocked(webhooksApi.deliveries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  show(<WebhookDeliveries projectId="p1" hook={hook} enabled onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button",{ name: "Неудачные" }));
  expect(await screen.findByText("TEST-1")).toBeTruthy();
  await act(async () => finish({ items: [{ ...delivery,id: "old",issueKey: "TEST-OLD" }],nextCursor: null }));
  expect(screen.queryByText("TEST-OLD")).toBeNull();
});
test("changing language retains the journal filter and expanded response without refetching",async () => {
  await loadLang("en"); show(<><LanguageToggle /><WebhookDeliveries projectId="p1" hook={hook} enabled onClose={() => {}} /></>);
  fireEvent.click(screen.getByRole("button",{ name: "Неудачные" }));
  const table = await screen.findByRole("table"); fireEvent.click(within(table).getAllByRole("button")[0]);
  expect(await screen.findByText("Retry later")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button",{ name: "English" })));
  expect(screen.getByText("Retry later")).toBeTruthy(); expect(screen.getByText("Request payload")).toBeTruthy();
  expect(webhooksApi.deliveries).toHaveBeenCalledTimes(2); expect(webhooksApi.delivery).toHaveBeenCalledTimes(1);
  expect(webhooksApi.deliveries).toHaveBeenLastCalledWith("p1","h1",{ state: "failed" });
});
test("integration settings are visible only to a global administrator with a project",() => {
  expect(allowedSections("projectSettings",{ isAdmin: false,hasProject: true })).not.toContain("integrations");
  expect(allowedSections("projectSettings",{ isAdmin: true,hasProject: false })).not.toContain("integrations");
  expect(allowedSections("projectSettings",{ isAdmin: true,hasProject: true })).toContain("integrations");
});
