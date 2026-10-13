/** ADR-0035 (прототип): уход и сдвиг строк списка. Строка, исчезнувшая из набора (удалили, закрыли, ушла из фильтра по
 *  ревизии), не пропадает мгновенно: на её прежнем месте остаётся «призрак» — копия, которая гаснет (`exit`), а строки
 *  ниже плавно доезжают на освободившееся место (`flipFrom`, как у доски). Призрак живёт внутри хозяина списка (стили
 *  и `--list-cols` наследуются), не перехватывает указатель и скрыт от вспомогательных технологий.
 *
 *  «Базовая линия» (первый показ, смена запроса, догрузка страницы) — только запоминаем положение строк. Вызывается из
 *  layout-эффекта после коммита; состояния React нет. Больше `MAX_TRACKED` строк — не отслеживаем (VDI: не сотни
 *  getBoundingClientRect за коммит). */
import { cssZoom, exit, flipFrom, motionReduced } from "./motion";

export const MAX_TRACKED = 200;
const MAX_GHOSTS = 6;

type Box = { left: number; top: number; width: number; height: number };
type Seen = { el: HTMLElement; box: Box };

export type RowMotion = (host: HTMLElement | null, ids: readonly string[], find: (id: string) => HTMLElement | null | undefined, baseline: boolean) => void;

export function createRowMotion(): RowMotion {
  let prev: Map<string, Seen> | null = null;
  return (host, ids, find, baseline) => {
    if (!host || ids.length > MAX_TRACKED || motionReduced()) {
      prev = null;
      return;
    }
    const h = host.getBoundingClientRect();
    // Список может стоять под CSS zoom (0.9 на 1024–2559 px): координаты хранятся в CSS px хозяина (для призрака и
    // стилей), во viewport (для flipFrom) переводятся обратно умножением на zoom.
    const z = cssZoom(host);
    const now = new Map<string, Seen>();
    for (const id of ids) {
      const el = find(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      now.set(id, { el, box: { left: (r.left - h.left) / z, top: (r.top - h.top) / z, width: r.width / z, height: r.height / z } });
    }
    const before = prev;
    prev = now;
    if (baseline || !before) return;

    let ghosts = 0;
    for (const [id, old] of before) {
      if (now.has(id) || ghosts >= MAX_GHOSTS || !old.box.height) continue;
      ghosts++;
      const ghost = old.el.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("role");
      ghost.removeAttribute("data-issue-id");
      ghost.removeAttribute("tabindex");
      ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      ghost.classList.add("list-row-ghost");
      ghost.style.left = `${old.box.left}px`;
      ghost.style.top = `${old.box.top}px`;
      ghost.style.width = `${old.box.width}px`;
      ghost.style.height = `${old.box.height}px`;
      host.appendChild(ghost);
      void exit(ghost).then(() => ghost.remove());
    }
    for (const [id, cur] of now) {
      const old = before.get(id);
      if (!old) continue;
      if (Math.abs(old.box.top - cur.box.top) < 1 && Math.abs(old.box.left - cur.box.left) < 1) continue;
      void flipFrom(cur.el, h.left + old.box.left * z, h.top + old.box.top * z, { lift: false });
    }
  };
}
