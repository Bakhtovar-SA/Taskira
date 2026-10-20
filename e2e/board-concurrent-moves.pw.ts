import { expect, test } from "@playwright/test";
import { boardFixture } from "./board-fixture";
import { loadMotion, settle } from "./motion-helpers";

test("two keyboard transfers retain both flights when delayed responses arrive in reverse order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await boardFixture(page);
  let secondReturned!: () => void;
  const second = new Promise<void>(resolve => { secondReturned = resolve; });
  for (const id of ["i1", "i2"]) {
    const issue = fixture.issues.find(item => item.id === id)!;
    await page.route("**/api/projects/p1/issues/" + id, route => route.request().method() === "GET" ? route.fulfill({ json: issue }) : route.fallback());
    await page.route("**/api/projects/p1/issues/" + id + "/transition", async route => {
      // Both requests spend 600 ms on the wire; the first response also waits for the second.
      await new Promise(resolve => setTimeout(resolve, 600));
      if (id === "i1") await second;
      issue.statusId = route.request().postDataJSON().to;
      issue.updatedAt = "2026-10-15T00:00:00Z";
      await route.fulfill({ json: issue });
      if (id === "i2") secondReturned();
    });
  }
  await loadMotion(page, () => page.goto("/p/CORP/board"));
  for (const id of ["i1", "i2"]) {
    await page.locator('article[data-issue-id="' + id + '"] .board-card-open').focus();
    await page.keyboard.press("m");
    await page.getByRole("menuitem", { name: "В работе", exact: true }).click();
  }
  await expect.poll(() => page.locator(".flip-flight").allTextContents(), { timeout: 10_000 }).toEqual(expect.arrayContaining([
    expect.stringContaining("CORP-1"), expect.stringContaining("CORP-2"),
  ]));
  const lifted = await page.locator(".flip-flight > article").evaluateAll(clones => clones.map(clone => ({
    key: clone.querySelector(".board-card-key")?.textContent?.trim(),
    startsLifted: clone.getAnimations().some(animation => animation.effect instanceof KeyframeEffect &&
      String(animation.effect.getKeyframes()[0]?.transform ?? "").includes("scale(1.035)")),
  })));
  expect(lifted).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "CORP-1", startsLifted: true }),
    expect.objectContaining({ key: "CORP-2", startsLifted: true }),
  ]));
  await settle(page);
  await expect(page.locator(".flip-flight")).toHaveCount(0);
  for (const id of ["i1", "i2"]) {
    await expect(page.locator('article[data-issue-id="' + id + '"]')).toBeVisible();
  }
});
