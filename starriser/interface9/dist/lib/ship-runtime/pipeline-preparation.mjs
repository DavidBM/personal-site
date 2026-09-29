/** Bounded pipeline preparation; durations measure completion, not GPU execution. */
export async function preparePipelines(jobs, concurrency = 3, onTiming = () => {}, onProgress = () => {}) {
  const results = new Array(jobs.length); let cursor = 0, completed = 0, failure = null;
  const active = new Map();
  const progress = () => {
    const now = performance.now();
    try { onProgress({completed,total:jobs.length,queued:jobs.length-cursor,
      active:[...active.values()].map(job=>({label:job.label,elapsedMs:now-job.start}))}); }
    catch { /* Diagnostics cannot fail preparation. */ }
  };
  async function worker() {
    while (cursor < jobs.length && !failure) {
      const index = cursor++, job = jobs[index], start = performance.now();
      active.set(index,{label:job.label,start}); progress();
      try { results[index] = await job.run(); }
      catch (cause) {
        const reason = typeof cause?.reason === 'string' ? `; reason=${cause.reason}` : '';
        const detail = String(cause?.message ?? cause).replace(/\s+/g, ' ').slice(0, 1200);
        const error = new Error(`GPU preparation "${job.label}" failed after ${((performance.now()-start)/1000).toFixed(1)}s: ${cause?.name ?? 'Error'}${reason}: ${detail}`);
        error.cause = cause;
        if (!failure) failure = error;
        throw error;
      }
      finally {
        active.delete(index); completed++;
        try { onTiming({ label: job.label, durationMs: performance.now() - start }); } catch { /* Diagnostics cannot fail preparation. */ }
        progress();
      }
    }
  }
  // Drain in-flight jobs on failure: callers can safely dispose their resources.
  await Promise.allSettled(Array.from({length: Math.min(jobs.length, Math.max(1, concurrency))}, worker));
  if (failure) throw failure;
  return results;
}

/** Device errors can contain driver context omitted from GPUPipelineError.
 * Observe only while preparing; do not suppress the browser's normal reporting.
 * These are batch diagnostics, not attribution to a particular concurrent job.
 */
export async function withGpuPreparationDiagnostics(device, run) {
  const messages = [];
  const observe = event => {
    const error = event.error;
    const text = `${error?.constructor?.name ?? 'GPUError'}: ${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 400)}`;
    if (messages.length < 4 && !messages.includes(text)) messages.push(text);
  };
  device.addEventListener('uncapturederror', observe);
  try { return await run(); }
  catch (cause) {
    if (!messages.length) throw cause;
    const error = new Error(`${cause?.message ?? cause} | Device errors during preparation: ${messages.join(' | ')}`);
    error.cause = cause; throw error;
  } finally { device.removeEventListener('uncapturederror', observe); }
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
