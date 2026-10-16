import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useSkeletonReveal } from "./useSkeletonReveal";

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("./motion", () => ({ motionReduced: () => reduced.value }));
afterEach(() => { cleanup(); reduced.value = false; });
function Probe({ scope = "p1:q1", loading = true, content = true, value = "row" }: { scope?: string; loading?: boolean; content?: boolean; value?: string }) {
  const reveal = useSkeletonReveal(scope, loading, content);
  return <div key={scope} ref={reveal.contentRef} data-testid="content">
    {loading ? <div key={scope} data-testid="skeleton" onAnimationStart={reveal.onSkeletonAnimationStart}><span data-testid="shimmer" /></div> : content ? <span data-testid="row">{value}</span> : "empty"}
  </div>;
}
function animation(node: Element, type: "animationstart" | "animationend" | "animationcancel", name: string) {
  // jsdom exposes WebkitAnimation styles but no AnimationEvent constructor;
  // React therefore delegates animationstart as webkitAnimationStart there.
  const emitted = type === "animationstart" && !("AnimationEvent" in window) && "WebkitAnimation" in document.createElement("div").style ? "webkitAnimationStart" : type;
  const event = new Event(emitted, { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  fireEvent(node, event);
}
const revealed = (node: HTMLElement) => node.classList.contains("anim-view");

test("first ready content and a response before skeletonLate start do not fade", () => {
  const fast = render(<Probe loading={false} />);
  expect(revealed(fast.getByTestId("content"))).toBe(false);
  fast.rerender(<Probe loading />);
  fast.rerender(<Probe loading={false} />);
  expect(revealed(fast.getByTestId("content"))).toBe(false);
});

test("bubbled shimmer and even a child's skeletonLate cannot mark the parent skeleton shown", () => {
  const screen = render(<Probe />);
  animation(screen.getByTestId("shimmer"), "animationstart", "shimmer");
  animation(screen.getByTestId("shimmer"), "animationstart", "skeletonLate");
  animation(screen.getByTestId("skeleton"), "animationstart", "shimmer");
  screen.rerender(<Probe loading={false} />);
  expect(revealed(screen.getByTestId("content"))).toBe(false);
});

test("an actual skeletonLate gives one opacity reveal; only the container's own viewIn ends it", () => {
  const screen = render(<Probe />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  screen.rerender(<Probe loading={false} />);
  const node = screen.getByTestId("content");
  expect(revealed(node)).toBe(true);
  animation(screen.getByTestId("row"), "animationend", "viewIn");
  animation(node, "animationend", "shimmer");
  expect(revealed(node)).toBe(true);
  animation(node, "animationend", "viewIn");
  expect(revealed(node)).toBe(false);
  screen.rerender(<Probe loading={false} value="revalidated" />);
  expect(screen.getByTestId("row").textContent).toBe("revalidated");
  expect(revealed(node)).toBe(false);
});

test("query/project identity resets a shown skeleton before a fast replacement response", () => {
  const screen = render(<Probe scope="p1:q1" />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  screen.rerender(<Probe scope="p2:q2" />);
  screen.rerender(<Probe scope="p2:q2" loading={false} />);
  expect(revealed(screen.getByTestId("content"))).toBe(false);
});

test("a second loading cycle must independently show its skeleton; ordinary updates never replay", () => {
  const screen = render(<Probe />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  screen.rerender(<Probe loading={false} />);
  animation(screen.getByTestId("content"), "animationend", "viewIn");
  screen.rerender(<Probe />);
  screen.rerender(<Probe loading={false} />);
  expect(revealed(screen.getByTestId("content"))).toBe(false);
  screen.rerender(<Probe />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  screen.rerender(<Probe loading={false} />);
  expect(revealed(screen.getByTestId("content"))).toBe(true);
});

test("empty/error completion consumes the shown skeleton and cannot reveal a later revalidation", () => {
  const screen = render(<Probe />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  screen.rerender(<Probe loading={false} content={false} />);
  screen.rerender(<Probe loading={false} content />);
  expect(revealed(screen.getByTestId("content"))).toBe(false);
});

test("reduce does not record zero-duration skeleton starts or defer a reveal until reduce is disabled", () => {
  reduced.value = true;
  const screen = render(<Probe />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  screen.rerender(<Probe loading={false} />);
  reduced.value = false;
  screen.rerender(<Probe loading={false} value="updated" />);
  expect(revealed(screen.getByTestId("content"))).toBe(false);
});

test("reduce at response time suppresses a skeleton that was shown before the preference changed", () => {
  const screen = render(<Probe />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  reduced.value = true;
  screen.rerender(<Probe loading={false} />);
  reduced.value = false;
  screen.rerender(<Probe loading={false} value="updated" />);
  expect(revealed(screen.getByTestId("content"))).toBe(false);
});

test("animation cancellation consumes the reveal, so a later render cannot restart it", () => {
  const screen = render(<Probe />);
  animation(screen.getByTestId("skeleton"), "animationstart", "skeletonLate");
  screen.rerender(<Probe loading={false} />);
  expect(revealed(screen.getByTestId("content"))).toBe(true);
  animation(screen.getByTestId("content"), "animationcancel", "viewIn");
  screen.rerender(<Probe loading={false} value="updated" />);
  expect(revealed(screen.getByTestId("content"))).toBe(false);
});

test("an existing parent can own the reveal without a new wrapper; its other classes survive cleanup", () => {
  function Existing({ loading }: { loading: boolean }) {
    const reveal = useSkeletonReveal("q", loading, true);
    return <div data-testid="parent" className="existing-flex-body">
      {loading && <div data-testid="late" onAnimationStart={reveal.onSkeletonAnimationStart} />}
      <div ref={node => { reveal.contentRef.current = node ? node.parentElement as HTMLDivElement : null; }} />
    </div>;
  }
  const screen = render(<Existing loading />);
  const parent = screen.getByTestId("parent");
  animation(screen.getByTestId("late"), "animationstart", "skeletonLate");
  screen.rerender(<Existing loading={false} />);
  expect(revealed(parent)).toBe(true);
  expect(parent.classList.contains("existing-flex-body")).toBe(true);
  animation(parent, "animationend", "viewIn");
  expect(parent.className).toBe("existing-flex-body");
  screen.unmount();
  expect(parent.className).toBe("existing-flex-body");
});