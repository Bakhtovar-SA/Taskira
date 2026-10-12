import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { RoadmapDto, RoadmapProjectDto } from "../../server/src/contract";
import { roadmapApi } from "../api";
import { useStore } from "../store";
import { useT } from "../i18n";
import type { BarSpan } from "../roadmapLayout";
import { canConnect } from "../roadmapLayout";
import type { TimeScale } from "../timeScale";
import { addDays } from "../timeScale";
import { TIME_PAD } from "./TimeCanvas";

export const barWidth = (span: BarSpan, scale: TimeScale) => Math.max(68, scale.x(addDays(span.to, 1)) - scale.x(span.from));
export const connectionPath = (x1: number, y1: number, x2: number, y2: number) => {
  const bend = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
};
type Drag = { sourceId: string; x: number; y: number; targetId: string | null };
export function useRoadmapConnections(projects: RoadmapProjectDto[], dependencies: RoadmapDto["dependencies"], scale: TimeScale, spans: Map<string, BarSpan | null>, rowY: Map<string, number>, scroll: RefObject<HTMLDivElement | null>, onChanged: () => void) {
  const { toast } = useStore(), { t, errText } = useT();
  const [busy, setBusy] = useState(false), [drag, setDrag] = useState<Drag | null>(null);
  const [start, setStart] = useState<{ sourceId: string; x: number; y: number; pointerId: number } | null>(null);
  const last = useRef<Drag | null>(null), suppressClick = useRef(false), pending = useRef(false);
  const canTarget = (sourceId: string, p: RoadmapProjectDto) => p.canEdit && canConnect(dependencies, sourceId, p.id);
  const save = async (sourceId: string, dependentId: string, remove = false) => {
    if (pending.current || !projects.find(p => p.id === dependentId)?.canEdit) return;
    if (!remove && !canConnect(dependencies, sourceId, dependentId)) return;
    pending.current = true; setBusy(true);
    try {
      if (remove) await roadmapApi.removeDependency(dependentId, sourceId);
      else await roadmapApi.addDependency(dependentId, sourceId);
      onChanged();
      toast("success", t(remove ? "roadmap.connectionRemoved" : "roadmap.connectionAdded"));
    } catch (e) { toast("error", errText(e, t("roadmap.saveFailed"))); }
    finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!start) return;
    const cancel = () => { last.current = null; setDrag(null); setStart(null); };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== start.pointerId || Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4 && !last.current) return;
      const node = scroll.current; if (!node) return;
      suppressClick.current = true;
      const r = node.getBoundingClientRect(), factor = r.width / node.offsetWidth;
      if (e.clientX < r.left + 32) node.scrollLeft -= 16;
      else if (e.clientX > r.right - 32) node.scrollLeft += 16;
      const row = document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest<HTMLElement>(".roadmap-timeline-row,.roadmap-project-row")).find(Boolean);
      const target = projects.find(p => p.id === row?.dataset.projectId && spans.get(p.id) && canTarget(start.sourceId, p));
      const point = { sourceId: start.sourceId, x: target ? TIME_PAD + scale.x(spans.get(target.id)!.from) : (e.clientX - r.left) / factor + node.scrollLeft, y: target ? rowY.get(target.id)! : (e.clientY - r.top) / factor + node.scrollTop, targetId: target?.id ?? null };
      last.current = point; setDrag(point);
    };
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== start.pointerId) return;
      const target = last.current?.targetId; cancel();
      if (target) void save(start.sourceId, target);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", key); };
  }, [start, projects, dependencies, scale, spans, rowY, scroll]);
  return { drag, busy, suppressClick, save, canTarget,
    begin: (sourceId: string, e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || pending.current) return;
      suppressClick.current = false; last.current = null;
      setStart({ sourceId, x: e.clientX, y: e.clientY, pointerId: e.pointerId });
    },
  };
}
