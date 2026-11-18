import { afterEach, beforeEach, vi } from "vitest";

/** jsdom 30.1 hides closed popovers and rejects focus inside them, but has no Popover API.
 * Model visibility only for keyboard unit tests; Playwright covers native top-layer behaviour. */
export function mockPopoverVisibility(): void {
  let restore = () => {};
  beforeEach(() => {
    const proto = HTMLElement.prototype;
    if (typeof proto.showPopover === "function") return;
    const show = Object.getOwnPropertyDescriptor(proto, "showPopover");
    const hide = Object.getOwnPropertyDescriptor(proto, "hidePopover");
    const open = new WeakSet<HTMLElement>();
    const displays = new WeakMap<HTMLElement, string>();
    const nativeMatches = proto.matches;
    const matches = vi.spyOn(proto, "matches").mockImplementation(function (this: HTMLElement, selector) {
      return selector === ":popover-open" ? open.has(this) : nativeMatches.call(this, selector);
    });
    Object.defineProperties(proto, {
      showPopover: { configurable: true, value(this: HTMLElement) {
        if (open.has(this)) return;
        displays.set(this, this.style.display);
        open.add(this);
        this.style.display = "block";
      } },
      hidePopover: { configurable: true, value(this: HTMLElement) {
        if (!open.has(this)) return;
        open.delete(this);
        this.style.display = displays.get(this) ?? "";
      } },
    });
    restore = () => {
      matches.mockRestore();
      if (show) Object.defineProperty(proto, "showPopover", show);
      else Reflect.deleteProperty(proto, "showPopover");
      if (hide) Object.defineProperty(proto, "hidePopover", hide);
      else Reflect.deleteProperty(proto, "hidePopover");
    };
  });
  afterEach(() => { restore(); restore = () => {}; });
}
