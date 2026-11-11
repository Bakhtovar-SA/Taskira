import type { ProcessStep } from "../../server/src/workspaceContract";
import { useWorkspace } from "./shared";

/** Automatic layered layout; invalid draft edges are omitted until their keys are corrected. */
export function ProcessGraph({
  steps,
  selected,
  onSelect,
}: {
  steps: ProcessStep[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const { c } = useWorkspace();
  const depths = new Map<string, number>();
  const depth = (key: string, path = new Set<string>()): number => {
    if (depths.has(key)) return depths.get(key)!;
    if (path.has(key)) return 0;
    const s = steps.find((s) => s.key === key);
    if (!s) return 0;
    const next = new Set(path).add(key);
    const n = Math.min(
      steps.length,
      Math.max(
        0,
        ...s.dependsOn
          .filter((k) => steps.some((v) => v.key === k))
          .map((k) => depth(k, next) + 1),
      ),
    );
    depths.set(key, n);
    return n;
  };
  const rows = new Map<number, number>();
  const nodes = steps.map((step, index) => {
    const col = depth(step.key),
      row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    return { step, index, x: col * 235 + 12, y: row * 100 + 12 };
  });
  const width = Math.max(240, ...nodes.map((n) => n.x + 220)),
    height = Math.max(95, ...nodes.map((n) => n.y + 88));
  return (
    <div className="workspace-process-graph">
      <svg width={width} height={height} aria-label={c.steps}>
        {nodes.flatMap((n) =>
          n.step.dependsOn.map((key) => {
            const parent = nodes.find((p) => p.step.key === key);
            return parent ? (
              <path
                key={`${n.index}-${key}`}
                className="workspace-graph-edge"
                d={`M${parent.x + 205},${parent.y + 34} C${parent.x + 230},${parent.y + 34} ${n.x - 25},${n.y + 34} ${n.x},${n.y + 34}`}
              />
            ) : null;
          }),
        )}
        {nodes.map((n) => (
          <g
            key={n.index}
            role="button"
            tabIndex={0}
            aria-label={n.step.title || n.step.key}
            aria-pressed={n.index === selected}
            className="workspace-graph-node"
            onClick={() => onSelect(n.index)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(n.index);
              }
            }}
          >
            <title>{n.step.title}</title>
            <rect x={n.x} y={n.y} width="205" height="68" rx="7" />
            <text
              x={n.x + 12}
              y={n.y + 27}
            >{`${n.index + 1}. ${(n.step.title || n.step.key).slice(0, 25)}`}</text>
            <text className="workspace-graph-caption" x={n.x + 12} y={n.y + 48}>
              {n.step.reviewerId
                ? c.reviewer
                : c[n.step.complexity ?? "unestimated"]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
