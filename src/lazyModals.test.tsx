import { Suspense } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { lazyWithPreload } from "./lazyModals";

/** PERF-BUDGET п. 3: предзагрузка ленивых модалок — один импорт на чанк, повтор после ошибки, `lazy()` не сломан. */

afterEach(() => cleanup());

const Hello = ({ name }: { name: string }) => <p>Привет, {name}</p>;

describe("lazyWithPreload", () => {
  test("preload() запускает импорт один раз; рендер после предзагрузки импорт не повторяет", async () => {
    const factory = vi.fn(async () => ({ default: Hello }));
    const C = lazyWithPreload(factory);
    expect(factory).not.toHaveBeenCalled(); // сам по себе модуль ничего не грузит
    C.preload();
    C.preload();
    expect(factory).toHaveBeenCalledTimes(1);
    await act(async () => {
      render(
        <Suspense fallback={<p>загрузка</p>}>
          <C name="мир" />
        </Suspense>,
      );
    });
    expect(screen.getByText("Привет, мир")).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("без предзагрузки работает как обычный lazy()", async () => {
    const factory = vi.fn(async () => ({ default: Hello }));
    const C = lazyWithPreload(factory);
    await act(async () => {
      render(
        <Suspense fallback={<p>загрузка</p>}>
          <C name="мир" />
        </Suspense>,
      );
    });
    expect(await screen.findByText("Привет, мир")).toBeTruthy();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("ошибка предзагрузки не всплывает и не залипает: следующая попытка грузит заново", async () => {
    const factory = vi
      .fn<() => Promise<{ default: typeof Hello }>>()
      .mockRejectedValueOnce(new Error("сеть"))
      .mockResolvedValue({ default: Hello });
    const C = lazyWithPreload(factory);
    C.preload();
    await act(async () => {
      await Promise.resolve();
    });
    C.preload();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
