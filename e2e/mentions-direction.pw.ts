import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boardFixture } from "./board-fixture";

for (const reduced of [false, true]) test(`direction picker ${reduced ? "respects reduced motion" : "animates its real height"}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await boardFixture(page, "dark");
  await page.goto("/p/CORP/board");
  await expect(page.locator('[data-issue-id="i1"]')).toBeVisible();
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Дополнительные поля", { exact: true }).click();
  const trigger = dialog.getByRole("button", { name: "Без направления", exact: true }).first();
  await trigger.click();
  const panel = dialog.locator(".create-direction-reveal");
  await expect(panel.getByRole("combobox", { name: "Направление" })).toBeVisible();
  if (reduced) {
    expect(await panel.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  } else {
    const heights = await panel.evaluate(element => {
      const animation = element.getAnimations().find(item => (item as CSSAnimation).animationName === "directionOpen")!;
      if (!animation) throw new Error("Direction reveal animation is missing");
      animation.pause();
      return [0, 150, 300].map(time => { animation.currentTime = time; return element.getBoundingClientRect().height; });
    });
    expect(heights[0]).toBeLessThan(2);
    expect(heights[1]).toBeGreaterThan(heights[0] + 2);
    expect(heights[2]).toBeGreaterThan(heights[1] + 2);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test("mentions offer people, preserve keyboard focus and post the selected login", async ({ page }) => {
  const fixture = await boardFixture(page, "dark");
  let posted = "";
  await page.route("**/issues/i1", route => route.fulfill({ json: {
    ...fixture.issues[0], epicId: null, attachments: [], links: [], checklist: [], customFieldValues: [], collaborators: [],
    watch: { watching: false, watchers: 0 }, subtasksSummary: { total: 0, done: 0 },
  } }));
  await page.route("**/issues/i1/activity", route => route.fulfill({ json: [] }));
  await page.route("**/issues/i1/collaborators", route => route.fulfill({ json: [] }));
  await page.route("**/mention-candidates*", route => route.fulfill({ json: [{
    id: "u2", username: "igor", name: "Игорь Петров", initials: "ИП", color: "", jobRole: "Разработчик",
  }] }));
  await page.route("**/issues/i1/comments", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    posted = route.request().postDataJSON().body;
    return route.fulfill({ status: 201, json: { id: "comment1", issueId: "i1", authorId: "u1",
      author: fixture.users[0], body: posted, createdAt: "2026-10-04T07:00:00Z" } });
  });
  await page.goto("/p/CORP/board");
  await page.locator('[data-issue-id="i1"] .board-card-open').click();
  const panel = page.getByRole("dialog");
  const comment = panel.getByRole("textbox", { name: "Комментарии", exact: true });
  await comment.fill("Привет @");
  const candidate = page.getByRole("option", { name: /Игорь Петров/ });
  await expect(candidate).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include(".mention-pop").analyze();
  expect(accessibility.violations).toEqual([]);
  await comment.press("Escape");
  await expect(candidate).toHaveCount(0);
  await expect(panel).toBeVisible();
  await comment.fill("Привет @иг");
  await expect(candidate).toBeVisible();
  await comment.press("Enter");
  await expect(comment).toHaveValue("Привет @igor ");
  await expect(comment).toBeFocused();
  await comment.press("Control+Enter");
  await expect.poll(() => posted).toBe("Привет @igor");
  await expect(comment).toHaveValue("");
  await expect(panel.getByText("@igor", { exact: true })).toBeVisible();
});
