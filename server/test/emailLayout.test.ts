import { expect, test } from "vitest";
import { renderDigest, renderOne, type MailItem } from "../src/services/emailTemplates.js";

const item: MailItem = { type: "issue.status", issueKey: "IB-7", projectId: "p1", issueId: "i1" };

test.each(["ru", "en"] as const)("email layout retains safe links, text and an Outlook width constraint (%s)", (lang) => {
  const mail = renderOne("https://taskira.megafon.tj", item, lang);
  expect(mail.html).toContain('<!--[if mso]><table role="presentation" width="600"');
  expect(mail.html).toContain('font-family:Arial,Helvetica,sans-serif');
  expect(mail.html).toContain('padding:12px 22px');
  expect(mail.html).toContain('href="https://taskira.megafon.tj/#/issue/p1/i1"');
  expect(mail.text).toContain("IB-7");
  expect(mail.html).toContain("IB-7");
});

test("single and digest emails escape references and URLs", () => {
  const unsafe = { ...item, issueKey: '<img src=x onerror="alert(1)"> & test' };
  for (const mail of [renderOne('https://t.example/?a="&b=1', unsafe), renderDigest('https://t.example/?a="&b=1', [unsafe])]) {
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; test');
    expect(mail.html).not.toContain('href="https://t.example/?a="');
  }
});

test("membership email opens the app and needs no issue content", () => {
  const mail = renderOne("https://t.example/", { type: "project.member", projectId: null, issueId: null }, "en");
  expect(mail.subject).toBe("Taskira · you were added to a project");
  expect(mail.html).toContain('href="https://t.example/#/"');
  expect(mail.html).not.toContain("undefined");
});
