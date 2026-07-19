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
const LS_KEY = "galaxyFrameDebug";
let enabled = null;
/** Active frame: spans collected until frameDebugFrameTotal. */
let frameSpans = null;
let frameT0 = 0;
/** Last time we printed a frame breakdown (throttle). */
let lastLogWallMs = 0;
/** Best (slowest) suppressed frame while throttled — logged next window. */
let pendingWorst = null;
function readEnabled() {
    if (typeof window === "undefined")
        return false;
    try {
        const q = new URLSearchParams(window.location.search);
        const v = q.get("frameDebug");
        if (v === "1" || v === "true" || v === "yes")
            return true;
        if (v === "0" || v === "false")
            return false;
    }
    catch {
        /* ignore */
    }
    try {
        const ls = window.localStorage?.getItem(LS_KEY);
        if (ls === "1" || ls === "true")
            return true;
    }
    catch {
        /* ignore */
    }
    return false;
}
/** Whether frame debug logging is on (cached after first read). */
export function isFrameDebugEnabled() {
    if (enabled === null)
        enabled = readEnabled();
    return enabled;
}
/** Force on/off at runtime (persists to localStorage when possible). */
export function enableFrameDebug(on) {
    enabled = on;
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            if (on)
                window.localStorage.setItem(LS_KEY, "1");
            else
                window.localStorage.removeItem(LS_KEY);
        }
    }
    catch {
        /* ignore */
    }
    if (!on) {
        pendingWorst = null;
        lastLogWallMs = 0;
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
    const t0 = nowMs();
    try {
        return fn();
    }
    finally {
        const ms = nowMs() - t0;
        if (frameSpans)
            frameSpans.push({ label, ms, extra });
    }
}
/** Manual span start (returns t0; 0 if debug off). */
export function frameDebugSpanBegin() {
    return isFrameDebugEnabled() ? nowMs() : 0;
}
export function frameDebugSpanEnd(label, t0, extra) {
    if (!isFrameDebugEnabled() || t0 === 0)
        return;
    const ms = nowMs() - t0;
    if (frameSpans)
        frameSpans.push({ label, ms, extra });
}
/**
 * End the frame. If total ≥ threshold, log a breakdown at most once per
 * {@link LOG_MIN_INTERVAL_MS} (keeps the worst frame in each window).
 */
export function frameDebugFrameTotal(label = "renderFrame TOTAL") {
    if (!isFrameDebugEnabled() || frameT0 === 0) {
        frameSpans = null;
        frameT0 = 0;
        return;
    }
    const totalMs = nowMs() - frameT0;
    const spans = frameSpans ?? [];
    frameSpans = null;
    frameT0 = 0;
    if (totalMs < THRESHOLD_MS)
        return;
    // Unaccounted = wall frame time minus sum of child spans (gaps / uninstrumented).
    let accounted = 0;
    for (let i = 0; i < spans.length; i++)
        accounted += spans[i].ms;
    const other = Math.max(0, totalMs - accounted);
    const sorted = spans.slice().sort((a, b) => b.ms - a.ms);
    const lines = [
        `[frameDebug] ${label}: ${totalMs.toFixed(2)}ms (>${THRESHOLD_MS}ms) — breakdown:`,
    ];
    for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        const pct = totalMs > 0 ? (100 * s.ms) / totalMs : 0;
        const tail = s.extra ? `  ${s.extra}` : "";
        lines.push(`  ${s.ms.toFixed(2).padStart(8)}ms (${pct.toFixed(1).padStart(5)}%)${tail}  ${s.label}`);
    }
    if (other >= 0.5) {
        const pct = totalMs > 0 ? (100 * other) / totalMs : 0;
        lines.push(`  ${other.toFixed(2).padStart(8)}ms (${pct.toFixed(1).padStart(5)}%)  (uninstrumented / gaps)`);
    }
    const wall = nowMs();
    if (wall - lastLogWallMs >= LOG_MIN_INTERVAL_MS) {
        // Flush any worse suppressed frame first, then this one if still worst.
        if (pendingWorst && pendingWorst.totalMs > totalMs) {
            logFrame(pendingWorst.lines.join("\n"));
        }
        else {
            logFrame(lines.join("\n"));
        }
        pendingWorst = null;
        lastLogWallMs = wall;
        return;
    }
    // Throttled: keep the slowest frame in the window for the next log slot.
    if (!pendingWorst || totalMs > pendingWorst.totalMs) {
        pendingWorst = { totalMs, lines };
    }
}
/** @deprecated use frameDebugSpanBegin — kept for call sites */
export function frameDebugEnd(label, t0, extra) {
    frameDebugSpanEnd(label, t0, extra);
}
//# sourceMappingURL=frame-debug.js.map