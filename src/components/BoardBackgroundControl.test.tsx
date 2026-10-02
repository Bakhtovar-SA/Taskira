import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
const { save, prepare } = vi.hoisted(() => ({ save: vi.fn(), prepare: vi.fn() }));
vi.mock("../personalBoardPhoto", () => ({ saveBoardPhoto: save }));
vi.mock("../bgPhoto", () => ({ preparePhoto: prepare }));
import BoardBackgroundControl from "./BoardBackgroundControl";
afterEach(() => { cleanup(); vi.resetAllMocks(); });

test("file input stays mounted when the photo popup is closed", async () => {
  render(<I18nProvider><BoardBackgroundControl userId="u1" projectId="p1" hasPhoto /></I18nProvider>);
  const input = screen.getByLabelText("Загрузить фото");
  const blob = new Blob(["photo"], { type: "image/webp" });
  prepare.mockResolvedValue({ full: blob, luma: 0.4 });
  fireEvent.change(input, { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
  await waitFor(() => expect(save).toHaveBeenCalledWith("u1", "p1", { blob, luma: 0.4 }));
  expect(screen.getByLabelText("Загрузить фото")).toBe(input);
});

test("storage failure remains visible outside a closed popup", async () => {
  render(<I18nProvider><BoardBackgroundControl userId="u1" projectId="p1" hasPhoto /></I18nProvider>);
  prepare.mockResolvedValue({ full: new Blob(["new"]), luma: 0.4 });
  save.mockRejectedValue(new Error("QuotaExceededError"));
  fireEvent.change(screen.getByLabelText("Загрузить фото"), { target: { files: [new File(["new"], "photo.png", { type: "image/png" })] } });
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][2]).not.toBeNull();
});
