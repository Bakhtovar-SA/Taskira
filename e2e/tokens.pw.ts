import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boardFixture } from "./board-fixture";
const secret = "tsk_abcdefgh_" + "X".repeat(43);
async function tokenFixture(page: Page,theme: "light" | "dark") {
  await boardFixture(page,theme);
  const token = { id: "t1",name: "CRM export",prefix: "abcdefgh",scope: "read",createdAt: "2026-10-05T08:00:00Z",expiresAt: "2027-01-03T08:00:00Z",lastUsedAt: "2026-10-05T09:00:00Z",revokedAt: null };
  const account = { id: "s1",username: "sync.bot",name: "Sync Robot",isActive: true,createdAt: token.createdAt,projects: [{ projectId: "p1",role: "employee" }],activeTokens: 1 };
  const personal = [token], serviceTokens = [token];
  await page.route("**/api/me/tokens**",async route => {
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()==="POST") {const body=req.postDataJSON(); const result={ ...token,id: "t2",name: body.name,scope: body.scope }; personal.unshift(result); return route.fulfill({ status: 201,json: { token: result,secret } });}
    if(req.method()==="DELETE") { personal.splice(personal.findIndex(row => path.endsWith('/'+row.id)),1); return route.fulfill({ status: 204 }); }
    return route.fulfill({ json: personal });
  });
  await page.route("**/api/admin/service-accounts**",async route => {
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path.endsWith('/tokens')) {
      if(req.method()==="POST") {const body=req.postDataJSON(); const result={ ...token,id: "t3",name: body.name,scope: body.scope }; serviceTokens.unshift(result); return route.fulfill({ status: 201,json: { token: result,secret } });}
      return route.fulfill({ json: serviceTokens });
    }
    if(req.method()==="PATCH") {Object.assign(account,req.postDataJSON()); return route.fulfill({ json: account });}
    return route.fulfill({ json: [account] });
  });
  await page.route("**/api/admin/tokens**",route => route.fulfill({ json: [{ ...token,owner: { id: account.id,name: account.name,username: account.username,authSource: "service" } }] }));
}
for(const theme of ["light","dark"] as const) test(`personal tokens and service accounts · ${theme}`,async ({ page },info) => {
  test.setTimeout(60_000); await page.setViewportSize({ width: 1600,height: 1000 }); await tokenFixture(page,theme);
  const errors: string[]=[]; page.on("pageerror",error => errors.push(error.message));
  page.on("console",message => { if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
  await page.goto('/settings/tokens'); await expect(page.getByRole('heading',{ name: 'API-токены',exact: true })).toBeVisible();
  await expect(page.getByRole('cell',{ name: 'CRM export',exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`personal-tokens-${theme}.png`) });
  const add=page.getByRole('button',{ name: 'Новый токен',exact: true }); await add.click();
  await page.getByRole('textbox',{ name: 'Название',exact: true }).fill('Daily export');
  await page.getByRole('radio',{ name: 'Чтение и запись',exact: true }).check();
  await page.getByRole('combobox',{ name: 'Срок действия' }).selectOption('30');
  const posted=page.waitForRequest(req => req.url().endsWith('/api/me/tokens') && req.method()==='POST');
  await page.getByRole('button',{ name: 'Создать',exact: true }).click();
  expect((await posted).postDataJSON()).toEqual({ name: 'Daily export',scope: 'write',expiresInDays: 30 });
  await expect(page.getByRole('textbox',{ name: 'Секрет',exact: true })).toHaveValue(secret);
  await page.keyboard.press('Escape'); await expect(page.getByRole('textbox',{ name: 'Секрет',exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('checkbox',{ name: 'Я сохранил(а) секрет' }).check(); await page.getByRole('button',{ name: 'Готово',exact: true }).click();
  await expect(add).toBeFocused(); await expect(page.getByRole('textbox',{ name: 'Секрет',exact: true })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain(secret);
  const revoke=page.getByRole('button',{ name: 'Отозвать токен «Daily export»' }); await revoke.click();
  await page.getByRole('dialog',{ name: 'Отозвать токен?' }).getByRole('button',{ name: 'Отозвать',exact: true }).click();
  await expect(page.getByRole('cell',{ name: 'Daily export',exact: true })).toHaveCount(0);
  await page.goto('/admin/service-accounts'); await expect(page.getByRole('button',{ name: 'Sync Robot',exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`service-accounts-${theme}.png`) });
  const open=page.getByRole('button',{ name: 'Sync Robot',exact: true }); await open.click();
  await expect(page.getByRole('link',{ name: 'Управлять доступом' })).toHaveAttribute('href','/p/CORP/settings/access');
  await expect(page.getByRole('button',{ name: 'Отозвать токен «CRM export»' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`service-account-panel-${theme}.png`) });
  await page.getByRole('switch',{ name: 'Активна',exact: true }).click();
  await page.getByRole('dialog',{ name: 'Выключить сервисную запись?' }).getByRole('button',{ name: 'Выключить',exact: true }).click();
  await expect(page.getByRole('switch',{ name: 'Активна',exact: true })).not.toBeChecked();
  await expect(page.getByRole('button',{ name: 'Новый токен',exact: true })).toHaveAttribute('aria-disabled','true');
  await page.getByRole('dialog',{ name: 'Sync Robot',exact: true }).getByRole('button',{ name: 'Закрыть',exact: true }).click();
  await expect(open).toBeFocused(); await page.getByRole('tab',{ name: 'Все токены',exact: true }).click();
  await expect(page.getByRole('cell',{ name: /^Sync Robot/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); expect(errors).toEqual([]);
});
