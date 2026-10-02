import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";

const { upload, crop } = vi.hoisted(() => ({ upload: vi.fn(), crop: vi.fn() }));
vi.mock("../avatarCrop", () => ({ cropAndResizeAvatar: crop }));
vi.mock("../store", () => ({ useStore: () => ({
  data: { currentUserId: "u1" }, idx: { users: new Map([["u1", { id: "u1", name: "Test User", role: "", username: "test", avatarUpdatedAt: null }]]) },
  uploadAvatar: upload, removeAvatar: vi.fn(),
}) }));
import { UserCardBody } from "./UserAvatar";
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function pick(file: File) {
  const { container } = render(<I18nProvider><UserCardBody userId="u1" /></I18nProvider>);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.accept).toBe(".png,.jpg,.jpeg,.gif");
  fireEvent.change(input, { target: { files: [file] } });
}

test.each(["photo.svg", "photo.webp", "photo.exe", "photo.txt", "photo.png.exe", "no-extension"])("rejects original extension before cropping: %s", name => {
  pick(new File(["image"], name, { type: "image/png" }));
  expect(screen.getByRole("alert").textContent).toContain("PNG, JPG/JPEG и GIF");
  expect(crop).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});

test.each(["photo.PNG", "photo.jpg", "photo.JPEG", "photo.gif"])("processes supported original extension: %s", async name => {
  const processed = new File(["processed"], "avatar.jpg", { type: "image/jpeg" });
  crop.mockResolvedValue(processed);
  pick(new File(["image"], name));
  await waitFor(() => expect(upload).toHaveBeenCalledWith(processed));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("an unreadable image displays an error without changing the avatar", async () => {
  crop.mockRejectedValue(new Error("unreadable"));
  pick(new File(["broken"], "photo.png", { type: "image/png" }));
  await screen.findByRole("alert");
  expect(upload).not.toHaveBeenCalled();
});
