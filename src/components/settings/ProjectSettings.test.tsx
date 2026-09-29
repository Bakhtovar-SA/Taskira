/** Характеризация переноса (ТЗ 5.9): настройки проекта переехали из «Департаментов» в «Настройки проекта»,
 *  но пишут теми же действиями стора и с тем же телом, что и прежние переключатели и поля в AdminView:
 *  `patchProject(id, { name })`, `{ isShared }`, `{ sprintsEnabled }`, `{ departmentId }`, `deleteProject(id)`. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n";

const patchProject = vi.fn();
const deleteProject = vi.fn();
vi.mock("../../store", () => ({
  useStore: () => ({
    data: {
      currentProjectId: "p1",
      project: { key: "CORP", name: "Корпоративные задачи", description: "" },
      projects: [{ id: "p1", key: "CORP", name: "Корпоративные задачи", departmentId: "d1", isShared: false, sprintsEnabled: false }],
      departments: [
        { id: "d1", name: "Общий отдел" },
        { id: "d2", name: "Отдел персонала" },
      ],
    },
    patchProject,
    deleteProject,
    openIssue: vi.fn(),
    can: () => false,
    toast: vi.fn(),
  }),
}));
vi.mock("../../api", () => ({ issuesApi: { list: vi.fn(() => Promise.resolve({ items: [], hasMore: false, nextCursor: null })) } }));

import { ProjectSection } from "./ProjectSettings";

const renderSection = (section: string) =>
  render(
    <I18nProvider>
      <ProjectSection section={section} />
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
  patchProject.mockClear();
  deleteProject.mockClear();
});

describe("Настройки проекта — те же действия, что в прежних «Департаментах»", () => {
  test("Общее: название сохраняется patchProject(id, { name }), пустое — не сохраняется", () => {
    renderSection("general");
    const name = screen.getByRole("textbox", { name: "Название" });
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(patchProject).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "Портал" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(patchProject).toHaveBeenCalledWith("p1", { name: "Портал" });
  });

  test("Общее: «Общий проект» и отдел", () => {
    renderSection("general");
    fireEvent.click(screen.getByRole("switch"));
    expect(patchProject).toHaveBeenCalledWith("p1", { isShared: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Команда" }), { target: { value: "d2" } });
    expect(patchProject).toHaveBeenCalledWith("p1", { departmentId: "d2" });
  });

  test("Модули: спринты — patchProject(id, { sprintsEnabled })", () => {
    renderSection("modules");
    fireEvent.click(screen.getByRole("switch", { name: /Спринты/ }));
    expect(patchProject).toHaveBeenCalledWith("p1", { sprintsEnabled: true });
  });

  test("Архив и удаление: удаление только после ввода ключа", () => {
    renderSection("archive");
    fireEvent.click(screen.getByRole("button", { name: "Удалить проект" }));
    const confirmBtn = () => screen.getAllByRole("button", { name: "Удалить проект" }).at(-1)!;
    fireEvent.click(confirmBtn());
    expect(deleteProject).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Введите ключ CORP/ }), { target: { value: "corp" } });
    fireEvent.click(confirmBtn());
    expect(deleteProject).toHaveBeenCalledWith("p1");
  });
});
