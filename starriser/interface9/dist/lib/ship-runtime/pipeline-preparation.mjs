/** Bounded pipeline preparation; durations measure completion, not GPU execution. */
export async function preparePipelines(jobs, concurrency = 3, onTiming = () => {}, onProgress = () => {}) {
  const results = new Array(jobs.length); let cursor = 0, completed = 0;
  const active = new Map();
  const progress = () => {
    const now = performance.now();
    try { onProgress({completed,total:jobs.length,queued:jobs.length-cursor,
      active:[...active.values()].map(job=>({label:job.label,elapsedMs:now-job.start}))}); }
    catch { /* Diagnostics cannot fail preparation. */ }
  };
  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor++, job = jobs[index], start = performance.now();
      active.set(index,{label:job.label,start}); progress();
      try { results[index] = await job.run(); }
      finally {
        active.delete(index); completed++;
        try { onTiming({ label: job.label, durationMs: performance.now() - start }); } catch { /* Diagnostics cannot fail preparation. */ }
        progress();
      }
    }
  }
  // Drain in-flight jobs on failure: callers can safely dispose their resources.
  const settled = await Promise.allSettled(Array.from({length: Math.min(jobs.length, Math.max(1, concurrency))}, worker));
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}

/** Remove unrelated functions before Tint sees a module. Bindings/layout stay fixed.
 * WGSL has no strings/preprocessor; mask comments before balancing function bodies.
 */
export function selectShaderEntries(source, entries) {
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ' '));
  const functions = new Map();
  const pattern = /(?:@\w+(?:\([^)]*\))?\s*)*fn\s+(\w+)\s*\(/g;
  let match;
  while ((match = pattern.exec(clean))) {
    const body = clean.indexOf('{', pattern.lastIndex); let end = body + 1, depth = 1;
    while (depth && end < clean.length) { const c = clean[end++]; if (c === '{') depth++; else if (c === '}') depth--; }
    if (depth) throw Error(`Unclosed WGSL function ${match[1]}`);
    functions.set(match[1], {start: match.index, end, body: clean.slice(body, end)});
    pattern.lastIndex = end;
  }
  const keep = new Set(), pending = [...entries];
  while (pending.length) {
    const name = pending.pop(); if (keep.has(name)) continue;
    const fn = functions.get(name); if (!fn) throw Error(`Missing WGSL entry ${name}`);
    keep.add(name);
    for (const call of fn.body.matchAll(/\b(\w+)\s*\(/g)) if (functions.has(call[1]) && !keep.has(call[1])) pending.push(call[1]);
  }
  let result = '', from = 0;
  for (const [name, fn] of functions) { result += source.slice(from, fn.start); if (keep.has(name)) result += source.slice(fn.start, fn.end); from = fn.end; }
  return result + source.slice(from);
}
