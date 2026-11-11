import { afterEach, expect, test, vi } from "vitest";
import * as Y from "yjs";
const mock = vi.hoisted(() => ({ providers: [] as Provider[] }));
type Options = {
  onStatus: (e: { status: string }) => void;
  onAuthenticated: (e: { scope: string }) => void;
  onSynced: () => void;
  onStateless: (e: { payload: string }) => void;
};
type Provider = { options: Options; sendStateless: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    sendStateless = vi.fn();
    flushPendingUpdates = vi.fn();
    destroy = vi.fn();
    awareness = { on: vi.fn(), getStates: () => new Map(), setLocalState: vi.fn() };
    constructor(readonly options: Options) { mock.providers.push(this); }
  },
}));
import { documentSession } from "./documentSessions";
import { clearToken } from "../api";
const connect = (p: Provider) => {
  p.options.onStatus({ status: "connected" });
  p.options.onAuthenticated({ scope: "read-write" });
  p.options.onSynced();
};
const ack = (p: Provider, payload?: string) => {
  const request = JSON.parse(payload ?? p.sendStateless.mock.lastCall![0]);
  p.options.onStateless({ payload: JSON.stringify({ type: "persisted", requestId: request.requestId }) });
};
afterEach(() => { clearToken(); mock.providers.length = 0; vi.useRealTimers(); });

test("dirty editor survives navigation, reconnects and waits for the latest DB acknowledgement", () => {
  vi.useFakeTimers();
  const first = documentSession("user", "project", "document", 1);
  const leave = first.subscribe(vi.fn());
  const provider = mock.providers[0];
  connect(provider); ack(provider);
  provider.options.onStatus({ status: "disconnected" });
  first.ydoc.getText("text").insert(0, "offline edit");
  leave();
  vi.advanceTimersByTime(1000);
  expect(provider.destroy).not.toHaveBeenCalled();
  const returned = documentSession("user", "project", "document", 1);
  expect(returned).toBe(first);
  expect(returned.ydoc.getText("text").toString()).toBe("offline edit");
  connect(provider);
  const old = provider.sendStateless.mock.lastCall![0];
  first.ydoc.getText("text").insert(12, " more");
  ack(provider, old);
  expect(first.state.dirty).toBe(true);
  vi.advanceTimersByTime(500);
  ack(provider);
  expect(first.state.saved).toBe(true);
  expect(first.state.dirty).toBe(false);
  expect(provider.destroy).toHaveBeenCalledOnce();
});

test("remote updates do not dirty the local editor; browser closing remains guarded while detached", () => {
  const session = documentSession("user", "project", "document", 1);
  const leave = session.subscribe(vi.fn());
  const remote = new Y.Doc(); remote.getText("text").insert(0, "remote");
  Y.applyUpdate(session.ydoc, Y.encodeStateAsUpdate(remote));
  expect(session.state.dirty).toBe(false);
  session.ydoc.getText("text").insert(0, "local");
  leave();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  remote.destroy();
});

test("logout destroys detached sessions before another account can reconnect", () => {
  const session = documentSession("first", "project", "document", 1);
  const leave = session.subscribe(vi.fn());
  session.ydoc.getText("text").insert(0, "private draft"); leave();
  clearToken();
  expect(mock.providers[0].destroy).toHaveBeenCalledOnce();
  const next = documentSession("second", "project", "document", 1);
  expect(next).not.toBe(session);
  expect(next.ydoc.getText("text").toString()).toBe("");
  next.dispose();
});

test("restoring a version supersedes a detached dirty generation", () => {
  const old = documentSession("user", "project", "document", 1);
  const leave = old.subscribe(vi.fn());
  old.ydoc.getText("text").insert(0, "superseded"); leave();
  const restored = documentSession("user", "project", "document", 2);
  expect(mock.providers[0].destroy).toHaveBeenCalledOnce();
  expect(restored.ydoc.getText("text").toString()).toBe("");
  restored.dispose();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
