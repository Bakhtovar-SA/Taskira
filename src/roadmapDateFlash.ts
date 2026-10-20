/** One acknowledged date edit, consumed by the next roadmap load; no subscriptions or persisted data. */
import type { RoadmapProjectDto } from "../server/src/contract";
import { flash } from "./motion";
export type RoadmapDates = { startDate: string | null; targetDate: string | null };
export const ROADMAP_FLASH_TTL_MS = 30_000;
type Marker = RoadmapDates & { userId: string; projectId: string; until: number };
let pending: Marker | null = null, generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
export function clearRoadmapDateFlash(): void {
  generation++; pending = null;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}
/** Begin before PATCH so a failed/no-op/newer operation cannot reuse an older success. */
export function beginRoadmapDateFlash(userId: string, projectId: string, dates: RoadmapDates): () => void {
  clearRoadmapDateFlash();
  const own = generation;
  return () => {
    if (own !== generation || !userId || !projectId) return;
    generation++;
    pending = { userId, projectId, ...dates, until: Date.now() + ROADMAP_FLASH_TTL_MS };
    timer = setTimeout(clearRoadmapDateFlash, ROADMAP_FLASH_TTL_MS);
  };
}
/** Consume even when missing, changed again, reduced, virtualized or outside the actual clip. */
export function flashConfirmedRoadmapDates(userId: string, projectId: string, projects: readonly RoadmapProjectDto[], viewport: HTMLElement): void {
  const marker = pending; clearRoadmapDateFlash();
  if (!marker || marker.until <= Date.now() || marker.userId !== userId || marker.projectId !== projectId) return;
  const project = projects.find(item => item.id === marker.projectId);
  if (!project || project.startDate !== marker.startDate || project.targetDate !== marker.targetDate) return;
  const bar = viewport.querySelector<HTMLElement>(`.roadmap-timeline-row[data-project-id="${CSS.escape(marker.projectId)}"] .roadmap-bar`);
  if (!bar) return;
  const b = bar.getBoundingClientRect(), clip = viewport.getBoundingClientRect();
  if (b.width > 0 && b.height > 0 && b.right > Math.max(0, clip.left) && b.left < Math.min(innerWidth, clip.right) &&
    b.bottom > Math.max(0, clip.top) && b.top < Math.min(innerHeight, clip.bottom)) flash(bar);
}
