import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

test("unsupported original avatar formats are rejected before any upload", async ({ page }) => {
  await mockApi(page);
  const uploads: string[] = [];
  page.on("request", request => { if (request.url().endsWith("/api/me/avatar") && request.method() === "POST") uploads.push(request.url()); });
  await page.goto("/p/TEST/board");
  await page.getByRole("button", { name: "Меню пользователя", exact: true }).click();
  const input = page.locator('input[type="file"][accept=".png,.jpg,.jpeg,.gif"]');
  await input.setInputFiles({ name: "photo.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') });
  await expect(page.getByRole("alert")).toContainText("PNG, JPG/JPEG и GIF");
  expect(uploads).toEqual([]);
});

test("unreadable board replacement preserves the actual displayed photo", async ({ page }) => {
  await mockApi(page);
  await page.goto("/p/TEST/board");
  await page.locator(".workspace-options > summary").click();
  const input = page.getByLabel("Загрузить фото", { exact: true });
  await input.setInputFiles("e2e/__screenshots__/tabs-light.png");
  const board = page.locator('[data-personal-board-photo="true"]');
  await expect.poll(() => board.evaluate(el => getComputedStyle(el).backgroundImage)).toContain("blob:");
  const previous = await board.evaluate(el => getComputedStyle(el).backgroundImage);
  await expect(input).toHaveAttribute("accept", ".png,.jpg,.jpeg,.gif,.webp");
  await input.setInputFiles({ name: "replacement.svg", mimeType: "image/png", buffer: readFileSync("e2e/__screenshots__/tabs-light.png") });
  await expect(page.getByRole("alert")).toContainText("PNG, JPG/JPEG, GIF или WebP");
  await expect.poll(() => board.evaluate(el => getComputedStyle(el).backgroundImage)).toBe(previous);
  await input.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken") });
  await expect(page.getByRole("alert")).toContainText("Файл не открылся");
  await expect.poll(() => board.evaluate(el => getComputedStyle(el).backgroundImage)).toBe(previous);
});

for (const lang of ["ru", "en"]) test(`help structure, left alignment and narrow layout (${lang})`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem("taskira.lang", lang), lang);
  await mockApi(page);
  await page.goto("/help");
  const nav = page.locator("main nav");
  await expect(nav.getByRole("button")).toHaveCount(19);
  await expect(nav.getByRole("button").first()).toHaveCSS("text-align", "left");
  const prefix = lang === "ru" ? "doc-" : "doc-en-";
  await expect(page.locator(`#${prefix}roles table`)).toBeVisible();
  await expect(page.locator(`#${prefix}appearance`)).toContainText("PNG");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `shots/help-narrow-${lang}.png`, fullPage: true });
});

test("preset brand colour survives reload and switches back to the legacy palette", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: null, hue: 145, logoUpdatedAt: null, transparencyDefault: "auto" } }));
  await page.goto("/p/TEST/board");
  await expect(page.locator("html")).toHaveAttribute("data-brand-palette", "extended");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-brand-palette", "extended");
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: null, hue: 300, logoUpdatedAt: null, transparencyDefault: "auto" } }));
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-brand-palette");
});

test("a corrupt avatar does not upload, then an uppercase PNG is cropped and uploaded as JPEG", async ({ page }) => {
  await mockApi(page);
  let uploads = 0;
  await page.route("**/api/me/avatar", route => {
    uploads++;
    expect(route.request().postDataBuffer()?.toString("latin1")).toContain('filename="avatar.jpg"');
    expect(route.request().postDataBuffer()?.toString("latin1")).toContain("image/jpeg");
    return route.fulfill({ json: { avatarUpdatedAt: 1790964000000 } });
  });
  const photo = readFileSync("e2e/__screenshots__/tabs-light.png");
  await page.route("**/api/users/u1/avatar*", route => route.fulfill({ contentType: "image/png", body: photo }));
  await page.goto("/p/TEST/board");
  await page.getByRole("button", { name: "Меню пользователя", exact: true }).click();
  const input = page.locator('input[type="file"][accept=".png,.jpg,.jpeg,.gif"]');
  await input.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken") });
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить фото");
  expect(uploads).toBe(0);
  await input.setInputFiles({ name: "photo.PNG", mimeType: "image/png", buffer: photo });
  await expect.poll(() => uploads).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});


test("saved branding updates a decodable favicon under production CSP", async ({ page }) => {
  await mockApi(page);
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { faviconCspErrors: string[] }).faviconCspErrors = [];
    document.addEventListener("securitypolicyviolation", event => {
      (window as unknown as { faviconCspErrors: string[] }).faviconCspErrors.push(event.blockedURI);
    });
  });
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: "Acme", hue: 235, logoUpdatedAt: null, transparencyDefault: "auto" } }));
  await page.goto("/p/TEST/board");
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute("href", /^data:image\/svg\+xml,/);
  expect(decodeURIComponent(await icon.getAttribute("href") ?? "")).toContain("oklch(0.52 0.2 235)");
  expect(await page.evaluate(async () => {
    const image = new Image();
    image.src = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href;
    await image.decode();
    return image.naturalWidth > 0;
  })).toBe(true);
  await page.goto("/help");
  await expect(icon).toHaveAttribute("href", /^data:image\/svg\+xml,/);
  await page.route("**/api/instance/brand/logo*", route => route.fulfill({ contentType: "image/png", body: readFileSync("e2e/__screenshots__/tabs-light.png") }));
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: "Acme", hue: 235, logoUpdatedAt: 42, transparencyDefault: "auto" } }));
  await page.reload();
  await expect(icon).toHaveAttribute("href", /^blob:/);
  await page.route("**/api/instance/brand", route => route.fulfill({ json: { name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "auto" } }));
  await page.reload();
  await expect(icon).toHaveAttribute("href", "/favicon.svg");
  violations.push(...await page.evaluate(() => (window as unknown as { faviconCspErrors: string[] }).faviconCspErrors));
  expect(violations).toEqual([]);
});
