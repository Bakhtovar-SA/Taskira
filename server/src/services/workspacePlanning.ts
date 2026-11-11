import { q } from "../db.js";
import type { PlanItem } from "../workspaceContract.js";

/** Resolve a saved scenario against current completion and materialisation, without writing tasks. */
export async function remainingPlan(
  projectId: string,
  items: PlanItem[],
): Promise<PlanItem[]> {
  const issues = await q<{ id: string; done: boolean }>(
    `SELECT i.id,(s.category='done' OR i.archived_at IS NOT NULL) done FROM issues i JOIN workflow_statuses s ON s.id=i.status_id WHERE i.project_id=$1`,
    [projectId],
  );
  const steps = await q<{ id: string; issue_id: string | null; state: string }>(
    `SELECT s.id,s.issue_id,s.state FROM workspace_process_steps s JOIN workspace_process_runs r ON r.id=s.run_id WHERE r.project_id=$1`,
    [projectId],
  );
  const aliases = new Map(
    steps.filter((s) => s.issue_id).map((s) => [s.id, s.issue_id!]),
  );
  const finished = new Set(issues.filter((i) => i.done).map((i) => i.id));
  for (const s of steps)
    if (s.state === "skipped" || s.state === "completed") finished.add(s.id);
  const canonical = (id: string) => aliases.get(id) ?? id;
  const result = new Map<string, PlanItem>();
  for (const item of items) {
    const id = canonical(item.id);
    if (finished.has(item.id) || finished.has(id)) continue;
    const dependsOn = [
      ...new Set(
        item.dependsOn
          .filter((dep) => !finished.has(dep) && !finished.has(canonical(dep)))
          .map(canonical),
      ),
    ].filter((dep) => dep !== id);
    const old = result.get(id);
    if (old) old.dependsOn = [...new Set([...old.dependsOn, ...dependsOn])];
    else
      result.set(id, {
        ...item,
        id,
        kind: aliases.has(item.id) ? "issue" : item.kind,
        dependsOn,
      });
  }
  return [...result.values()];
}
