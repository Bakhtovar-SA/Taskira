import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { commentsApi } from "../api";
import MentionTextarea from "./MentionTextarea";

vi.mock("../api", () => ({ commentsApi: { mentionCandidates: vi.fn() } }));
// jsdom keeps native popovers hidden without a top-layer implementation.
vi.mock("../ds/floating", () => ({ useAnchored: vi.fn(), showPop: (element: HTMLElement | null) => element?.removeAttribute("popover"), hidePop: vi.fn() }));
const people = [
  { id: "p1", username: "ivan", name: "Иван Петров", initials: "ИП", color: "", jobRole: "" },
  { id: "p2", username: "anna", name: "Анна Иванова", initials: "АИ", color: "", jobRole: "" },
];
const submit = vi.fn();
const bubble = vi.fn();
function Composer({ maxLength = 4000 }: { maxLength?: number }) {
  const [value, setValue] = useState("");
  return <I18nProvider><div onKeyDown={bubble}><MentionTextarea projectId="project" issueId="issue"
    value={value} onValueChange={setValue} aria-label="Комментарий" maxLength={maxLength}
    onKeyDown={event => { if (event.ctrlKey && event.key === "Enter") submit(); }} /></div></I18nProvider>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.mocked(commentsApi.mentionCandidates).mockResolvedValue(people);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function type(text: string) {
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
  return input;
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(160); });

test("@ opens people; arrows and Enter select a real login without sending the comment", async () => {
  render(<Composer />);
  const input = type("Привет @");
  await settle();
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(commentsApi.mentionCandidates).toHaveBeenCalledWith("project", "issue", "", expect.any(AbortSignal));
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("Привет @anna ");
  expect(input.selectionStart).toBe(input.value.length);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

test("mouse selection preserves text and focus; Ctrl+Enter still submits", async () => {
  render(<Composer />);
  const input = type("@Ив"); await settle();
  const option = screen.getByRole("option", { name: /Иван Петров/ });
  fireEvent.mouseDown(option); fireEvent.click(option);
  expect(input.value).toBe("@ivan ");
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(submit).toHaveBeenCalledOnce();
});

test("Escape dismisses only suggestions and email never opens them", async () => {
  render(<Composer />); const input = type("@"); await settle(); bubble.mockClear();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull(); expect(bubble).not.toHaveBeenCalled();
  type("me@example.com"); await settle();
  expect(commentsApi.mentionCandidates).toHaveBeenCalledTimes(1);
});

test("out-of-order results cannot select someone from the previous query", async () => {
  let older!: (items: typeof people) => void;
  vi.mocked(commentsApi.mentionCandidates).mockImplementationOnce(() => new Promise(resolve => { older = resolve; }));
  render(<Composer />); type("@ив"); await settle(); type("@ан"); await settle();
  await act(async () => { older([people[0]]); });
  expect(commentsApi.mentionCandidates).toHaveBeenLastCalledWith("project", "issue", "ан", expect.any(AbortSignal));
  expect(screen.getAllByRole("option")).toHaveLength(2);
});

test("overlength insertion preserves the draft instead of truncating the mention", async () => {
  render(<Composer maxLength={5} />); const input = type("@"); await settle();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("@");
  expect(screen.getByText(/не хватает места/)).toBeTruthy();
});

test("search errors offer retry and never discard the comment draft", async () => {
  vi.mocked(commentsApi.mentionCandidates).mockRejectedValueOnce(new Error("offline"));
  render(<Composer />); const input = type("Привет @ив"); await settle();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" })); await settle();
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(input.value).toBe("Привет @ив");
});
