import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {createToastQueue} from "./toastQueue";
import {createExternalStore} from "./external";
import type {Toast} from "../types";
let dispose=()=>{};
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{dispose();vi.useRealTimers();});
function queue(){const store=createExternalStore<Toast[]>([]),q=createToastQueue(store);dispose=q.dispose;q.connect();return {store,...q};}
test("a focused action keeps its remaining lifetime, then expires after blur",()=>{
 const {store,push}=queue();push("success","Moved",{label:"Undo",run:()=>true});vi.advanceTimersByTime(3000);
 store.getState()[0].pause!();vi.advanceTimersByTime(10000);expect(store.getState()).toHaveLength(1);
 store.getState()[0].resume!();vi.advanceTimersByTime(1199);expect(store.getState()).toHaveLength(1);
 vi.advanceTimersByTime(1);expect(store.getState()).toHaveLength(0);
});
test("repeated focus inside the toast doesn't reset its lifetime",()=>{
 const {store,push}=queue();push("info","Saved");vi.advanceTimersByTime(1000);const item=store.getState()[0];
 item.pause!();item.pause!();vi.advanceTimersByTime(9000);item.resume!();item.resume!();
 vi.advanceTimersByTime(3200);expect(store.getState()).toEqual([]);
});
test("eviction cancels old timers, paused toast cannot resurrect; queue stays at four",()=>{
 const {store,push}=queue();push("info","first");const first=store.getState()[0];first.pause!();
 for(let i=0;i<4;i++)push("info",String(i));expect(store.getState()).toHaveLength(4);first.resume!();
 expect(vi.getTimerCount()).toBe(4);vi.advanceTimersByTime(4200);expect(store.getState()).toEqual([]);
});
test("dismiss/dispose clear timers and another provider is independent",()=>{
 const {store,push,dispose}=queue(),other=createExternalStore<Toast[]>([]),q=createToastQueue(other);
 q.connect();push("success","first");q.push("success","second");store.getState()[0].dismiss!();expect(store.getState()).toEqual([]);
 dispose();expect(other.getState()).toHaveLength(1);q.dispose();expect(vi.getTimerCount()).toBe(0);
});
test("external session reset disposes even paused toast timers",()=>{
 const {store,push}=queue();push("info","Undo");const old=store.getState()[0];old.pause!();
 store.setState(()=>[]);old.resume!();expect(vi.getTimerCount()).toBe(0);
});


test("a StrictMode effect cleanup can reconnect without leaking reset subscriptions",()=>{
 const store=createExternalStore<Toast[]>([]),subscribe=vi.spyOn(store,"subscribe"),q=createToastQueue(store);dispose=q.dispose;
 expect(subscribe).not.toHaveBeenCalled();q.connect();q.connect();expect(subscribe).toHaveBeenCalledOnce();
 q.dispose();q.connect();expect(subscribe).toHaveBeenCalledTimes(2);
 q.push("success","Undo",{label:"Undo",run:()=>true});store.setState(()=>[]);
 expect(vi.getTimerCount()).toBe(0);
});


test("effect replay preserves the remaining lifetime of an already queued toast",()=>{
 const {store,push,connect,dispose}=queue();push("success","Saved");vi.advanceTimersByTime(1000);
 dispose();vi.advanceTimersByTime(10000);expect(vi.getTimerCount()).toBe(0);
 connect();vi.advanceTimersByTime(3199);expect(store.getState()).toHaveLength(1);
 vi.advanceTimersByTime(1);expect(store.getState()).toHaveLength(0);
});
