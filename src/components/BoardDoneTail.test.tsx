import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BoardDoneTail } from "./BoardDoneTail";
import { enter, motionReduced, stopMotion } from "../motion";
vi.mock("../motion", async original => ({ ...(await original<typeof import("../motion")>()), enter: vi.fn(), stopMotion: vi.fn(), motionReduced: vi.fn(() => false) }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(motionReduced).mockReturnValue(false); vi.stubGlobal("CSS", { escape: (id: string) => id }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Rows({ ids, loading, ready }: { ids: readonly string[]; loading: boolean; ready: (ids: readonly string[], loading: boolean) => void }) {
  useLayoutEffect(() => ready(ids, loading), [ids, loading, ready]);
  return <>{ids.map(id => <article key={id} data-issue-id={id}>{id}</article>)}</>;
}
const view = (ids: readonly string[], loading = false, animate = true) => <BoardDoneTail id="tail" animate={animate}>{ready => <Rows ids={ids} loading={loading} ready={ready}/>}</BoardDoneTail>;

test("an initial expanded URL is a baseline even when data arrives later", () => {
  const ui=render(view([],true,false));ui.rerender(view(["one"],false,false));
  expect(enter).not.toHaveBeenCalled();expect(ui.container.querySelector(".anim-done-tail")).toBeNull();
});
test("a deliberate expansion starts only after successful rows, and pagination/revalidation never replay it", () => {
  const ui=render(view([],true));ui.rerender(view([],false));expect(enter).not.toHaveBeenCalled();
  ui.rerender(view(["one","two"]));const root=ui.container.querySelector("[data-done-tail]")!;
  expect(vi.mocked(enter).mock.calls.map(([el])=>el.getAttribute("data-issue-id"))).toEqual(["one","two"]);
  expect(root.classList.contains("anim-done-tail")).toBe(true);
  fireEvent.animationEnd(root.querySelector("article")!);expect(root.classList.contains("anim-done-tail")).toBe(true);
  fireEvent.animationEnd(root);expect(root.classList.contains("anim-done-tail")).toBe(false);
  ui.rerender(view(["one","two","three"]));ui.rerender(view(["one","two","three"],true));ui.rerender(view(["one","two","three"]));
  expect(enter).toHaveBeenCalledTimes(2);expect(root.classList.contains("anim-done-tail")).toBe(false);
});
test.each([[8,8],[9,0]])("%i rows obey the shared entry cap (%i animated)",(count,expected)=>{
  render(view(Array.from({length:count},(_,i)=>"i"+i)));expect(enter).toHaveBeenCalledTimes(expected);
});
test("reduce keeps the data visible without child entry calls",()=>{
  vi.mocked(motionReduced).mockReturnValue(true);const ui=render(view(["one"]));
  expect(ui.container.querySelector("article")?.textContent).toBe("one");expect(enter).not.toHaveBeenCalled();expect(ui.container.querySelector(".anim-done-tail")).toBeNull();
});
test("native cancel clears the disclosure and unmount stops only its own rows",()=>{
  const ui=render(<><article data-issue-id="outside"/>{view(["one","two"])}</>);const root=ui.container.querySelector("[data-done-tail]")!;
  fireEvent(root,new Event("animationcancel",{bubbles:true}));expect(root.classList.contains("anim-done-tail")).toBe(false);
  ui.unmount();expect(vi.mocked(stopMotion).mock.calls.map(([el])=>el?.getAttribute("data-issue-id"))).toEqual(["one","two"]);
});
test("StrictMode does not queue a second entrance or retain detached rows",()=>{
  const ui=render(<StrictMode>{view(["one"])}</StrictMode>);expect(enter).toHaveBeenCalledTimes(1);ui.unmount();expect(stopMotion).toHaveBeenCalled();
});

test("an error retry disappearing restores the disclosure unless the user chose another control",()=>{
  const state=(showRetry:boolean,loading:boolean)=><><button id="tail-toggle">Disclosure</button><button id="elsewhere">Elsewhere</button><BoardDoneTail id="tail" animate>{ready=><><Rows ids={[]} loading={loading} ready={ready}/>{showRetry&&<button>Retry</button>}</>}</BoardDoneTail></>;
  const ui=render(state(true,false));const retry=ui.getByRole("button",{name:"Retry"});retry.focus();
  ui.rerender(state(false,true));expect(document.activeElement).toBe(ui.getByRole("button",{name:"Disclosure"}));
  ui.rerender(state(true,false));ui.getByRole("button",{name:"Retry"}).focus();ui.getByRole("button",{name:"Elsewhere"}).focus();
  ui.rerender(state(false,true));expect(document.activeElement).toBe(ui.getByRole("button",{name:"Elsewhere"}));
});
