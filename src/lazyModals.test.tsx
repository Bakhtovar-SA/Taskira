import { Suspense, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { lazyWithPreload } from "./lazyModals";

/** PERF-BUDGET п. 3: предзагрузка ленивых модалок — один импорт на чанк, повтор после ошибки, `lazy()` не сломан. */

afterEach(() => cleanup());

const Hello = ({ name }: { name: string }) => <p>Привет, {name}</p>;

describe("lazyWithPreload", () => {
  test("completed preload renders immediately without the fallback", async () => {
    const C = lazyWithPreload(async () => ({ default: Hello }));
    C.preload();
    await act(async () => { await Promise.resolve(); });
    render(<Suspense fallback={<p>loading</p>}><C name="мир" /></Suspense>);
    expect(screen.queryByText("loading")).toBeNull();
    expect(screen.getByText("Привет, мир")).toBeTruthy();
  });

  test("cold loading preserves component state after a parent rerender", async () => {
    function Counter({ name }: { name: string }) {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>{name}: {count}</button>;
    }
    const C = lazyWithPreload(async () => ({ default: Counter }));
    const tree = (name: string) => <Suspense fallback={<p>loading</p>}><C name={name} /></Suspense>;
    const ui = render(tree("first"));
    fireEvent.click(await screen.findByText("first: 0"));
    ui.rerender(tree("second"));
    expect(screen.getByText("second: 1")).toBeTruthy();
  });

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
