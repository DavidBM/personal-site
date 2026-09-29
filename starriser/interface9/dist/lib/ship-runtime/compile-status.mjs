const PHASES = new Set(['preparing', 'checking', 'compiling', 'ready', 'failed', 'cancelled']);
const TERMINAL = new Set(['ready', 'failed', 'cancelled']);

function stageCounts(event) {
  if (Number.isInteger(event.completed) && Number.isInteger(event.total)
    && event.completed >= 0 && event.total > 0 && event.completed <= event.total) {
    return { completed: event.completed, total: event.total };
  }
  return {};
}

function copyStatus(event) {
  if (!PHASES.has(event?.phase) || typeof event.label !== 'string' || !event.label) return null;
  const value = { phase: event.phase, label: event.label.slice(0, 160), ...stageCounts(event) };
  if (Array.isArray(event.active)) value.active = Object.freeze(event.active.slice(0,16)
    .filter(job=>typeof job.label==='string' && Number.isFinite(job.elapsedMs) && job.elapsedMs>=0)
    .map(job=>Object.freeze({label:job.label.slice(0,80),elapsedMs:job.elapsedMs})));
  if (Number.isInteger(event.queued) && event.queued>=0) value.queued=event.queued;
  if (Number.isFinite(event.durationMs) && event.durationMs >= 0) value.durationMs = event.durationMs;
  if (typeof event.error === 'string') value.error = event.error.slice(0, 2000);
  return Object.freeze(value);
}

/** Optional diagnostics must never change runtime initialization or its failures. */
export function createCompileReporter(onStatus) {
  let finished = false;
  return event => {
    if (finished || typeof onStatus !== 'function') return;
    const value = copyStatus(event);
    if (!value) return;
    finished = TERMINAL.has(value.phase);
    try { onStatus(value); } catch { /* A diagnostic observer cannot fail GPU setup. */ }
  };
}
