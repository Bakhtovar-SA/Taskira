import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { installProbe } from './probe.mjs';

/** No browser: deliberately wrong RAF timestamps prove the probe uses performance.now(). */
export async function probeSelfTest() {
  let clock = 0, next = 0;
  const frames = new Map(), listeners = new Map(), marks = [], observers = [];
  class Observer {
    static supportedEntryTypes = ['event', 'longtask'];
    constructor(callback) { this.callback = callback; this.records = []; this.disconnected = false; observers.push(this); }
    observe(options) { this.options = options; }
    takeRecords() { const records = this.records; this.records = []; return records; }
    disconnect() { this.disconnected = true; }
  }
  const window = {};
  const document = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    getAnimations: () => [{ playState: 'running' }, { playState: 'finished' }],
    querySelectorAll: () => [1, 2, 3],
  };
  const sandbox = { window, document, PerformanceObserver: Observer,
    performance: { now: () => clock, mark: name => marks.push({ name, clock }) },
    requestAnimationFrame: callback => { frames.set(++next, callback); return next; }, cancelAnimationFrame: id => frames.delete(id) };
  runInNewContext('(' + installProbe.toString() + ')()', sandbox);
  const probe = window.__motionBenchmark;
  const tick = now => { clock = now; const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); };
  probe.arm(900);
  listeners.get('keydown')({ isTrusted: false, type: 'keydown' });
  assert.equal(frames.size, 0);
  listeners.get('keydown')({ isTrusted: true, type: 'keydown' });
  assert.equal(listeners.size, 0);
  observers.find(o => o.options.type === 'event').records.push({ name: 'keydown', startTime: 1, duration: 32 }, { name: 'old', startTime: -20, duration: 80 });
  observers.find(o => o.options.type === 'longtask').records.push({ name: 'self', startTime: 50, duration: 100 });
  tick(16); tick(60); tick(1000);
  const raw = await probe.result();
  assert.deepEqual(Array.from(raw.frames), [16, 44, 940]);
  assert.equal(raw.actualWindowMs, 1000); // The stalled crossing frame must not be censored at 900.
  assert.equal(raw.events.length, 1); assert.equal(raw.longtasks.length, 1);
  assert.equal(raw.peakRunning, 1); assert.equal(raw.peakCounting, 3); assert.equal(raw.peakCombined, 4);
  assert.deepEqual(marks.map(m => m.name), ['taskira-motion-start', 'taskira-motion-end']);
  assert.equal(observers.every(o => o.disconnected), true); assert.equal(frames.size, 0);
  clock = 1100; probe.arm();
  listeners.get('keydown')({ isTrusted: true, type: 'keydown', timeStamp: 1095 });
  observers.at(-2).records.push({ name: 'keydown', startTime: 1095, duration: 48 }, { name: 'old', startTime: 1070, duration: 80 });
  tick(2010);
  assert.equal((await probe.result()).events.length, 1); // The trigger precedes handler entry by 5ms.
  probe.arm();
  const pending = probe.result(); probe.cancel();
  assert.equal((await pending).aborted, true); assert.equal(listeners.size, 0);
  probe.arm(); const replaced = probe.result(); probe.arm();
  assert.equal((await replaced).aborted, true); probe.cancel(); assert.equal(listeners.size, 0);
  console.log('perf-motion probe self-test passed (real clock deltas, stall, trusted input, observer/cancel cleanup)');
}
