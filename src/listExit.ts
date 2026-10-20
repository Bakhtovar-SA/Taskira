/** Уход и FLIP видимых строк: первый показ/смена запроса — базовая линия, выше потолка — мгновенно.
 * Призраки инертны, без идентификаторов живых строк; фокус переносится сразу после коммита. */
import { cssZoom, exit, flipFrom, motionReduced, stopMotion, MOTION_CAPS } from "./motion";

export const MAX_TRACKED = MOTION_CAPS.track;
type Box = { left: number; top: number; width: number; height: number };
type Seen = { el: HTMLElement; box: Box; visible: boolean };
export type RowMotion = {
  (host: HTMLElement | null, ids: readonly string[], find: (id: string) => HTMLElement | null | undefined, baseline: boolean): void;
  dispose(): void;
};
const isMoving = (el: HTMLElement): boolean =>
  !!el.getAnimations?.().some(a => (a.effect as KeyframeEffect | null)?.getKeyframes?.().some(k => "transform" in k));

/** Видимое окно ограничено viewport и прокручиваемыми предками хозяина. */
function viewport(host: HTMLElement) {
  const box = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  for (let parent = host.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), clipX = /auto|scroll|hidden|clip/.test(style.overflowX), clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
    if (!clipX && !clipY) continue;
    const rect = parent.getBoundingClientRect();
    if (clipX) { box.left = Math.max(box.left, rect.left); box.right = Math.min(box.right, rect.right); }
    if (clipY) { box.top = Math.max(box.top, rect.top); box.bottom = Math.min(box.bottom, rect.bottom); }
  }
  return box;
}

export function createRowMotion(): RowMotion {
  let prev: Map<string, Seen> | null = null;
  let order: readonly string[] = [];
  let owner: HTMLElement | null = null;
  let focused: { id: string; el: HTMLElement } | null = null;
  const ghosts = new Set<HTMLElement>();
  const clearRows = () => { for (const row of prev?.values() ?? []) stopMotion(row.el); };
  const clearGhosts = () => { for (const ghost of ghosts) { stopMotion(ghost); ghost.remove(); } ghosts.clear(); };
  const remember = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    const row = target.closest?.<HTMLElement>("[data-issue-id], [data-enter-id]");
    const id = row?.dataset.issueId ?? row?.dataset.enterId;
    focused = id && owner?.contains(row!) ? { id, el: target } : null;
  };
  const dispose = () => {
    document.removeEventListener("focusin", remember);
    clearRows(); clearGhosts(); prev = null; order = []; owner = null; focused = null;
  };
  const update: RowMotion = Object.assign((host: HTMLElement | null, ids: readonly string[], find: (id: string) => HTMLElement | null | undefined, baseline: boolean) => {
    if (host !== owner) {
      document.removeEventListener("focusin", remember);
      clearRows(); clearGhosts(); prev = null; order = []; focused = null; owner = host;
      if (host) document.addEventListener("focusin", remember);
    }
    const current = new Set(ids);
    if (!baseline && focused && !current.has(focused.id) && !focused.el.isConnected &&
      (document.activeElement === document.body || document.activeElement === document.documentElement)) {
      const index = order.indexOf(focused.id);
      const next = order.slice(index + 1).find(id => current.has(id)) ?? [...order.slice(0, index)].reverse().find(id => current.has(id)) ?? ids[Math.min(index, ids.length - 1)];
      const row = next ? find(next) : null;
      const target = row?.matches("button, a[href], input, [tabindex]") ? row : row?.querySelector<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])');
      target?.focus({ preventScroll: true });
    }
    order = [...ids];
    if (!host || ids.length > MAX_TRACKED || motionReduced()) { clearRows(); clearGhosts(); prev = null; return; }
    if (baseline) { clearRows(); clearGhosts(); }
    const h = host.getBoundingClientRect(), z = cssZoom(host), view = viewport(host);
    const visible = (r: DOMRect) => r.height > 0 && r.width > 0 && r.bottom > view.top && r.top < view.bottom && r.right > view.left && r.left < view.right;
    const wasVisible = (box: Box) => visible({ left: h.left + box.left * z, top: h.top + box.top * z,
      right: h.left + (box.left + box.width) * z, bottom: h.top + (box.top + box.height) * z,
      width: box.width * z, height: box.height * z } as DOMRect);
    const now = new Map<string, Seen>();
    for (const id of ids) {
      const el = find(id);
      if (!el || el.closest(".list-row-ghost")) continue;
      const known = prev?.get(id);
      if (known && known.el === el && isMoving(el)) { now.set(id, { ...known, visible: wasVisible(known.box) }); continue; }
      const r = el.getBoundingClientRect();
      now.set(id, { el, visible: visible(r), box: { left: (r.left - h.left) / z, top: (r.top - h.top) / z, width: r.width / z, height: r.height / z } });
    }
    const before = prev; prev = now;
    if (baseline || !before) return;
    // Read phase ends before any ghosts/WAAPI writes. An oversized visible group remains instantaneous.
    const moved = [...now].filter(([id, cur]) => {
      const old = before.get(id);
      return old && cur.visible && (Math.abs(old.box.top - cur.box.top) >= 1 || Math.abs(old.box.left - cur.box.left) >= 1);
    });
    if (moved.length > MOTION_CAPS.flip) { clearRows(); clearGhosts(); return; }
    for (const [id, old] of before) {
      if (now.has(id) || ghosts.size >= MOTION_CAPS.ghosts || !wasVisible(old.box)) continue;
      const ghost = old.el.cloneNode(true) as HTMLElement;
      for (const node of [ghost, ...ghost.querySelectorAll("*")]) {
        for (const attr of ["id", "name", "for", "form", "role", "tabindex", "data-issue-id", "data-enter-id", "data-row", "data-active"]) node.removeAttribute(attr);
        if (node.classList.contains("list-row")) node.classList.add("list-row-ghost-shell");
        if (node.classList.contains("inbox-row")) node.classList.add("inbox-row-ghost");
        node.classList.remove("list-row", "inbox-row");
      }
      const inputs = old.el.querySelectorAll<HTMLInputElement>("input");
      ghost.querySelectorAll<HTMLInputElement>("input").forEach((input, i) => { if (inputs[i]) input.checked = inputs[i].checked; });
      ghost.setAttribute("aria-hidden", "true"); ghost.setAttribute("inert", ""); ghost.classList.add("list-row-ghost");
      ghost.style.left = `${old.box.left}px`; ghost.style.top = `${old.box.top}px`;
      ghost.style.width = `${old.box.width}px`; ghost.style.height = `${old.box.height}px`;
      host.appendChild(ghost); ghosts.add(ghost);
      void exit(ghost).then(() => { ghosts.delete(ghost); ghost.remove(); });
    }
    for (const [id, cur] of moved) {
      const old = before.get(id)!;
      void flipFrom(cur.el, h.left + old.box.left * z, h.top + old.box.top * z, { lift: false });
    }
  }, { dispose });
  return update;
}
