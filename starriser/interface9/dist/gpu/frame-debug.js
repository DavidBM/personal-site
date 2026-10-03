/**
 * Conditional frame-path timing.
 *
 * Enable (any of):
 *   - URL: `?frameDebug=1` or `?frameDebug=true`
 *   - localStorage: `galaxyFrameDebug=1`
 *   - runtime: `enableFrameDebug(true)`
 *
 * When a **frame total** exceeds the threshold, logs a breakdown (throttled).
 * Uses `console.log` — **not** `console.error` — so Chrome does not capture a
 * multi-hundred-frame rAF stack on every slow frame (that alone tanked FPS).
 *
 * Note: GPU compute/draw here is **CPU encode time**, not GPU execution.
 * Sub-ms jitter / GC / previous-frame console work can land on any span label.
 */
const THRESHOLD_MS = 5;
/** At most one frame breakdown log per this many ms. */
const LOG_MIN_INTERVAL_MS = 1000;
let enabled = false;
let frameSpans = null;
let frameCounts = null;
let spanDepth = 0;
let frameT0 = 0;
/** Last time we printed a frame breakdown (throttle). */
let lastLogWallMs = -Infinity;
/** Best (slowest) suppressed frame while throttled — logged next window. */
let pendingWorst = null;
/** Whether frame debug logging is on (cached after first read). */
export function isFrameDebugEnabled() {
    return enabled;
}
/** Force on/off at runtime. Browser preference persistence belongs to the adapter. */
export function enableFrameDebug(on) {
    enabled = on;
    if (!on) {
        pendingWorst = null;
        frameSpans = null;
        frameCounts = null;
        lastLogWallMs = -Infinity;
    }
}
export function getFrameDebugThresholdMs() {
    return THRESHOLD_MS;
}
function nowMs() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}
/**
 * Lightweight log — never console.error (DevTools captures a full stack on
 * every error, and our rAF loop makes that stack enormous + expensive).
 */
function logFrame(msg) {
    console.log(msg);
}
/**
 * Start a frame. Call once at the top of renderFrame when debug is on.
 * Clears the span list for this frame.
 */
export function frameDebugBegin() {
    if (!isFrameDebugEnabled()) {
        frameSpans = null;
        frameT0 = 0;
        return 0;
    }
    frameSpans = [];
    frameCounts = new Map();
    spanDepth = 0;
    frameT0 = nowMs();
    return frameT0;
}
/**
 * Time a synchronous function. Records the span for the frame breakdown only
 * (no per-span console spam — that was a main-thread tax under load).
 */
export function frameDebugTime(label, fn, extra) {
    if (!isFrameDebugEnabled())
        return fn();
    const t0 = frameDebugSpanBegin();
    try {
        return fn();
    }
    finally {
        frameDebugSpanEnd(label, t0, extra);
    }
}
/** Manual span start (returns t0; 0 if debug off). */
export function frameDebugSpanBegin() {
    if (!enabled || !frameSpans)
        return 0;
    spanDepth++;
    return nowMs();
}
export function frameDebugSpanEnd(label, t0, extra) {
    if (!enabled || !frameSpans)
        return;
    const ms = nowMs() - t0;
    spanDepth = Math.max(0, spanDepth - 1);
    frameSpans.push({ label, ms, depth: spanDepth, extra });
}
/** Fleet/work counters only. No strings, timestamps or records allocated while disabled. */
export function frameDebugCount(label, count = 1) {
    if (enabled && frameCounts)
        frameCounts.set(label, (frameCounts.get(label) ?? 0) + count);
}
/**
 * End the frame. If total ≥ threshold, log a breakdown at most once per
 * {@link LOG_MIN_INTERVAL_MS} (keeps the worst frame in each window).
 */
export function frameDebugFrameTotal(label = "renderFrame TOTAL") {
    if (!enabled || !frameSpans || !frameCounts)
        return;
    const wall = nowMs(), totalMs = wall - frameT0;
    if (totalMs >= THRESHOLD_MS && (!pendingWorst || totalMs > pendingWorst.totalMs)) {
        pendingWorst = { label, at: frameT0, totalMs, spans: frameSpans, counts: frameCounts };
    }
    frameSpans = null;
    frameCounts = null;
    // Also flush on a healthy frame after a burst. Otherwise the last/worst
    // suppressed frame disappears as soon as performance recovers.
    if (!pendingWorst || wall - lastLogWallMs < LOG_MIN_INTERVAL_MS)
        return;
    logFrame(formatFrame(pendingWorst));
    pendingWorst = null;
    lastLogWallMs = wall;
}
function formatFrame(frame) {
    const { label, totalMs, spans, counts, at } = frame;
    // Nested spans are inclusive detail, not additional time. Count only roots
    // toward coverage so nested admission/table work cannot hide unmeasured gaps.
    let accounted = 0;
    for (const span of spans)
        if (span.depth === 0)
            accounted += span.ms;
    const other = Math.max(0, totalMs - accounted);
    const sorted = spans.slice().sort((a, b) => b.ms - a.ms);
    const lines = [
        `[frameDebug] ${label}: ${totalMs.toFixed(2)}ms at ${at.toFixed(1)}ms — CPU wall time; nested spans are inclusive:`,
    ];
    for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        const pct = totalMs > 0 ? (100 * s.ms) / totalMs : 0;
        const tail = s.extra ? `  ${s.extra}` : "";
        lines.push(`  ${s.ms.toFixed(2).padStart(8)}ms (${pct.toFixed(1).padStart(5)}%)${tail}  ${s.label}${s.depth ? ' [nested]' : ''}`);
    }
    if (other >= 0.5) {
        const pct = totalMs > 0 ? (100 * other) / totalMs : 0;
        lines.push(`  ${other.toFixed(2).padStart(8)}ms (${pct.toFixed(1).padStart(5)}%)  (uninstrumented / gaps)`);
    }
    if (counts.size)
        lines.push(`  Work: ${[...counts].map(([name, value]) => `${name}=${value}`).join(', ')}`);
    return lines.join('\n');
}
/** @deprecated use frameDebugSpanBegin — kept for call sites */
export function frameDebugEnd(label, t0, extra) {
    frameDebugSpanEnd(label, t0, extra);
}
//# sourceMappingURL=frame-debug.js.map