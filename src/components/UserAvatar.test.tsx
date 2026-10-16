import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { UserAvatar, UserAvatarGroup } from "./UserAvatar";
import { colleagueColorVars } from "../ds/ColleaguePortrait";

afterEach(cleanup);

const ann = { id: "u1", name: "Анна Смирнова" };
const bob = { id: "u2", name: "Борис Петров", initials: "БП" };
const eve = { id: "u3", name: "Ева Орлова" };
const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

test("человек без фото — портрет с доступным именем; без человека — «не назначен»", () => {
  wrap(
    <>
      <UserAvatar user={bob} size={22} />
      <UserAvatar user={ann} />
      <UserAvatar user={null} />
    </>,
  );
  expect(screen.getByRole("img", { name: "Борис Петров" }).querySelector(".ds-av-portrait")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Анна Смирнова" }).querySelector(".ds-av-portrait")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Не назначен" }).className).toContain("ds-av-empty");
});

test("портрет закреплён за ID и не меняется при переименовании", () => {
  const first = wrap(<UserAvatar user={ann} />);
  const portrait = first.container.querySelector(".ds-av-portrait")?.innerHTML;
  const hue = first.container.querySelector<HTMLElement>(".ds-av-colleague")?.style.getPropertyValue("--portrait-hue");
  const accentHue = first.container.querySelector<HTMLElement>(".ds-av-colleague")?.style.getPropertyValue("--portrait-accent-hue");
  first.rerender(<I18nProvider><UserAvatar user={{ ...ann, name: "Anna Smirnova" }} /></I18nProvider>);
  expect(first.container.querySelector(".ds-av-portrait")?.innerHTML).toBe(portrait);
  expect(first.container.querySelector<HTMLElement>(".ds-av-colleague")?.style.getPropertyValue("--portrait-hue")).toBe(hue);
  expect(first.container.querySelector<HTMLElement>(".ds-av-colleague")?.style.getPropertyValue("--portrait-accent-hue")).toBe(accentHue);
});

test("палитра коллег использует широкий диапазон устойчивых сочетаний", () => {
  const palettes = Array.from({ length: 100 }, (_, i) => colleagueColorVars(`user-${i}`));
  expect(new Set(palettes.map(p => `${p["--portrait-hue"]}/${p["--portrait-accent-hue"]}`)).size).toBeGreaterThan(90);
  expect(new Set(palettes.map(p => p["--portrait-hue"])).size).toBeGreaterThan(70);
  expect(colleagueColorVars("user-17")).toEqual(colleagueColorVars("user-17"));
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
