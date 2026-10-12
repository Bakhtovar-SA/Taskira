import { expect, test, type Locator } from "@playwright/test";
import { issueFixture } from "./issue-fixture";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function expectAboveDialog(host: Locator) {
  const page = host.page();
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId: toastHost } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[popover="manual"][aria-hidden="true"]' });
    const { nodeIds } = await session.send("DOM.getTopLayerElements");
    expect(nodeIds.at(-1)).toBe(toastHost);
  } finally {
    await session.detach();
  }
}

for (const [theme, width] of [["light", 1280], ["dark", 390]] as const) {
  test(`toasts stay above dialogs without reopening on queue updates (${theme}, ${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await issueFixture(page, theme);
    await page.goto("/p/CORP/board");
    await page.locator('.board-card[data-issue-id="i1"]').click();
    await expect(page.locator(".issue-detail")).toBeVisible();
    const host = page.locator('[popover="manual"][aria-hidden="true"]');
    const toasts = host.locator("[data-toast-id]");
    const announcer = page.locator('dialog[open]').getByRole("status", { name: "Уведомления" });
    await expect(announcer).toBeEmpty();
    expect(await host.evaluate(element => element.matches(":popover-open"))).toBe(true);
    await host.evaluate(element => {
      element.setAttribute("data-toggle-count", "0");
      element.addEventListener("beforetoggle", () => {
        element.setAttribute("data-toggle-count", String(Number(element.getAttribute("data-toggle-count")) + 1));
      });
    });
    const copy = async () => {
      if (width < 600) {
        await page.getByRole("button", { name: "Действия", exact: true }).click();
        await page.getByRole("menuitem", { name: "Скопировать ссылку" }).click();
      } else {
        await page.getByRole("button", { name: "Скопировать ссылку" }).first().click();
      }
    };
    await copy();
    await expect(toasts).toHaveCount(1);
    await expect(toasts.first()).toBeVisible();
    await expectAboveDialog(host);
    await expect(announcer).toContainText("Ссылка на CORP-1 скопирована");
    const session = await page.context().newCDPSession(page);
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    expect(nodes.some(node => !node.ignored && node.role?.value === "status")).toBe(true);
    expect(nodes.some(node => !node.ignored && node.name?.value?.includes("Ссылка на CORP-1 скопирована"))).toBe(true);
    await session.detach();
    await toasts.first().evaluate(element => {
      (window as Window & { toastAnimation?: Animation }).toastAnimation = element.getAnimations()[0];
    });
    await copy();
    await expect(toasts).toHaveCount(2);
    await expect(host).toHaveAttribute("data-toggle-count", "0");
    expect(await toasts.first().evaluate(element =>
      element.getAnimations()[0] === (window as Window & { toastAnimation?: Animation }).toastAnimation,
    )).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".issue-detail")).toHaveCount(0);
    // Re-stack while the entrance is midway through, not just after it finishes.
    const animationTime = await toasts.first().evaluate(element => {
      const animation = element.getAnimations()[0];
      animation.pause();
      animation.currentTime = 100;
      (window as Window & { toastAnimation?: Animation }).toastAnimation = animation;
      return Number(animation.currentTime);
    });
    await page.keyboard.press("Control+k");
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expectAboveDialog(host);
    expect(await toasts.first().evaluate(element => Number(element.getAnimations()[0]?.currentTime ?? 0))).toBeGreaterThanOrEqual(animationTime);
    expect(await toasts.first().evaluate(element =>
      element.getAnimations()[0] === (window as Window & { toastAnimation?: Animation }).toastAnimation,
    )).toBe(true);
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await expect(host).toHaveAttribute("data-toggle-count", "2");
    // Changing the active dialog must not announce an already visible toast again.
    await expect(announcer).toBeEmpty();
    await page.screenshot({ path: test.info().outputPath("toast-above-dialog.png") });
    await expect(toasts).toHaveCount(0, { timeout: 6000 });
    expect(await host.evaluate(element => element.matches(":popover-open"))).toBe(true);
    await expect(announcer).toBeEmpty();
    await expect(host).toHaveAttribute("data-toggle-count", "2");
  });
}
