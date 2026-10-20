/** Injected only by the benchmark, never shipped in the application bundle. */
export function installProbe() {
  let current;
  const sampleEntry = e => ({ name: e.name, startTime: e.startTime, duration: e.duration, interactionId: e.interactionId ?? null, processingStart: e.processingStart ?? null, processingEnd: e.processingEnd ?? null });
  window.__motionBenchmark = {
    arm(windowMs = 900) {
      current?.dispose();
      let resolve, frame, started = null, last, finished = false;
      const promise = new Promise(done => { resolve = done; });
      const raw = { frames: [], events: [], longtasks: [], peakRunning: 0, peakCounting: 0, peakCombined: 0, supported: {}, windowMs, actualWindowMs: null, trigger: null };
      const observers = [];
      for (const [type, target] of [['event', raw.events], ['longtask', raw.longtasks]]) {
        raw.supported[type] = PerformanceObserver.supportedEntryTypes.includes(type);
        if (!raw.supported[type]) continue;
        try {
          const observer = new PerformanceObserver(list => target.push(...list.getEntries().map(sampleEntry)));
          observer.observe(type === 'event' ? { type, durationThreshold: 16 } : { type });
          observers.push({ observer, target });
        } catch { raw.supported[type] = false; }
      }
      function removeListeners() {
        document.removeEventListener('pointerdown', start, true);
        document.removeEventListener('keydown', start, true);
      }
      function dispose() {
        removeListeners(); cancelAnimationFrame(frame);
        for (const { observer } of observers) observer.disconnect();
        if (!finished) { finished = true; resolve({ ...raw, aborted: true }); }
      }
      function tick() {
        const now = performance.now(); // NOT the RAF callback timestamp (headless may report a synthetic cadence).
        raw.frames.push(now - last); last = now;
        const running = document.getAnimations().filter(a => a.playState === 'running').length;
        const counting = document.querySelectorAll('.count-up[data-counting]').length;
        raw.peakRunning = Math.max(raw.peakRunning, running);
        raw.peakCounting = Math.max(raw.peakCounting, counting);
        raw.peakCombined = Math.max(raw.peakCombined, running + counting);
        if (now - started < windowMs) { frame = requestAnimationFrame(tick); return; }
        performance.mark('taskira-motion-end');
        raw.actualWindowMs = now - started;
        for (const { observer, target } of observers) { target.push(...observer.takeRecords().map(sampleEntry)); observer.disconnect(); }
        raw.events = raw.events.filter(e => e.startTime >= raw.triggerStartTime && e.startTime < started + windowMs);
        raw.longtasks = raw.longtasks.filter(e => e.startTime < started + windowMs && e.startTime + e.duration > started);
        finished = true; resolve(raw);
      }
      function start(e) {
        if (!e.isTrusted || started !== null) return;
        started = performance.now(); last = started; raw.trigger = e.type; raw.startedAt = started;
        // Event Timing starts at event.timeStamp, slightly before capture handler performance.now().
        // Include the triggering input instead of accidentally dropping the very event being measured.
        raw.triggerStartTime = Number.isFinite(e.timeStamp) && e.timeStamp >= 0 && e.timeStamp <= started ? e.timeStamp : started;
        removeListeners(); performance.mark('taskira-motion-start');
        frame = requestAnimationFrame(tick);
      }
      document.addEventListener('pointerdown', start, true);
      document.addEventListener('keydown', start, true);
      current = { dispose, promise };
    },
    result() { if (!current) throw new Error('Probe is not armed'); return current.promise; },
    cancel() { current?.dispose(); current = undefined; },
  };
}
