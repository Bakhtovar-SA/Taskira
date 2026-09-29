/** Справка (трек E): русская и английская версии — один набор разделов в одном порядке, и у каждого пункта меню
 *  есть свой раздел на странице. Тексты разделов пишутся руками на двух языках; тест не даёт им разойтись по составу. */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { I18nProvider, loadLang } from "../i18n";
import DocsView, { EN_SECTIONS, SECTIONS } from "./DocsView";

afterEach(() => {
  cleanup();
  localStorage.clear();
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
