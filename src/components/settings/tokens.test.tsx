import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider, loadLang, useT } from "../../i18n";
import { ApiError, adminTokensApi, serviceAccountsApi, tokensApi } from "../../api";
import { allowedSections } from "../../settings/access";
import PersonalTokens from "./PersonalTokens";
import ServiceAccounts from "./ServiceAccounts";
import type { ApiTokenDto, ServiceAccountDto } from "../../../server/src/contract";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../../store",() => ({ useStore: () => ({ toast,me: { id: "u1" },data: { projects: [{ id: "p1",key: "TEST" }] } }) }));
vi.mock("../../api",async original => ({ ...await original<typeof import("../../api")>(),
  tokensApi: { list: vi.fn(),create: vi.fn(),revoke: vi.fn() },
  adminTokensApi: { list: vi.fn(),revoke: vi.fn() },
  serviceAccountsApi: { list: vi.fn(),create: vi.fn(),update: vi.fn(),tokens: vi.fn(),createToken: vi.fn(),revokeToken: vi.fn() },
}));
let token: ApiTokenDto, account: ServiceAccountDto;
const secret = "tsk_abcdefgh_" + "X".repeat(43);
beforeEach(() => {
  vi.resetAllMocks(); localStorage.setItem("taskira.lang","ru");
  token = { id: "t1",name: "CRM",prefix: "abcdefgh",scope: "read",createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now()+90*86400_000).toISOString(),lastUsedAt: null,revokedAt: null };
  account = { id: "s1",name: "Sync Robot",username: "sync.bot",isActive: true,createdAt: token.createdAt,
    projects: [{ projectId: "p1",role: "employee" }],activeTokens: 1 };
  vi.mocked(tokensApi.list).mockResolvedValue([token]); vi.mocked(tokensApi.create).mockResolvedValue({ token: { ...token,id: "t2",name: "New" },secret });
  vi.mocked(tokensApi.revoke).mockResolvedValue(undefined);
  vi.mocked(serviceAccountsApi.list).mockResolvedValue([account]); vi.mocked(serviceAccountsApi.tokens).mockResolvedValue([token]);
  vi.mocked(serviceAccountsApi.create).mockResolvedValue({ ...account,id: "s2",name: "Another Robot",username: "another.bot",projects: [],activeTokens: 0 });
  vi.mocked(serviceAccountsApi.update).mockResolvedValue({ ...account,isActive: false });
  vi.mocked(serviceAccountsApi.createToken).mockResolvedValue({ token: { ...token,id: "t2" },secret });
  vi.mocked(serviceAccountsApi.revokeToken).mockResolvedValue(undefined);
  vi.mocked(adminTokensApi.list).mockResolvedValue([{ ...token,owner: { id: "s1",username: "sync.bot",name: "Sync Robot",authSource: "service" } }]);
  vi.mocked(adminTokensApi.revoke).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
const show = (node = <PersonalTokens />) => render(<I18nProvider>{node}</I18nProvider>);
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise,resolve }; };

test("creation shows the token once, default lifetime and returns focus after acknowledgement",async () => {
  show(); await screen.findByText("CRM"); const add = await screen.findByRole("button",{ name: "Новый токен" }); add.focus(); fireEvent.click(add);
  fireEvent.change(screen.getByRole("textbox",{ name: "Название" }),{ target: { value: "New" } });
  expect((screen.getByRole("combobox",{ name: "Срок действия" }) as HTMLSelectElement).value).toBe("90");
  fireEvent.click(screen.getByRole("button",{ name: "Создать" }));
  expect((await screen.findByRole("textbox",{ name: "Секрет" }) as HTMLInputElement).value).toBe(secret);
  expect(screen.getByText(`curl -H "Authorization: Bearer ${secret}" "${window.location.origin}/api/projects"`)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{ name: "Готово" })); expect(screen.getByRole("textbox",{ name: "Секрет" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox",{ name: "Я сохранил(а) секрет" })); fireEvent.click(screen.getByRole("button",{ name: "Готово" }));
  expect(screen.queryByRole("textbox",{ name: "Секрет" })).toBeNull(); expect(document.body.textContent).not.toContain(secret); expect(document.activeElement).toBe(add);
  expect(tokensApi.create).toHaveBeenCalledWith({ name: "New",scope: "read",expiresInDays: 90 });
});
test("scope and selected lifetime reach the API",async () => {
  show(); await screen.findByText("CRM"); fireEvent.click(await screen.findByRole("button",{ name: "Новый токен" }));
  fireEvent.change(screen.getByRole("textbox",{ name: "Название" }),{ target: { value: "Writer" } });
  fireEvent.click(screen.getByRole("radio",{ name: "Чтение и запись" }));
  fireEvent.change(screen.getByRole("combobox",{ name: "Срок действия" }),{ target: { value: "30" } });
  fireEvent.click(screen.getByRole("button",{ name: "Создать" }));
  await waitFor(() => expect(tokensApi.create).toHaveBeenCalledWith({ name: "Writer",scope: "write",expiresInDays: 30 }));
});
for (const [lang,days,warning] of [["ru",1,"Истекает через 1 день"],["ru",3,"Истекает через 3 дня"],["en",5,"Expires in 5 days"]] as const) test(`expiry warning uses plural forms: ${lang}, ${days}`,async () => {
  await loadLang(lang); localStorage.setItem("taskira.lang",lang);
  vi.mocked(tokensApi.list).mockResolvedValue([{ ...token,expiresAt: new Date(Date.now()+(days-0.1)*86400_000).toISOString() }]);
  show(); expect(await screen.findByText(warning)).toBeTruthy();
});
test("revoke confirms, optimistically removes and rolls back NOT_FOUND without losing position",async () => {
  const result = pending<void>(); vi.mocked(tokensApi.revoke).mockReturnValue(result.promise);
  vi.mocked(tokensApi.list).mockResolvedValue([token,{ ...token,id: "t2",name: "Other" }]); show();
  fireEvent.click(await screen.findByRole("button",{ name: "Отозвать токен «CRM»" }));
  expect(tokensApi.revoke).not.toHaveBeenCalled(); fireEvent.click(within(screen.getByRole("dialog",{ name: "Отозвать токен?" })).getByRole("button",{ name: "Отозвать" }));
  expect(screen.queryByText("CRM")).toBeNull(); expect(tokensApi.revoke).toHaveBeenCalledWith("t1");
  result.resolve(undefined); await waitFor(() => expect(toast).toHaveBeenCalledWith("success","Токен отозван"));
  cleanup(); vi.mocked(tokensApi.revoke).mockRejectedValue(new ApiError(404,"NOT_FOUND","Токен не найден")); show();
  fireEvent.click(await screen.findByRole("button",{ name: "Отозвать токен «CRM»" }));
  fireEvent.click(within(screen.getByRole("dialog",{ name: "Отозвать токен?" })).getByRole("button",{ name: "Отозвать" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("error","Токен не найден"));
  expect(screen.getAllByRole("row")[1].textContent).toContain("CRM");
});
test("quota counts only active tokens, revoked rows stay hidden and expired rows remain visible",async () => {
  vi.mocked(tokensApi.list).mockResolvedValue([...Array.from({ length: 10 },(_,i) => ({ ...token,id: String(i),name: "Active "+i })),
    { ...token,id: "old",name: "Expired",expiresAt: new Date(Date.now()-1000).toISOString() },{ ...token,id: "revoked",name: "Revoked",revokedAt: token.createdAt }]);
  show(); await screen.findByText("Expired"); expect(screen.queryByText("Revoked")).toBeNull();
  expect(screen.getByRole("button",{ name: "Новый токен" }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("Истёк")).toBeTruthy();
});
test("failed loading can retry",async () => {
  vi.mocked(tokensApi.list).mockRejectedValueOnce(new Error("offline")); show(); await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button",{ name: "Повторить" })); expect(await screen.findByText("CRM")).toBeTruthy(); expect(tokensApi.list).toHaveBeenCalledTimes(2);
});
test("deactivation requires confirmation and updates only the chosen account",async () => {
  show(<ServiceAccounts />); fireEvent.click(await screen.findByRole("button",{ name: "Sync Robot" }));
  expect(screen.getByRole("link",{ name: "Управлять доступом" }).getAttribute("href")).toBe("/p/TEST/settings/access");
  fireEvent.click(screen.getByRole("switch",{ name: "Активна" })); expect(serviceAccountsApi.update).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog",{ name: "Выключить сервисную запись?" })).getByRole("button",{ name: "Выключить" }));
  await waitFor(() => expect(serviceAccountsApi.update).toHaveBeenCalledWith("s1",{ isActive: false }));
  expect(screen.getByRole("switch",{ name: "Активна" }).getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("button",{ name: "Новый токен" }).getAttribute("aria-disabled")).toBe("true");
});
test("creating a service account opens its project and token panel",async () => {
  show(<ServiceAccounts />); fireEvent.click(screen.getByRole("button",{ name: "Создать сервисную запись" }));
  fireEvent.change(screen.getByRole("textbox",{ name: "Логин" }),{ target: { value: "another.bot" } });
  fireEvent.change(screen.getByRole("textbox",{ name: "Имя" }),{ target: { value: "Another Robot" } });
  fireEvent.click(within(screen.getByRole("dialog",{ name: "Создать сервисную запись" })).getByRole("button",{ name: "Создать" }));
  await screen.findByRole("dialog",{ name: "Another Robot" });
  expect(serviceAccountsApi.create).toHaveBeenCalledWith({ username: "another.bot",name: "Another Robot" });
  await waitFor(() => expect(serviceAccountsApi.tokens).toHaveBeenCalledWith("s2"));
  expect(screen.getByText("Добавьте запись в участники через раздел «Доступ» нужного проекта.")).toBeTruthy();
});
test("the account panel waits for reactivation before allowing dismissal",async () => {
  vi.mocked(serviceAccountsApi.list).mockResolvedValue([{ ...account,isActive: false }]);
  const result=pending<ServiceAccountDto>(); vi.mocked(serviceAccountsApi.update).mockReturnValue(result.promise);
  show(<ServiceAccounts />); fireEvent.click(await screen.findByRole("button",{ name: "Sync Robot" }));
  fireEvent.click(screen.getByRole("switch",{ name: "Активна" }));
  const close=within(screen.getByRole("dialog",{ name: "Sync Robot" })).getByRole("button",{ name: "Закрыть" });
  fireEvent.click(close); expect(screen.getByRole("dialog",{ name: "Sync Robot" })).toBeTruthy();
  expect(serviceAccountsApi.update).toHaveBeenCalledWith("s1",{ isActive: true });
  result.resolve(account); await waitFor(() => expect(screen.getByRole("switch",{ name: "Активна" }).getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(close); expect(screen.queryByRole("dialog",{ name: "Sync Robot" })).toBeNull();
});
test("service token creation uses its owner endpoint",async () => {
  show(<ServiceAccounts />); fireEvent.click(await screen.findByRole("button",{ name: "Sync Robot" })); await screen.findByText("CRM");
  fireEvent.click(screen.getByRole("button",{ name: "Новый токен" }));
  fireEvent.change(screen.getByRole("textbox",{ name: "Название" }),{ target: { value: "Robot API" } });
  fireEvent.click(screen.getByRole("button",{ name: "Создать" }));
  await screen.findByRole("textbox",{ name: "Секрет" });
  expect(serviceAccountsApi.createToken).toHaveBeenCalledWith("s1",{ name: "Robot API",scope: "read",expiresInDays: 90 });
  expect(tokensApi.create).not.toHaveBeenCalled();
});
test("service token creation respects the five-token quota",async () => {
  vi.mocked(serviceAccountsApi.tokens).mockResolvedValue(Array.from({ length: 5 },(_,i) => ({ ...token,id: String(i) })));
  show(<ServiceAccounts />); fireEvent.click(await screen.findByRole("button",{ name: "Sync Robot" })); await screen.findAllByText("CRM");
  expect(screen.getByRole("button",{ name: "Новый токен" }).getAttribute("aria-disabled")).toBe("true"); expect(serviceAccountsApi.tokens).toHaveBeenCalledWith("s1");
});
test("all tokens lists active credentials with owner and uses the administrative revoke endpoint",async () => {
  show(<ServiceAccounts />); fireEvent.click(screen.getByRole("tab",{ name: "Все токены" }));
  fireEvent.click(await screen.findByRole("button",{ name: "Отозвать токен «CRM»" }));
  expect(adminTokensApi.list).toHaveBeenCalledWith({ active: "1" }); expect(screen.getByText("сервис")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("dialog",{ name: "Отозвать токен?" })).getByRole("button",{ name: "Отозвать" }));
  await waitFor(() => expect(adminTokensApi.revoke).toHaveBeenCalledWith("t1")); expect(tokensApi.revoke).not.toHaveBeenCalled();
});
test("navigation hides administration for ordinary users and personal tokens for service accounts",() => {
  expect(allowedSections("orgSettings",{ isAdmin: false,hasProject: true })).not.toContain("service-accounts");
  expect(allowedSections("orgSettings",{ isAdmin: true,hasProject: false })).toContain("service-accounts");
  expect(allowedSections("settings",{ isAdmin: false,hasProject: false,isService: true })).not.toContain("tokens");
});
function LanguageToggle() { const { setLang } = useT(); return <><button onClick={() => setLang("en")}>English</button><PersonalTokens /></>; }

test("creation after navigation explains recovery without exposing the token",async () => {
  const result = pending<{ token: ApiTokenDto; secret: string }>(); vi.mocked(tokensApi.create).mockReturnValue(result.promise);
  const view = show(); await screen.findByText("CRM"); fireEvent.click(screen.getByRole("button",{ name: "Новый токен" }));
  fireEvent.change(screen.getByRole("textbox",{ name: "Название" }),{ target: { value: "New" } }); fireEvent.click(screen.getByRole("button",{ name: "Создать" }));
  view.unmount(); result.resolve({ token,secret });
  await waitFor(() => expect(toast).toHaveBeenCalledWith("success",expect.stringContaining("отзовите его")));
  expect(JSON.stringify(toast.mock.calls)).not.toContain(secret); expect(document.body.textContent).not.toContain(secret);
});
test("changing language preserves the unacknowledged secret and does not refetch tokens",async () => {
  await loadLang("en"); show(<LanguageToggle />); await screen.findByText("CRM"); fireEvent.click(await screen.findByRole("button",{ name: "Новый токен" }));
  fireEvent.change(screen.getByRole("textbox",{ name: "Название" }),{ target: { value: "New" } }); fireEvent.click(screen.getByRole("button",{ name: "Создать" }));
  await screen.findByRole("textbox",{ name: "Секрет" }); fireEvent.click(screen.getByRole("button",{ name: "English" }));
  expect((await screen.findByRole("textbox",{ name: "Secret" }) as HTMLInputElement).value).toBe(secret); expect(tokensApi.list).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button",{ name: "Done" }).getAttribute("aria-disabled")).toBe("true");
});
