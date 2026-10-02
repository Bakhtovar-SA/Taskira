import { expect, test } from "vitest";
import { BRAND_EXTRA_HUES, BRAND_HUE } from "../src/contract.js";
import { mailAccent, whiteContrast } from "../src/services/mailBrand.js";
import { renderOne, renderDigest } from "../src/services/emailTemplates.js";
test("all email accent colours retain white text contrast after RGB conversion", () => {
  for (const hue of [...Array.from({ length: BRAND_HUE.max - BRAND_HUE.min + 1 }, (_, n) => n + BRAND_HUE.min), ...BRAND_EXTRA_HUES]) {
    const color = mailAccent(hue);
    expect(color).toMatch(/^#[0-9a-f]{6}$/); expect(whiteContrast(color)).toBeGreaterThanOrEqual(4.5);
  }
});
test.each(["ru", "en"] as const)("branded deadline email and digest expose only explicit deadline metadata (%s)", lang => {
  const item = { type: "issue.dueSoon" as const, issueKey: "P-99", projectKey: "P", projectId: "p", issueId: "i", dueDate: "2026-10-10" };
  const brand = { name: "A & B <Company>", accent: mailAccent(145) };
  for (const mail of [renderOne("https://taskira.megafon.tj", item, lang, brand), renderDigest("https://taskira.megafon.tj", [item], lang, brand)]) {
    expect(mail.html).toContain("A &amp; B &lt;Company&gt;");
    expect(mail.html).toContain("2026-10-10"); expect(mail.text).toContain("2026-10-10");
    expect(mail.html).toContain("https://taskira.megafon.tj/p/P/issue/P-99");
    expect(mail.html).not.toContain("<img"); expect(mail.html).not.toContain("<script");
    expect(mail.subject).toContain(brand.name);
  }
});
