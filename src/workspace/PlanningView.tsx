import { DateField } from "./shared";
import { useMemo, useState } from "react";
import type {
  PlanScenario,
  ForecastResult,
} from "../../server/src/workspaceContract";
import { workspaceApi } from "./api";
import { useResource, useAction } from "./hooks";
import {
  Frame,
  exportMaterial,
  ModuleBanner,
  useWorkspace,
  useModuleEnabled,
  useSelected,
  Button,
  Input,
  Select,
  Dialog,
  ErrorNotice,
  Empty,
  Loading,
} from "./shared";
import "./workspace.css";
export default function PlanningView() {
  const { projectId, c, managePlans } = useWorkspace();
  const enabled = useModuleEnabled("planning"),
    [selected, select] = useSelected("plan");
  const plans = useResource(
    (s) => workspaceApi.plans(projectId, s),
    [projectId],
  );
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [target, setTarget] = useState("");
  const a = useAction();
  const current = plans.data?.items.find((p) => p.id === selected) ?? null;
  return (
    <Frame
      title={c.planning}
      hint={c.planningHint}
      actions={
        enabled &&
        managePlans && (
          <Button
            variant="primary"
            onClick={() => {
              setName("");
              setTarget("");
              setCreating(true);
            }}
          >
            {c.newPlan}
          </Button>
        )
      }
    >
      <ModuleBanner module="planning" />
      <ErrorNotice message={plans.error ?? a.error} />
      <div className="workspace-split">
        <aside>
          <h2 className="font-semibold mb-3">{c.plans}</h2>
          <div className="workspace-list">
            {plans.data?.items.map((p) => (
              <button
                key={p.id}
                aria-current={p.id === selected}
                onClick={() => select(p.id)}
              >
                {p.name}
                {p.planId ? ` · ${c.scenario}` : ""}
              </button>
            ))}
          </div>
        </aside>
        <div>
          {plans.loading && !plans.data ? (
            <Loading />
          ) : current ? (
            <PlanDetail
              key={`${current.id}:${current.revision}`}
              plan={current}
              enabled={enabled}
              onChange={plans.reload}
              onSelect={select}
              plans={plans.data?.items ?? []}
            />
          ) : (
            <Empty>{c.emptyPlan}</Empty>
          )}
        </div>
      </div>
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={c.newPlan}
        footer={
          <Button
            loading={a.busy}
            disabled={!name.trim()}
            onClick={() =>
              void a.run(
                () =>
                  workspaceApi.savePlan(projectId, null, {
                    name,
                    targetDate: target || null,
                    items: [],
                    planId: null,
                  }),
                (p) => {
                  setCreating(false);
                  plans.reload();
                  select(p.id);
                },
              )
            }
          >
            {c.create}
          </Button>
        }
      >
        <div className="workspace-form">
          <Input
            label={c.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <DateField
            label={c.targetDate}
            value={target}
            onChange={(value) => setTarget(value)}
          />
          <ErrorNotice message={a.error} />
        </div>
      </Dialog>
    </Frame>
  );
}
function PlanDetail({
  plan,
  plans,
  enabled,
  onChange,
  onSelect,
}: {
  plan: PlanScenario;
  plans: PlanScenario[];
  enabled: boolean;
  onChange: () => void;
  onSelect: (id: string) => void;
}) {
  const { projectId, c, data, managePlans } = useWorkspace();
  const [name, setName] = useState(plan.name),
    [target, setTarget] = useState(plan.targetDate ?? ""),
    [items, setItems] = useState(plan.items),
    [search, setSearch] = useState(""),
    [scenario, setScenario] = useState(false),
    [scenarioName, setScenarioName] = useState(""),
    [compare, setCompare] = useState("");
  const a = useAction();
  const work = useResource(
    (s) => workspaceApi.workItems(projectId, s),
    [projectId],
  );
  const forecast = useResource(
    (s) => workspaceApi.forecast(projectId, plan.id, s),
    [projectId, plan.id, plan.revision],
  );
  const other = useResource(
    (s) =>
      compare
        ? workspaceApi.forecast(projectId, compare, s)
        : Promise.resolve(null),
    [projectId, compare],
  );
  const writable = enabled && managePlans;
  const dirty =
    JSON.stringify(items) !== JSON.stringify(plan.items) ||
    name !== plan.name ||
    target !== (plan.targetDate ?? "");
  const move = (index: number, direction: number) => {
    const next = [...items],
      to = index + direction;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setItems(next);
  };
  const workload = useMemo(() => {
    const groups = new Map<
      string,
      { simple: number; medium: number; hard: number; unestimated: number }
    >();
    for (const i of work.data?.items ?? []) {
      for (const user of i.assigneeIds.length ? i.assigneeIds : [""]) {
        const row = groups.get(user) ?? {
          simple: 0,
          medium: 0,
          hard: 0,
          unestimated: 0,
        };
        row[i.complexity ?? "unestimated"]++;
        groups.set(user, row);
      }
    }
    return [...groups.entries()];
  }, [work.data]);
  return (
    <>
      <div className="workspace-form">
        <Input
          label={c.name}
          value={name}
          disabled={!writable}
          onChange={(e) => setName(e.target.value)}
        />
        <DateField
          label={c.targetDate}
          value={target}
          disabled={!writable}
          onChange={(value) => setTarget(value)}
        />
        <div className="workspace-actions">
          <Button
            onClick={() =>
              exportMaterial(
                { plan, forecast: forecast.data },
                `plan-${plan.id}.json`,
              )
            }
          >
            {c.export}
          </Button>
          {writable && (
            <>
              <Button
                variant="primary"
                loading={a.busy}
                disabled={!dirty}
                onClick={() =>
                  void a.run(
                    () =>
                      workspaceApi.savePlan(projectId, plan.id, {
                        name,
                        targetDate: target || null,
                        items,
                        revision: plan.revision,
                      }),
                    onChange,
                  )
                }
              >
                {c.save}
              </Button>
              <Button
                onClick={() => {
                  setScenarioName(`${name} · ${c.scenario}`);
                  setScenario(true);
                }}
              >
                {c.newScenario}
              </Button>
            </>
          )}
        </div>
        <p className="workspace-muted">
          {plan.planId ? c.scenarioHint : c.forecastHint}
        </p>
        <ErrorNotice message={a.error} />
      </div>
      <div className="workspace-document-layout">
        <div>
          <section className="workspace-section">
            <h2>{c.workItems}</h2>
            {!items.length && <p className="workspace-muted">{c.emptyPlan}</p>}
            <ol>
              {items.map((item, index) => (
                <li key={item.id} className="workspace-row">
                  <div>
                    <strong>
                      {index + 1}. {item.title}
                    </strong>
                    <p className="workspace-muted">
                      {item.complexity ? c[item.complexity] : c.unestimated}
                      {item.dependsOn.length
                        ? ` · ${c.dependencies}: ${item.dependsOn.length}`
                        : ""}
                    </p>
                  </div>
                  {writable && (
                    <div className="workspace-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        {c.up}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        {c.down}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setItems(items.filter((i) => i.id !== item.id))
                        }
                      >
                        {c.remove}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
          {writable && (
            <section className="workspace-section">
              <h2>{c.availableWork}</h2>
              <Input
                label={c.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="workspace-picker">
                {work.data?.items
                  .filter(
                    (i) =>
                      !items.some((p) => p.id === i.id) &&
                      i.title
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase()),
                  )
                  .map((item) => (
                    <Button
                      key={item.id}
                      variant="ghost"
                      onClick={() =>
                        setItems([
                          ...items,
                          {
                            kind: item.kind,
                            id: item.id,
                            title: item.title,
                            complexity: item.complexity,
                            dependsOn: item.dependsOn,
                          },
                        ])
                      }
                    >
                      {c.add} · {item.title}
                    </Button>
                  ))}
              </div>
              {work.data?.truncated && <p>{c.truncated}</p>}
              <ErrorNotice message={work.error} />
            </section>
          )}
        </div>
        <aside>
          <section className="workspace-section">
            <h2>{c.forecast}</h2>
            {forecast.loading && !forecast.data ? (
              <Loading />
            ) : (
              forecast.data && <Forecast data={forecast.data} />
            )}
            <ErrorNotice message={forecast.error} />
            {dirty && (
              <p className="workspace-muted">
                {c.save} → {c.forecast}
              </p>
            )}
          </section>
          <section className="workspace-section">
            <h2>{c.compare}</h2>
            <Select
              aria-label={c.scenario}
              value={compare}
              onChange={setCompare}
              options={[
                { value: "", label: c.none },
                ...plans
                  .filter((p) => p.id !== plan.id)
                  .map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            {other.data && <Forecast data={other.data} />}
            <ErrorNotice message={other.error} />
          </section>
        </aside>
      </div>
      <section className="workspace-section">
        <h2>{c.workload}</h2>
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>{c.assignees}</th>
                <th>{c.simple}</th>
                <th>{c.medium}</th>
                <th>{c.hard}</th>
                <th>{c.unestimated}</th>
              </tr>
            </thead>
            <tbody>
              {workload.map(([id, row]) => (
                <tr key={id}>
                  <th>
                    {data.users.find((u) => u.id === id)?.name ?? c.noAssignee}
                  </th>
                  <td>{row.simple}</td>
                  <td>{row.medium}</td>
                  <td>{row.hard}</td>
                  <td>{row.unestimated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Dialog
        open={scenario}
        onClose={() => setScenario(false)}
        title={c.newScenario}
        description={c.scenarioHint}
        footer={
          <Button
            loading={a.busy}
            disabled={!scenarioName.trim()}
            onClick={() =>
              void a.run(
                () =>
                  workspaceApi.savePlan(projectId, null, {
                    name: scenarioName,
                    targetDate: target || null,
                    items,
                    planId: plan.planId ?? plan.id,
                  }),
                (p) => {
                  setScenario(false);
                  onChange();
                  onSelect(p.id);
                },
              )
            }
          >
            {c.create}
          </Button>
        }
      >
        <Input
          label={c.name}
          value={scenarioName}
          onChange={(e) => setScenarioName(e.target.value)}
        />
        <ErrorNotice message={a.error} />
      </Dialog>
    </>
  );
}
function Forecast({ data }: { data: ForecastResult }) {
  const { c } = useWorkspace();
  const max = Math.max(
    1,
    ...data.weekly.map((w) =>
      Object.values(w.counts).reduce((a, b) => a + b, 0),
    ),
  );
  return (
    <>
      {data.sufficientHistory ? (
        <dl className="workspace-metrics">
          <div className="workspace-metric">
            <dt>{c.median}</dt>
            <dd>{data.medianWeek}</dd>
          </div>
          <div className="workspace-metric">
            <dt>{c.p80}</dt>
            <dd>{data.p80Week}</dd>
          </div>
        </dl>
      ) : (
        <p className="workspace-muted" role="status">
          {data.reasonCode ? c[data.reasonCode] : c.error}
        </p>
      )}
      {data.projection.length > 0 && (
        <ProjectionChart points={data.projection} />
      )}
      <svg
        className="workspace-chart"
        viewBox="0 0 360 160"
        role="img"
        aria-label={c.completedIssues}
      >
        <line x1="0" y1="130" x2="360" y2="130" />
        {data.weekly.map((w, i) => {
          const n = Object.values(w.counts).reduce((a, b) => a + b, 0),
            height = (n / max) * 105;
          return (
            <g key={w.week}>
              <title>{`${w.week}: ${n}`}</title>
              <rect
                x={i * 30 + 5}
                y={130 - height}
                width="20"
                height={height}
              />
              <text x={i * 30 + 5} y="147">
                {w.week.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      <dl className="workspace-form">
        <div>
          <dt>{c.historyWeeks}</dt>
          <dd>{data.historyWeeks}</dd>
        </div>
        <div>
          <dt>{c.completedIssues}</dt>
          <dd>{data.completedIssues}</dd>
        </div>
        <div>
          <dt>{c.samples}</dt>
          <dd>{data.samples}</dd>
        </div>
      </dl>
      <p className="workspace-muted">{c.forecastHint}</p>
    </>
  );
}

function ProjectionChart({ points }: { points: ForecastResult["projection"] }) {
  const { c } = useWorkspace();
  const max = Math.max(1, ...points.map((p) => p.upper)),
    x = (i: number) => 25 + (i * 310) / Math.max(1, points.length - 1),
    y = (v: number) => 130 - (110 * v) / max;
  const line = (field: "lower" | "median" | "upper") =>
    points.map((p, i) => `${x(i)},${y(p[field])}`).join(" ");
  return (
    <figure>
      <figcaption>{c.projection}</figcaption>
      <svg
        className="workspace-chart"
        viewBox="0 0 360 170"
        role="img"
        aria-label={c.forecastBand}
      >
        <polygon
          className="workspace-forecast-band"
          points={`${line("upper")} ${points
            .map((p, i) => `${x(i)},${y(p.lower)}`)
            .reverse()
            .join(" ")}`}
        />
        <polyline
          className="workspace-forecast-median"
          points={line("median")}
        />
        <text x="25" y="155">
          {points[0].week}
        </text>
        <text x="335" y="155" textAnchor="end">
          {points[points.length - 1].week}
        </text>
      </svg>
    </figure>
  );
}
