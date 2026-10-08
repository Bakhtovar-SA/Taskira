/** Справка (трек E): русская и английская версии — один набор разделов в одном порядке, и у каждого пункта меню
 *  есть свой раздел на странице. Тексты разделов пишутся руками на двух языках; тест не даёт им разойтись по составу. */
import { afterEach, expect, test, vi } from "vitest";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { I18nProvider, loadLang } from "../i18n";
import DocsView, { EN_SECTIONS, SECTIONS } from "./DocsView";
import { helpCopy } from "../i18n/help";
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

test("разделы RU и EN совпадают по id и порядку", () => {
  expect(EN_SECTIONS.map(([id]) => id)).toEqual(SECTIONS.map((s) => s.id));
});

test("русская справка: у каждого пункта меню есть раздел", () => {
  render(
    <I18nProvider>
      <DocsView />
    </I18nProvider>,
  );
  for (const s of SECTIONS) expect(document.getElementById(`doc-${s.id}`), s.id).not.toBeNull();
});

test("английская справка: у каждого пункта меню есть раздел", async () => {
  localStorage.setItem("taskira.lang", "en");
  await loadLang("en");
  render(
    <I18nProvider>
      <DocsView />
    </I18nProvider>,
  );
  await waitFor(() => expect(document.getElementById("doc-en-overview")).not.toBeNull());
  for (const [id] of EN_SECTIONS) expect(document.getElementById(`doc-en-${id}`), id).not.toBeNull();
});


test("help has matching complete structure and tables in both languages", async () => {
  const { helpCopy } = await import("../i18n/help");
  expect(helpCopy.en.sections.map(s => [s.id, s.paragraphs.length, s.table?.rows.length, !!s.code, s.links?.length])).toEqual(
    helpCopy.ru.sections.map(s => [s.id, s.paragraphs.length, s.table?.rows.length, !!s.code, s.links?.length]));
  for (const lang of ["ru", "en"] as const) {
    for (const id of ["calendar", "templates", "appearance", "recurring", "tokens", "webhooks", "backup"]) expect(helpCopy[lang].sections.find(s => s.id === id)?.paragraphs.length).toBeGreaterThan(1);
  }
});

test.each(["ru", "en"] as const)("help follows initial and changed hashes in %s", async lang => {
  localStorage.setItem("taskira.lang", lang); await loadLang(lang);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const scroll = vi.fn(); Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  window.history.replaceState(null, "", "/help#webhooks");
  const view = render(<I18nProvider><DocsView /></I18nProvider>);
  const prefix = lang === "en" ? "doc-en-" : "doc-";
  await waitFor(() => expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById(`${prefix}webhooks`)));
  window.history.replaceState(null, "", "/help#backup"); window.dispatchEvent(new HashChangeEvent("hashchange"));
  await waitFor(() => expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById(`${prefix}backup`)));
  const calls = scroll.mock.calls.length;
  for (const hash of ["#%", "#%22%5D", "#missing"]) {
    window.history.replaceState(null, "", `/help${hash}`); window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  expect(scroll).toHaveBeenCalledTimes(calls);
  view.unmount(); window.history.replaceState(null, "", "/help#tokens"); window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(scroll).toHaveBeenCalledTimes(calls);
});

test("documented HMAC verifier accepts rotation and rejects malformed or expired signatures", () => {
  const code = helpCopy.en.sections.find(s => s.id === "webhooks")!.code!;
  expect(code).toBe(helpCopy.ru.sections.find(s => s.id === "webhooks")!.code);
  const verify = new Function("createHmac", "timingSafeEqual", code.replace(/^import[^\n]+\n/, "") + "\nreturn verifySignature;")(createHmac, timingSafeEqual) as (header: string, secret: string, body: Buffer) => boolean;
  const secret = "fixture-only", body = Buffer.from('{"version":1}'), now = Math.floor(Date.now() / 1000);
  const signature = (time: number) => createHmac("sha256", secret).update(`${time}.`).update(body).digest("hex");
  expect(verify(`t=${now},v1=${signature(now)}`, secret, body)).toBe(true);
  expect(verify(`t=${now},v1=${"0".repeat(64)},v1=${signature(now)}`, secret, body)).toBe(true);
  for (const header of [`t=${now},v1=a`, `t=${now},v1=${"g".repeat(64)}`, `t=${now - 301},v1=${signature(now - 301)}`, `t=NaN,v1=${signature(now)}`, `t=${now},v1=${"0".repeat(64)}`]) {
    expect(verify(header, secret, body), header).toBe(false);
  }
  expect(verify(`t=${now},v1=${signature(now)}`, secret, Buffer.from('{"version":2}'))).toBe(false);
  for (const bytes of [Buffer.from('{"name":"Привет 🌍"}'), Buffer.from([0x7b, 0xff, 0xc3, 0x28, 0x7d])]) {
    const signed = createHmac("sha256", secret).update(`${now}.`).update(bytes).digest("hex");
    expect(verify(`t=${now},v1=${signed}`, secret, bytes)).toBe(true);
    const changed = Buffer.from(bytes); changed[0] ^= 1;
    expect(verify(`t=${now},v1=${signed}`, secret, changed)).toBe(false);
  }
});

test("help keeps the requested section highlighted at the scroll limit until manual scrolling", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  const view = render(<I18nProvider><DocsView /></I18nProvider>);
  const root = view.container.firstElementChild as HTMLElement;
  Object.defineProperties(root, { scrollTop: { value: 200 }, clientHeight: { value: 800 }, scrollHeight: { value: 1000 } });
  fireEvent.click(view.getByRole("button", { name: "Интеграции и вебхуки" }));
  fireEvent.scroll(root);
  expect(view.getByRole("button", { name: "Интеграции и вебхуки" }).getAttribute("aria-current")).toBe("location");
  fireEvent.wheel(root);
  expect(view.getByRole("button", { name: "Резервные копии" }).getAttribute("aria-current")).toBe("location");
});
