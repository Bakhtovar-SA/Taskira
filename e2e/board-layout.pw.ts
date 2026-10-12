import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";

for (const [width, height] of [[1920, 1080], [1460, 900], [390, 844]]) test(`board stays in place while selecting cards and filtering (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await boardFixture(page, "dark");
  await page.goto("/p/CORP/board");
  const columns = page.locator(".board-columns");
  const card = page.locator('.board-card[data-issue-id="i2"]');
  await expect(card).toBeVisible();
  const top = async () => (await columns.boundingBox())!.y;
  const size = async () => { const box = (await card.boundingBox())!; return { width: box.width, height: box.height }; };
  const shadow = async () => card.evaluate(element => getComputedStyle(element).boxShadow);
  const initialTop = await top();
  const initialSize = await size();
  const initialShadow = await shadow();
  const countFont = await page.locator(".workspace-count").evaluate(element => getComputedStyle(element).fontSize);
  const expectStableTop = async () => expect(Math.abs((await top()) - initialTop)).toBeLessThan(1);
  const expectStableSize = async () => {
    const current = await size();
    // DOMRect values can differ by floating-point rounding after a transform.
    expect(current.width).toBeCloseTo(initialSize.width, 2);
    expect(current.height).toBeCloseTo(initialSize.height, 2);
  };

  await page.getByRole("button", { name: "Выделить", exact: true }).click();
  const hint = page.locator('.board-select-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Выбирайте карточки кликом");
  expect((await hint.boundingBox())!.y).toBeGreaterThan(height - 160);
  await expectStableTop();
  await expectStableSize();
  await card.click();
  await expect(card).toHaveAttribute("data-selected", "");
  await expectStableTop();
  await expectStableSize();
  expect(await shadow()).toBe(initialShadow);

  await page.getByRole("button", { name: "Выделить", exact: true }).click();
  await page.getByRole("button", { name: "Фильтр: Анна Смирнова" }).click();
  const summaryTrigger = page.getByRole("button", { name: /Фильтры:/ });
  const summaryDialog = page.getByRole("dialog", { name: "Фильтры" });
  await expect(summaryTrigger).toBeVisible();
  expect(await summaryTrigger.evaluate(element => getComputedStyle(element).fontSize)).toBe(countFont);
  await expectStableTop();
  await summaryTrigger.click();
  await expect(summaryDialog).toContainText("Исполнитель: Анна Смирнова");
  await summaryDialog.getByRole("button", { name: "Сбросить" }).click();
  await expect(summaryTrigger).toHaveCount(0);
  await expectStableTop();

  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await expectStableTop();
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page.getByRole("button", { name: "Просрочено", exact: true }).click();
  await expectStableTop();
  await page.getByRole("button", { name: "Просрочено", exact: true }).click();
  await page.getByRole("button", { name: "Без исполнителя", exact: true }).click();
  await expectStableTop();
  await page.getByRole("button", { name: "Без исполнителя", exact: true }).click();

  await page.getByRole("textbox", { name: "Фильтр задач" }).fill("Единая");
  await expectStableTop();

  await page.goto("/p/CORP/board?status=s1&priority=high");
  await expect(summaryTrigger).toBeVisible();
  await expectStableTop();
  await summaryTrigger.click();
  await expect(summaryDialog).toContainText("Статус: К выполнению");
  await expect(summaryDialog).toContainText("Приоритет: Высокий");
});

for (const theme of ["light", "dark"]) for (const [width, height] of [[1460, 720], [390, 844]]) {
  test(`selection preserves short and empty column backgrounds (${theme}, ${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const fixture = await boardFixture(page, theme);
    fixture.issues.splice(0, fixture.issues.length, ...fixture.issues.filter(issue => issue.statusId !== "s4"));
    for (const issue of fixture.issues) issue.title = `Задача ${issue.key}`;
    await page.goto("/p/CORP/board");
    const card = page.locator('.board-card[data-issue-id="i2"]');
    await expect(card).toBeVisible();
    const columns = page.locator(".board-col");
    const geometry = () => columns.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, background: getComputedStyle(element).backgroundColor };
    }));
    const before = await geometry();
    const expectUnchanged = async () => {
      const after = await geometry();
      expect(after).toHaveLength(before.length);
      after.forEach((column, index) => {
        for (const dimension of ["x", "y", "width", "height"] as const) expect(column[dimension], `column ${index}: ${dimension}`).toBeCloseTo(before[index][dimension], 2);
        expect(column.background).toBe(before[index].background);
      });
    };
    await page.screenshot({ path: test.info().outputPath("columns-before-selection.png") });
    const select = page.getByRole("button", { name: "Выделить", exact: true });
    await select.click();
    await expect(page.locator(".board-view")).toHaveAttribute("data-selecting", "true");
    await expectUnchanged();
    await card.click();
    await expect(page.locator(".list-selection-dock")).toBeVisible();
    await expectUnchanged();
    await page.screenshot({ path: test.info().outputPath("columns-during-selection.png") });
    await select.click();
    await expectUnchanged();
  });
}

for (const width of [1460, 390]) {
  test(`long columns scroll their last card clear of the selection dock (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    const fixture = await boardFixture(page, "dark");
    fixture.issues.splice(0, fixture.issues.length, ...fixture.issues.filter(issue => issue.statusId !== "s4"));
    for (const issue of fixture.issues) issue.title = `Задача ${issue.key}`;
    for (let index = 0; index < 24; index++) fixture.issues.push({
      ...fixture.issues[1], id: `extra${index}`, key: `CORP-${index + 20}`, title: `Дополнение ${index + 1}`, rank: index + 20,
    });
    await page.goto("/p/CORP/board");
    const first = page.locator('.board-card[data-issue-id="i2"]');
    await expect(first).toBeVisible();
    const lane = page.locator(".board-col").first();
    const before = (await lane.boundingBox())!;
    await page.getByRole("button", { name: "Выделить", exact: true }).click();
    await first.click();
    const dock = page.locator(".list-selection-dock");
    await expect(dock).toBeVisible();
    expect((await lane.boundingBox())!.height).toBeCloseTo(before.height, 2);
    const scrolling = width >= 768 ? lane.locator(".board-col-body") : page.locator(".board-scroll");
    expect(await scrolling.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await scrolling.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const last = width >= 768 ? lane.locator(".board-card").last() : page.locator(".board-card").last();
    await expect(last).toBeVisible();
    await expect.poll(async () => {
      const card = (await last.boundingBox())!, panel = (await dock.boundingBox())!;
      return card.y + card.height <= panel.y;
    }).toBe(true);
    await last.click();
    await expect(last).toHaveAttribute("data-selected", "");
  });
}

for (const [width, lang] of [[1460, "ru"], [390, "en"]] as const) {
  test(`selection hint is compact and stays dismissed after reload (${lang}, ${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boardFixture(page, "dark", 4, lang);
    const hints: string[] = [];
    await page.route("**/api/me/onboarding", route => route.fulfill({ json: { done: [], hidden: true, hints } }));
    await page.route("**/api/me/hints/board-select/dismiss", route => {
      expect(route.request().method()).toBe("POST");
      hints.push("board-select");
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto("/p/CORP/board");
    const select = page.getByRole("button", { name: lang === "ru" ? "Выделить" : "Select", exact: true });
    const hint = page.locator(".board-select-hint");
    await select.click();
    await expect(hint).toBeVisible();
    expect(parseFloat(await hint.evaluate(element => getComputedStyle(element).fontSize))).toBeLessThanOrEqual(13.5);
    const box = (await hint.boundingBox())!;
    expect(box.width).toBeLessThan(440);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath("compact-selection-hint.png") });
    await hint.getByRole("button").click();
    await expect(hint).toHaveCount(0);
    await expect(page.locator(".board-view")).toHaveAttribute("data-selecting", "true");
    await expect.poll(() => hints).toEqual(["board-select"]);
    await select.click();
    await select.click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await select.click();
    await expect(hint).toHaveCount(0);
  });
}
