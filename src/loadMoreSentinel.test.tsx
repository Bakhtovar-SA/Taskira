import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { useLoadMoreSentinel } from "./issuePages";

/**
 * Автоподгрузка по прокрутке держится на IntersectionObserver, колбэки которого
 * не приходят в фоновой вкладке (и которого нет в jsdom). Поэтому поведение хука
 * проверяем на подменённом наблюдателе: якорь появился в области — вызывается
 * loadMore; пока подгружать нечего — наблюдения нет; при размонтировании оно снято.
 */

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    public cb: (entries: { isIntersecting: boolean }[]) => void,
    public options?: { rootMargin?: string },
  ) {
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean) {
    this.cb([{ isIntersecting }]);
  }
}

function Probe({ loadMore, active, refreshKey, margin }: { loadMore: () => void; active: boolean; refreshKey: number; margin?: string }) {
  const ref = useLoadMoreSentinel(loadMore, active, refreshKey, margin);
  return <div ref={ref} data-testid="anchor" />;
}

const live = () => FakeObserver.instances.filter((o) => !o.disconnected);

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLoadMoreSentinel", () => {
  test("якорь в области видимости → loadMore; вне области → нет", () => {
    const loadMore = vi.fn();
    const ui = render(<Probe loadMore={loadMore} active refreshKey={1} />);
    const [obs] = live();
    expect(obs.observed).toHaveLength(1);
    obs.fire(false);
    expect(loadMore).not.toHaveBeenCalled();
    obs.fire(true);
    expect(loadMore).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  test("запас rootMargin передаётся наблюдателю", () => {
    const ui = render(<Probe loadMore={vi.fn()} active refreshKey={1} margin="200px" />);
    expect(live()[0].options?.rootMargin).toBe("200px");
    ui.unmount();
  });

  test("подгружать нечего (active = false) — наблюдения нет", () => {
    const ui = render(<Probe loadMore={vi.fn()} active={false} refreshKey={1} />);
    expect(live()).toHaveLength(0);
    ui.unmount();
  });

  test("после подгрузки (refreshKey изменился) наблюдение начинается заново, старое снято", () => {
    const loadMore = vi.fn();
    const ui = render(<Probe loadMore={loadMore} active refreshKey={1} />);
    const first = live()[0];
    ui.rerender(<Probe loadMore={loadMore} active refreshKey={2} />);
    expect(first.disconnected).toBe(true);
    expect(live()).toHaveLength(1);
    live()[0].fire(true); // якорь всё ещё в области (высокий экран) — подгрузка продолжается
    expect(loadMore).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  test("актуальный loadMore вызывается без пересоздания наблюдателя", () => {
    const a = vi.fn();
    const b = vi.fn();
    const ui = render(<Probe loadMore={a} active refreshKey={1} />);
    const obs = live()[0];
    ui.rerender(<Probe loadMore={b} active refreshKey={1} />);
    expect(live()[0]).toBe(obs);
    obs.fire(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  test("размонтирование снимает наблюдение; без IntersectionObserver хук молчит", () => {
    const ui = render(<Probe loadMore={vi.fn()} active refreshKey={1} />);
    const obs = live()[0];
    ui.unmount();
    expect(obs.disconnected).toBe(true);

    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    const ui2 = render(<Probe loadMore={vi.fn()} active refreshKey={1} />);
    expect(FakeObserver.instances).toHaveLength(1); // новых не создано
    ui2.unmount();
  });
});
