import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { API_BASE } from "../api";

type Snapshot = { connected: boolean; readOnly: boolean; synced: boolean; saved: boolean; failure: boolean; dirty: boolean; peers: number };
const sessions = new Map<string, DocumentSession>();

/** Tab memory only. A dirty, detached editor keeps its connection and Y.Doc until
 * PostgreSQL acknowledges the latest local edit, including after reconnect. */
export class DocumentSession {
  readonly ydoc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  state: Snapshot = { connected: false, readOnly: false, synced: false, saved: false, failure: false, dirty: false, peers: 0 };
  private listeners = new Set<(persisted: boolean) => void>();
  private requests = new Map<string, number>();
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(readonly key: string, project: string, id: string, generation: number) {
    const url = new URL(`/api/projects/${project}/documents/${id}/collaboration`, API_BASE || window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("generation", String(generation));
    this.provider = new HocuspocusProvider({
      url: url.toString(), name: `${project}:${id}:${generation}`, document: this.ydoc, token: "cookie",
      onStatus: ({ status }) => this.update({ connected: status === "connected" }),
      onAuthenticated: ({ scope }) => this.update({ readOnly: scope === "readonly", failure: false }),
      onSynced: () => {
        this.update({ synced: true });
        if (this.state.readOnly) this.update({ saved: !this.state.dirty });
        else this.persist();
      },
      onAuthenticationFailed: () => this.update({ failure: true, connected: false }),
      onStateless: ({ payload }) => {
        let ack: { type: string; requestId?: string };
        try { ack = JSON.parse(payload); } catch { return; }
        if (ack.type === "readonly") { this.update({ readOnly: true, failure: true }); return; }
        if (ack.type !== "persisted" || !ack.requestId || !this.requests.has(ack.requestId)) return;
        const sequence = this.requests.get(ack.requestId);
        this.requests.delete(ack.requestId);
        if (sequence === this.sequence) {
          this.update({ dirty: false, saved: true }, true);
          if (!this.listeners.size) this.dispose();
        }
      },
    });
    this.ydoc.on("update", (_update, _origin, _doc, transaction: Y.Transaction) => {
      if (!transaction.local || this.disposed) return;
      this.sequence++;
      this.update({ dirty: true, saved: false });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.persist(), 500);
    });
    this.provider.awareness?.on("change", () => this.update({ peers: this.provider.awareness?.getStates().size ?? 0 }));
  }
  private update(patch: Partial<Snapshot>, persisted = false) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const notify of this.listeners) notify(persisted);
  }
  private persist() {
    if (this.disposed || this.state.readOnly || !this.state.connected || !this.state.synced) return;
    const requestId = crypto.randomUUID();
    this.requests.clear();
    this.requests.set(requestId, this.sequence);
    this.provider.flushPendingUpdates();
    this.provider.sendStateless(JSON.stringify({ type: "persist", requestId }));
  }
  subscribe(notify: (persisted: boolean) => void) {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
      if (!this.listeners.size) {
        this.provider.awareness?.setLocalState(null);
        if (this.state.dirty) this.persist();
        else this.dispose();
      }
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.provider.destroy();
    this.ydoc.destroy();
    sessions.delete(this.key);
    this.listeners.clear();
  }
}

export function documentSession(user: string, project: string, id: string, generation: number) {
  const prefix = `${user}:${project}:${id}:`;
  const key = `${prefix}${generation}`;
  // A confirmed restore starts a new generation. Never reconnect the superseded
  // CRDT, which could otherwise retain an unreachable dirty session indefinitely.
  for (const [otherKey, other] of sessions)
    if (otherKey.startsWith(prefix) && otherKey !== key) other.dispose();
  let session = sessions.get(key);
  if (!session) {
    session = new DocumentSession(key, project, id, generation);
    sessions.set(key, session);
  }
  return session;
}

window.addEventListener("beforeunload", (event) => {
  if ([...sessions.values()].some((s) => s.state.dirty)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
// Logout and HTTP 401 must stop background reconnects before another user logs in.
window.addEventListener("taskira:session-cleared", () => {
  for (const session of sessions.values()) session.dispose();
});
