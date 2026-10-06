import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RecurringRuleDto, RecurringRunDto } from "../../../server/src/contract";
import { I18nProvider, loadLang } from "../../i18n";
import { ApiError, recurringApi, usersApi } from "../../api";
import { allowedSections } from "../../settings/access";

const store = vi.hoisted(() => ({ editable: true, toast: vi.fn(), openIssue: vi.fn(), setView: vi.fn(),
  data: { currentProjectId: "p1", project: { key: "TEST" },
    issueTemplates: [{ id: "t1", name: "Inspection", title: "Inspect {date}" }],
    members: { u1: "manager", u2: "employee" } as Record<string, string>,
    users: [{ id: "u1", name: "Anna", authSource: "local" }, { id: "u2", name: "Boris", authSource: "local" },
      { id: "svc", name: "Robot", authSource: "service" }, { id: "outside", name: "Outside", authSource: "local" }],
  } }));
vi.mock("../../store", () => ({ useStore: () => ({ ...store, can: () => store.editable }) }));
vi.mock("../../api", async original => ({ ...await original<typeof import("../../api")>(),
  recurringApi: { config: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), pause: vi.fn(), resume: vi.fn(), runNow: vi.fn(), runs: vi.fn(), preview: vi.fn() },
  usersApi: { pickable: vi.fn() },
}));
import ProjectRecurring from "./ProjectRecurring";
import RecurringRuleForm from "./RecurringRuleForm";

const rule: RecurringRuleDto = { id: "r1", projectId: "p1", name: "Weekly inspection", templateId: "t1", title: null,
  schedule: { kind: "weekly", every: 1, weekdays: [1] }, timeOfDay: "09:00", timeZone: "Asia/Tashkent", startDate: "2023-01-01",
  assigneeIds: [], dueInDays: null, skipIfOpen: false, ownerId: "u1", state: "active", pausedReason: null,
  nextRunAt: "2026-10-12T04:00:00Z", lastRunAt: null, lastResult: null, createdAt: "2026-10-06T04:00:00Z", updatedAt: "2026-10-06T04:00:00Z" };
const run: RecurringRunDto = { id: "run1", scheduledFor: "2026-10-06T04:00:00Z", ranAt: "2026-10-06T04:01:00Z", result: "created",
  manual: true, missedCount: 3, issueId: "issue1", issueKey: "TEST-1", errorCode: null, details: { droppedAssignees: ["u2"] } };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); store.editable = true;
  vi.mocked(recurringApi.config).mockResolvedValue({ enabled: true, defaultTimeZone: "Asia/Tashkent" });
  vi.mocked(recurringApi.list).mockResolvedValue([rule]); vi.mocked(recurringApi.create).mockResolvedValue(rule);
  vi.mocked(recurringApi.update).mockResolvedValue(rule); vi.mocked(recurringApi.preview).mockResolvedValue({ next: [rule.nextRunAt!] });
  vi.mocked(recurringApi.pause).mockResolvedValue({ ...rule, state: "paused", pausedReason: "manual", nextRunAt: null });
  vi.mocked(recurringApi.runs).mockResolvedValue([run]); vi.mocked(recurringApi.runNow).mockResolvedValue(run);
  vi.mocked(usersApi.pickable).mockResolvedValue(store.data.users as never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
const show = (component = <ProjectRecurring />) => render(<I18nProvider>{component}</I18nProvider>);
const form = (props: Partial<Parameters<typeof RecurringRuleForm>[0]> = {}) => show(<RecurringRuleForm projectId="p1" defaultTimeZone="Asia/Tashkent" onClose={vi.fn()} onSaved={vi.fn()} {...props} />);
async function menu(item: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Действия: Weekly inspection" }));
  fireEvent.click(screen.getByRole("menuitem", { name: item, hidden: true }));
}
test("viewers can see rules and history, but have no management actions", async () => {
  expect(allowedSections("projectSettings", { isAdmin: false, hasProject: true })).toContain("recurring");
  store.editable = false; show(); await screen.findByText(rule.name);
  expect(screen.queryByRole("button", { name: "Добавить правило" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `Действия: ${rule.name}` }));
  expect(screen.getAllByRole("menuitem", { hidden: true }).map(value => value.textContent)).toEqual(["История запусков"]);
});
test("feature switch disables automatic runs while managers retain manual controls", async () => {
  vi.mocked(recurringApi.config).mockResolvedValue({ enabled: false, defaultTimeZone: "UTC" }); show();
  expect(await screen.findByText("RECURRING_ENABLED")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Добавить правило" }).getAttribute("aria-disabled")).toBeNull();
  await menu("Пауза"); await screen.findByText("Пауза: вручную");
  expect(recurringApi.pause).toHaveBeenCalledWith("p1", "r1");
});
test.each(["owner_lost_access", "invalid_timing", "run_failed"] as const)("pause reason %s is explained", async reason => {
  vi.mocked(recurringApi.list).mockResolvedValue([{ ...rule, state: "paused", pausedReason: reason, nextRunAt: null }]); show();
  const name = await screen.findByText(rule.name); expect(name.parentElement?.textContent).toContain("Пауза:");
});
test("new weekly rule saves schema fields, numeric weekdays and null due date", async () => {
  show(); fireEvent.click(await screen.findByRole("button", { name: "Добавить правило" }));
  const name = await screen.findByRole("textbox", { name: "Название правила" });
  fireEvent.change(name, { target: { value: "Inspection" } });
  fireEvent.click(screen.getByRole("button", { name: "ср" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(recurringApi.create).toHaveBeenCalledOnce());
  expect(vi.mocked(recurringApi.create).mock.calls[0]).toEqual(["p1", expect.objectContaining({ name: "Inspection", templateId: "t1", title: null,
    schedule: { kind: "weekly", every: 1, weekdays: [1, 3] }, timeOfDay: "09:00", timeZone: "Asia/Tashkent", assigneeIds: [], dueInDays: null, skipIfOpen: false })]);
});
test.each([[1, "Каждый месяц"], [3, "Раз в квартал"], [6, "Раз в полгода"], [12, "Раз в год"]] as const)("monthly preset %i saves a calendar interval", async (every, label) => {
  form(); fireEvent.change(screen.getByRole("textbox", { name: "Название правила" }), { target: { value: "Report" } });
  fireEvent.click(screen.getByRole("button", { name: "Ежемесячно" })); fireEvent.click(screen.getByRole("button", { name: label }));
  expect((screen.getByRole("spinbutton", { name: "Каждые N" }) as HTMLInputElement).value).toBe(String(every));
  fireEvent.click(screen.getByRole("checkbox", { name: "Последний день месяца" })); fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(recurringApi.create).toHaveBeenCalledWith("p1", expect.objectContaining({ schedule: { kind: "monthly", every, day: "last" } })));
});
test("preview debounces schedule changes and ignores aborted responses", async () => {
  vi.useFakeTimers(); const pending: ((value: { next: string[] }) => void)[] = [];
  vi.mocked(recurringApi.preview).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  form(); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  const firstSignal = vi.mocked(recurringApi.preview).mock.calls[0][2]!;
  fireEvent.click(screen.getByRole("button", { name: "Ежедневно" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Каждые N" }), { target: { value: "3" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(299); }); expect(recurringApi.preview).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(recurringApi.preview).toHaveBeenCalledTimes(2);
  expect(firstSignal.aborted).toBe(true);
  expect(vi.mocked(recurringApi.preview).mock.calls[1][1].schedule).toEqual({ kind: "daily", every: 3 });
  await act(async () => { pending[1]({ next: ["2026-10-12T04:00:00Z"] }); pending[0]({ next: ["2026-10-01T04:00:00Z"] }); });
  expect(document.querySelectorAll("time")).toHaveLength(1); expect(document.querySelector("time")?.dateTime).toBe("2026-10-12T04:00:00Z");
});
test("preview validation appears inline without a toast", async () => {
  vi.useFakeTimers(); vi.mocked(recurringApi.preview).mockRejectedValue(new ApiError(400, "VALIDATION", "Неверный пояс")); form();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(screen.getByRole("alert").textContent).toBe("Неверный пояс"); expect(store.toast).not.toHaveBeenCalled();
});
test("without supportedValuesOf, the rule zone and UTC are still selectable", async () => {
  vi.useFakeTimers(); vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { supportedValuesOf: undefined }));
  form(); fireEvent.focus(screen.getByRole("combobox", { name: "Часовой пояс" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Часовой пояс" }), { target: { value: "" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByRole("option", { name: "UTC", hidden: true })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Asia/Tashkent", hidden: true })).toBeTruthy();
});
test("unrelated edits omit old start dates and departed assignees; unchanged save can transfer ownership", async () => {
  const saved = vi.fn(); form({ rule: { ...rule, assigneeIds: ["departed"] }, onSaved: saved });
  fireEvent.change(screen.getByRole("textbox", { name: "Название правила" }), { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(recurringApi.update).toHaveBeenCalledWith("p1", "r1", { name: "Renamed" }));
  cleanup(); vi.mocked(recurringApi.update).mockClear(); form({ rule: { ...rule, state: "paused", pausedReason: "owner_lost_access" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(recurringApi.update).toHaveBeenCalledWith("p1", "r1", { name: rule.name }));
});
test("assignee picker filters nonmembers/service users and clears between selections", async () => {
  vi.useFakeTimers(); form(); const input = screen.getByRole("combobox", { name: "Исполнители" });
  fireEvent.focus(input); await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.queryByRole("option", { name: "Robot", hidden: true })).toBeNull(); expect(screen.queryByRole("option", { name: "Outside", hidden: true })).toBeNull();
  fireEvent.mouseDown(screen.getByRole("option", { name: "Anna", hidden: true })); expect((input as HTMLInputElement).value).toBe("");
  fireEvent.focus(input); await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  fireEvent.mouseDown(screen.getByRole("option", { name: "Boris", hidden: true })); expect((input as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("button", { name: "Убрать исполнителя Anna" })).toBeTruthy(); expect(screen.getByRole("button", { name: "Убрать исполнителя Boris" })).toBeTruthy();
});
test("pending save blocks close and duplicate submissions, and unmount suppresses a late success", async () => {
  let resolve!: (value: RecurringRuleDto) => void; vi.mocked(recurringApi.create).mockImplementation(() => new Promise(done => { resolve = done; }));
  const onClose = vi.fn(), onSaved = vi.fn(); const view = form({ onClose, onSaved });
  fireEvent.change(screen.getByRole("textbox", { name: "Название правила" }), { target: { value: "Name" } });
  const save = screen.getByRole("button", { name: "Сохранить" }); fireEvent.click(save); fireEvent.click(save);
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" })); expect(onClose).not.toHaveBeenCalled(); expect(recurringApi.create).toHaveBeenCalledOnce();
  view.unmount(); await act(async () => resolve(rule)); expect(onSaved).not.toHaveBeenCalled();
});
test("a parked rule with a broken schedule can be opened and repaired", async () => {
  form({ rule: { ...rule, schedule: null as never, state: "paused", pausedReason: "invalid_timing" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(recurringApi.update).toHaveBeenCalledWith("p1", "r1", { schedule: { kind: "weekly", every: 1, weekdays: [1] } }));
});
test("history shows manual/catch-up details and opens the created issue in a panel", async () => {
  show(); await menu("История запусков"); const panel = await screen.findByRole("dialog", { name: `История: ${rule.name}` });
  const link = await within(panel).findByRole("link", { name: "TEST-1" }); expect(link.getAttribute("href")).toBe("/p/TEST/issue/TEST-1");
  expect(within(panel).getByText("Пропущено: 3")).toBeTruthy(); expect(within(panel).getByText("Выпавшие исполнители: Boris")).toBeTruthy();
  fireEvent.click(link); expect(store.openIssue).toHaveBeenCalledWith("issue1", "panel");
});
test("failed manual run refreshes server pause state and does not claim an issue was created", async () => {
  vi.mocked(recurringApi.list).mockResolvedValueOnce([rule]).mockResolvedValue([{ ...rule, state: "paused", pausedReason: "owner_lost_access", nextRunAt: null }]);
  vi.mocked(recurringApi.runNow).mockRejectedValue(new ApiError(409, "RECURRING_OWNER_LOST", "Владелец потерял доступ")); show(); await menu("Запустить сейчас");
  fireEvent.click(screen.getByRole("button", { name: "Запустить сейчас" }));
  await screen.findByText(/Пауза: у владельца/); expect(store.toast).toHaveBeenCalledWith("error", "Владелец потерял доступ");
  expect(store.toast).not.toHaveBeenCalledWith("success", expect.anything());
});
test("late action completion cannot update or toast after leaving the section", async () => {
  let done!: (value: RecurringRuleDto) => void; vi.mocked(recurringApi.pause).mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const view = show(); await menu("Пауза"); view.unmount(); await act(async () => done({ ...rule, state: "paused", pausedReason: "manual" })); expect(store.toast).not.toHaveBeenCalled();
});
test("save conflicts are translated for an English interface", async () => {
  await loadLang("en"); localStorage.setItem("taskira.lang", "en");
  vi.mocked(recurringApi.create).mockRejectedValue(new ApiError(409, "CONFLICT", "Правило с таким названием уже есть")); form();
  fireEvent.change(screen.getByRole("textbox", { name: "Rule name" }), { target: { value: "Name" } }); fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const message = (await screen.findByRole("alert")).textContent;
  expect(message).toContain("Couldn't change the rule"); expect(message).not.toMatch(/[А-Яа-яЁё]/);
});
