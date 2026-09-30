import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { UserAvatar, UserAvatarGroup } from "./UserAvatar";

afterEach(cleanup);

const ann = { id: "u1", name: "Анна Смирнова" };
const bob = { id: "u2", name: "Борис Петров", initials: "БП" };
const eve = { id: "u3", name: "Ева Орлова" };
const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

test("человек — ds-аватар с именем и инициалами; без человека — «не назначен»", () => {
  wrap(
    <>
      <UserAvatar user={bob} size={22} />
      <UserAvatar user={ann} />
      <UserAvatar user={null} />
    </>,
  );
  expect(screen.getByRole("img", { name: "Борис Петров" }).textContent).toBe("БП");
  expect(screen.getByRole("img", { name: "Анна Смирнова" }).textContent).toBe("АС"); // инициалы из имени, если их нет
  expect(screen.getByRole("img", { name: "Не назначен" }).className).toContain("ds-av-empty");
});

test("группа показывает не больше max, остаток — «+N»; пустая — «не назначен»", () => {
  const { container } = wrap(<UserAvatarGroup users={[ann, bob, eve]} max={2} />);
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(container.textContent).toContain("+1");
  cleanup();
  wrap(<UserAvatarGroup users={[]} />);
  expect(screen.getByRole("img", { name: "Не назначен" })).toBeTruthy();
});

test("кликабельный аватар внутри кликабельной строки: клик и Enter не доходят до строки", () => {
  const onRow = vi.fn();
  wrap(
    <div role="row" onClick={onRow} onKeyDown={onRow}>
      <UserAvatar user={bob} interactive />
    </div>,
  );
  const btn = screen.getByRole("button", { name: "Борис Петров" });
  fireEvent.click(btn);
  fireEvent.keyDown(btn, { key: "Enter" });
  expect(onRow).not.toHaveBeenCalled();
  fireEvent.keyDown(btn, { key: "j" }); // прочие клавиши идут дальше (общие сочетания)
  expect(onRow).toHaveBeenCalledTimes(1);
});
