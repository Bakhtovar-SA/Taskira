/** Трек E: сервер узнаёт язык интерфейса — на нём уходят письма. После входа и при переключении стор отправляет
 *  PUT /api/me/lang; до входа — нет. */
import { afterEach, expect, test, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { StoreProvider, useStore } from "./store";
import { I18nProvider, useT } from "./i18n";
import { authApi, departmentsApi, issuesApi, notificationsApi, projectsApi } from "./api";

const user = { id: "u1", username: "u1", name: "Анна", initials: "А", color: "#0B5FD9", jobRole: "", globalRole: "admin" as const, isActive: true, authSource: "local" as const };
const projects = [
  { id: "p1", key: "A", name: "П1", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false },
  { id: "p2", key: "B", name: "П2", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false },
];

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test("после входа — PUT /api/me/lang с языком интерфейса; переключили — ещё раз с новым", async () => {
  localStorage.setItem("taskira.token", "t");
  vi.spyOn(authApi, "me").mockResolvedValue(user as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue(projects as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(issuesApi, "assignedToMe").mockResolvedValue({ items: [], truncated: false, limit: 200 });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  const setLang = vi.spyOn(authApi, "setLang").mockResolvedValue(undefined);

  let store!: ReturnType<typeof useStore>;
  let i18n!: ReturnType<typeof useT>;
  function Probe() {
    store = useStore();
    i18n = useT();
    return null;
  }
  render(
    <I18nProvider>
      <StoreProvider>
        <Probe />
      </StoreProvider>
    </I18nProvider>,
  );
  expect(setLang).not.toHaveBeenCalled(); // до входа серверу нечего сообщать
  await act(async () => {
    await store.bootstrap();
  });
  expect(setLang).toHaveBeenLastCalledWith("ru");
  // Английский словарь — ленивый чанк: язык сменится, когда он загрузится.
  act(() => i18n.setLang("en"));
  await waitFor(() => expect(setLang).toHaveBeenLastCalledWith("en"));
});
