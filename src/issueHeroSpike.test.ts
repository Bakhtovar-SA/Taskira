import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearIssueHeroSpike, prepareIssueHeroSpike, ISSUE_HERO_NAME } from "./issueHeroSpike";
import { setReducedMotion, viewTransition } from "./motion";
const name=(node:HTMLElement)=>node.style.getPropertyValue("view-transition-name");
function visible<T extends HTMLElement>(node:T):T {
 const rect=new DOMRect(0,0,70,20);const element:HTMLElement=node;vi.spyOn(element,"getClientRects").mockReturnValue(Object.assign([rect],{item:(i:number)=>i===0?rect:null}));return node;
}
function key(text="CORP-1") {const node=visible(document.createElement("b"));node.textContent=text;document.body.append(node);return node;}
beforeEach(()=>{vi.stubGlobal("matchMedia",()=>({matches:false}));vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");setReducedMotion(false);});
afterEach(()=>{clearIssueHeroSpike();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(document,"startViewTransition");});

test("source transfers only its short key, and both original inline values/priorities are restored",()=>{
 const source=key(),target=key();source.style.setProperty("view-transition-name","none","important");
 const tx=prepareIssueHeroSpike({scope:"page",source,target:()=>target})!;expect(name(source)).toBe(ISSUE_HERO_NAME);
 expect(tx.swap()).toBe(true);expect(name(source)).toBe("none");expect(source.style.getPropertyPriority("view-transition-name")).toBe("important");expect(name(target)).toBe(ISSUE_HERO_NAME);
 tx.cleanup();tx.cleanup();expect(name(target)).toBe("");
});
test("a stale cleanup cannot clear the newer owner on the same nodes",()=>{
 const source=key(),target=key();const first=prepareIssueHeroSpike({scope:"page",source,target:()=>target})!;
 const second=prepareIssueHeroSpike({scope:"page",source,target:()=>target})!;first.cleanup();expect(name(source)).toBe(ISSUE_HERO_NAME);
 expect(first.swap()).toBe(false);expect(second.swap()).toBe(true);first.cleanup();expect(name(target)).toBe(ISSUE_HERO_NAME);second.cleanup();expect(name(target)).toBe("");
});
test("panel, top-layer source, detached and long-title candidates are graceful baselines",()=>{
 const source=key();expect(prepareIssueHeroSpike({scope:"panel",source,target:()=>null})).toBeNull();
 const dialog=document.createElement("dialog");document.body.append(dialog);dialog.append(source);
 expect(prepareIssueHeroSpike({scope:"page",source,target:()=>null})).toBeNull();source.remove();expect(prepareIssueHeroSpike({scope:"page",source,target:()=>null})).toBeNull();
 const title=key("Full issue title ".repeat(8));expect(prepareIssueHeroSpike({scope:"page",source:title,target:()=>null})).toBeNull();
});
test("wrong/lazy/throwing targets never retain a source name or overwrite another feature",()=>{
 const source=key(),wrong=key("CORP-2");for(const target of [()=>null,()=>wrong,()=>{throw Error("unmounted")}]){
  const tx=prepareIssueHeroSpike({scope:"page",source,target})!;expect(tx.swap()).toBe(false);expect(name(source)).toBe("");expect(name(wrong)).toBe("");
 }
 wrong.textContent="CORP-1";wrong.style.setProperty("view-transition-name","foreign");const tx=prepareIssueHeroSpike({scope:"page",source,target:()=>wrong})!;
 expect(tx.swap()).toBe(false);expect(name(wrong)).toBe("foreign");expect(name(source)).toBe("");
});
test("a later deliberate style change is not undone by cleanup",()=>{
 const source=key();const tx=prepareIssueHeroSpike({scope:"page",source,target:()=>null})!;source.style.setProperty("view-transition-name","other-owner");tx.cleanup();expect(name(source)).toBe("other-owner");
});

function nativeFake(){
 const calls:{update:()=>void;finish:()=>void;skip:ReturnType<typeof vi.fn>}[]=[];
 Object.defineProperty(document,"startViewTransition",{configurable:true,value:vi.fn((update:()=>void)=>{
  let finish!:()=>void;const finished=new Promise<void>(resolve=>{finish=resolve}),skip=vi.fn();calls.push({update,finish,skip});return{finished,ready:Promise.resolve(),skipTransition:skip};
 })});return calls;
}
function pageFixture(){
 const main=document.createElement("main"),button=document.createElement("button"),source=visible(document.createElement("b"));source.textContent="CORP-1";button.append(source);main.append(button);document.body.append(main);button.focus();
 let target:HTMLElement|null=null,heading:HTMLElement|null=null;
 return{main,source,button,target:()=>target,heading:()=>heading,update:()=>{heading=visible(document.createElement("h2"));heading.textContent="Issue page";heading.setAttribute("data-view-heading","");target=visible(document.createElement("b"));target.textContent="CORP-1";main.replaceChildren(heading,target);}};
}
test("real navigation wrapper keeps vt-nav accounting, cleans names and gives D17 the page heading",async()=>{
 const calls=nativeFake(),f=pageFixture();viewTransition(f.update,{scope:"page",source:f.source,target:f.target});
 expect(name(f.source)).toBe(ISSUE_HERO_NAME);expect(document.documentElement.classList.contains("vt-nav")).toBe(true);
 calls[0].update();expect(name(f.target()!)).toBe(ISSUE_HERO_NAME);calls[0].finish();
 await vi.waitFor(()=>expect(document.activeElement).toBe(f.heading()));expect(name(f.target()!)).toBe("");expect(document.documentElement.classList.contains("vt-nav")).toBe(false);
});
test("cold target skips the shared snapshot and still focuses a lazy heading later",async()=>{
 const calls=nativeFake(),f=pageFixture();viewTransition(()=>f.main.replaceChildren(),{scope:"page",source:f.source,target:()=>null});calls[0].update();expect(calls[0].skip).toHaveBeenCalledOnce();expect(name(f.source)).toBe("");calls[0].finish();await Promise.resolve();await Promise.resolve();
 const heading=visible(document.createElement("h2"));heading.setAttribute("data-view-heading","");f.main.append(heading);await vi.waitFor(()=>expect(document.activeElement).toBe(heading));
});
test("вытесненный hero-переход применяет своё обновление, но не забирает общий ключ у новой навигации",async()=>{
 const calls=nativeFake(),a=pageFixture(),oldUpdate=vi.fn(a.update);viewTransition(oldUpdate,{scope:"page",source:a.source,target:a.target});
 const b=pageFixture();viewTransition(b.update,{scope:"page",source:b.source,target:b.target});
 // Браузер вызывает колбэки вытесненного и нового перехода в порядке запуска.
 calls[0].update();expect(oldUpdate).toHaveBeenCalledOnce();expect(calls[0].skip).toHaveBeenCalledOnce();expect(name(a.target()!)).toBe("");
 calls[1].update();expect(calls[1].skip).not.toHaveBeenCalled();expect(name(b.target()!)).toBe(ISSUE_HERO_NAME);
 calls[0].finish();calls[1].finish();await vi.waitFor(()=>expect(document.documentElement.classList.contains("vt-nav")).toBe(false));expect(name(b.target()!)).toBe("");
});
test("reduced navigation never starts a native/shared transition",()=>{
 const calls=nativeFake(),f=pageFixture();setReducedMotion(true);viewTransition(f.update,{scope:"page",source:f.source,target:f.target});expect(calls).toHaveLength(0);expect(name(f.source)).toBe("");expect(name(f.target()!)).toBe("");
});
