import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type Ref } from "react";
import { BoardFilterSummary } from "./BoardFilterSummary";
import { enter, stopMotion } from "../motion";
import type { PopoverProps } from "../ds/Overlay";
let forwarded: Ref<HTMLButtonElement> = null;
let replacement = 'stub';
vi.mock("../motion", () => ({ enter: vi.fn(), stopMotion: vi.fn() }));
vi.mock("../ds/LazyOverlay", () => ({ Popover: (props: PopoverProps) => <span key={replacement}>{props.trigger({ ref: forwarded, onClick: () => props.onOpenChange?.(!props.open), 'aria-expanded': !!props.open, 'aria-haspopup': 'dialog' }, !!props.open)}</span> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); forwarded = null; replacement = 'stub'; });
const summary = (open = false) => <BoardFilterSummary label="Filters" summary="4 / 9" open={open} onOpenChange={() => undefined}>Details</BoardFilterSummary>;

test("one pop per logical appearance, no replay on count, open state or lazy trigger replacement", () => {
  const view = render(summary()); expect(enter).toHaveBeenCalledTimes(1);
  view.rerender(summary(true)); expect(enter).toHaveBeenCalledTimes(1);
  replacement = 'real'; view.rerender(summary()); expect(enter).toHaveBeenCalledTimes(1);
  expect(stopMotion).toHaveBeenCalledTimes(1);
  view.unmount(); render(summary()); expect(enter).toHaveBeenCalledTimes(2);
});

test("React19 callback-ref cleanup and object ref both reach the actual trigger", () => {
  const dispose = vi.fn(); const callback = vi.fn(() => dispose); forwarded = callback;
  const view = render(summary()); const first = screen.getByRole('button');
  expect(callback).toHaveBeenCalledWith(first);
  const object = createRef<HTMLButtonElement>(); forwarded = object;
  view.rerender(summary()); expect(dispose).toHaveBeenCalledTimes(1); expect(object.current).toBe(first);
  view.unmount(); expect(object.current).toBeNull(); expect(dispose).toHaveBeenCalledTimes(1);
});

test("Popover trigger click, expanded state and accessible label survive ref composition", () => {
  const change = vi.fn(); render(<BoardFilterSummary label="Filters" summary="4 / 9" open={false} onOpenChange={change}>Details</BoardFilterSummary>);
  const button = screen.getByRole('button', { name: 'Filters: 4 / 9' }); fireEvent.click(button);
  expect(change).toHaveBeenCalledWith(true); expect(button.getAttribute('aria-haspopup')).toBe('dialog');
});
