import assert from 'node:assert/strict';

const finite = values => values.filter(value => typeof value === 'number' && Number.isFinite(value));
export function percentile(values, p = 0.95) {
  const sorted = finite(values).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
}
export function median(values) {
  const sorted = finite(values).sort((a, b) => a - b), n = sorted.length;
  return n ? (sorted[Math.floor(n / 2)] + sorted[Math.ceil(n / 2) - 1]) / 2 : null;
}
const maximum = values => values.length ? Math.max(...values) : null;

/** Stack-bearing Layout is a proxy, not proof that every Layout was forced. Preserve evidence. */
export function traceLayouts(events) {
  const start = events.find(e => e.name === 'taskira-motion-start');
  const end = start && events.find(e => e.name === 'taskira-motion-end' && e.pid === start.pid && e.ts >= start.ts);
  if (!start || !end) return { available: false, reason: 'Missing measurement markers', layouts: null, withStack: null, inInputHandler: null, evidence: [] };
  const input = events.filter(e => e.pid === start.pid && e.name === 'EventDispatch' && e.ph === 'X' && e.ts + (e.dur ?? 0) > start.ts && e.ts < end.ts && Number.isFinite(e.dur));
  const layouts = events.filter(e => e.pid === start.pid && e.name === 'Layout' && e.ph === 'X' && e.ts >= start.ts && e.ts < end.ts);
  const evidence = layouts.map(e => {
    const stack = e.args?.beginData?.stackTrace ?? e.args?.data?.stackTrace ?? [];
    const handler = input.find(i => i.tid === e.tid && e.ts >= i.ts && e.ts + (e.dur ?? 0) <= i.ts + i.dur);
    return { ts: e.ts, durationUs: e.dur ?? null, tid: e.tid, stack, inputType: handler?.args?.data?.type ?? null, inInputHandler: !!handler };
  });
  return { available: true, startUs: start.ts, endUs: end.ts, layouts: layouts.length,
    withStack: evidence.filter(e => e.stack.length).length,
    inInputHandler: evidence.filter(e => e.stack.length && e.inInputHandler).length, evidence };
}
export function metrics(raw, trace) {
  const frames = finite(raw.frames);
  return { frameP95Ms: percentile(frames), frameMaxMs: maximum(frames), framesOver50: frames.filter(n => n > 50).length,
    longTaskCount: raw.supported.longtask ? raw.longtasks.length : null,
    longTaskMaxMs: raw.supported.longtask ? maximum(raw.longtasks.map(e => e.duration)) ?? 0 : null,
    eventMaxMs: raw.supported.event ? maximum(raw.events.map(e => e.duration)) ?? 0 : null,
    peakRunning: raw.peakRunning, peakCounting: raw.peakCounting, peakCombined: raw.peakCombined,
    layoutCount: trace.layouts, layoutWithStack: trace.withStack, layoutInInputHandler: trace.inInputHandler };
}
export function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.profile + '/' + row.scenario;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, attempts]) => {
    const measured = attempts.filter(r => r.status === 'measured');
    const keys = new Set(measured.flatMap(r => Object.keys(r.metrics)));
    return { key, attempts: attempts.length, measured: measured.length,
      unmeasured: attempts.filter(r => r.status !== 'measured').map(r => ({ run: r.run, reason: r.reason })),
      metrics: Object.fromEntries([...keys].map(k => {
        const values = finite(measured.map(r => r.metrics[k]));
        return [k, { samples: values.length, median: median(values), worst: maximum(values) }];
      })) };
  });
}
export function selfTest() {
  assert.equal(percentile([]), null); assert.equal(percentile([90, 10, 30, 20]), 90);
  assert.equal(median([1, 9, 3, 5]), 4); assert.equal(median([NaN, Infinity, 3]), 3);
  const mark = (name, ts) => ({ name, ts, pid: 1, tid: 2 });
  const layout = (ts, stack = true, pid = 1) => ({ name: 'Layout', ph: 'X', ts, dur: 5, pid, tid: 2, args: { beginData: { stackTrace: stack ? [{ functionName: 'measure' }] : [] } } });
  const trace = traceLayouts([mark('taskira-motion-start', 100), { ...mark('EventDispatch', 90), ph: 'X', dur: 400, args: { data: { type: 'click' } } }, layout(200), layout(700), layout(800, false), layout(50), layout(300, true, 2), mark('taskira-motion-end', 1000)]);
  assert.equal(trace.layouts, 3); assert.equal(trace.withStack, 2); assert.equal(trace.inInputHandler, 1);
  assert.equal(traceLayouts([]).layouts, null);
  const raw = { frames: [16, 17, 60, 80], supported: { event: false, longtask: true }, longtasks: [{ duration: 70 }], events: [], peakRunning: 4, peakCounting: 3, peakCombined: 7 };
  const m = metrics(raw, trace); assert.equal(m.frameP95Ms, 80); assert.equal(m.framesOver50, 2); assert.equal(m.eventMaxMs, null); assert.equal(m.longTaskMaxMs, 70);
  const summary = summarize([{ profile: 'weak', scenario: 'S1', status: 'measured', metrics: { x: 20, missing: null } }, { profile: 'weak', scenario: 'S1', status: 'measured', metrics: { x: 40, missing: null } }, { profile: 'weak', scenario: 'S1', status: 'unmeasured', reason: 'failed' }])[0];
  assert.deepEqual(summary.metrics.x, { samples: 2, median: 30, worst: 40 }); assert.equal(summary.metrics.missing.median, null);
  assert.deepEqual(summarize([{ profile: 'vdi', scenario: 'S8', status: 'unmeasured', reason: 'unavailable' }])[0].metrics, {});
  console.log('perf-motion metrics self-test passed');
}
