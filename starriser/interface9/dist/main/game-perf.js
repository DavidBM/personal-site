/**
 * Production-safe game perf hooks for bulk fleet add wall time + rAF FPS.
 * Target: 10k fleets add <3s; steady frame ≤8ms (120 FPS).
 * Exposed on globalThis.__galaxyGamePerf for CDP / browser scenarios.
 * Measures the real map path only (no forceLodNear / cs_ships_fast).
 */
const BULK_TIMEOUT_MS = 120000;
let active = null;
let lastReport = null;
function clearEndTimer(session) {
    if (session.endTimer != null) {
        clearTimeout(session.endTimer);
        session.endTimer = null;
    }
}
function finishBulk(session, endTs) {
    clearEndTimer(session);
    const wallMs = Math.max(0, endTs - session.startTs);
    const report = {
        requested: session.requested,
        applied: session.applied,
        wallMs,
        startTs: session.startTs,
        endTs,
        ok: session.applied >= session.requested && wallMs <= 2000,
    };
    lastReport = report;
    if (active === session)
        active = null;
    console.log(`[gamePerf] bulk add: ${report.applied}/${report.requested} in ` +
        `${wallMs.toFixed(0)}ms (target <2000) ok=${report.ok}`);
    // Auto-sample FPS after a successful bulk (or any complete apply).
    if (session.applied > 0) {
        startFrameSample(2000);
    }
}
let frameSample = null;
let frameRaf = 0;
let frameLast = 0;
let frameSum = 0;
let frameMin = Infinity;
let frameMax = 0;
let frameCount = 0;
let frameUntil = 0;
function finishFrameSample() {
    if (frameRaf !== 0) {
        cancelAnimationFrame(frameRaf);
        frameRaf = 0;
    }
    const avg = frameCount > 0 ? frameSum / frameCount : 0;
    frameSample = {
        avgDtMs: avg,
        minDtMs: Number.isFinite(frameMin) ? frameMin : 0,
        maxDtMs: frameMax,
        frames: frameCount,
        approxFps: avg > 0 ? 1000 / avg : 0,
        ok: avg > 0 && avg <= 8.5,
    };
    console.log(`[gamePerf] frame sample: ${frameSample.approxFps.toFixed(1)} FPS ` +
        `(avg ${avg.toFixed(2)}ms, min ${frameSample.minDtMs.toFixed(2)}, ` +
        `max ${frameSample.maxDtMs.toFixed(2)}, n=${frameCount}) ok=${frameSample.ok}`);
}
function frameTick(now) {
    if (frameLast > 0) {
        const dt = now - frameLast;
        frameSum += dt;
        frameCount++;
        if (dt < frameMin)
            frameMin = dt;
        if (dt > frameMax)
            frameMax = dt;
    }
    frameLast = now;
    if (now >= frameUntil) {
        finishFrameSample();
        return;
    }
    frameRaf = requestAnimationFrame(frameTick);
}
/** Sample rAF dt for `durationMs` (default 2s). Target ≤8ms. */
export function startFrameSample(durationMs = 2000) {
    if (typeof requestAnimationFrame === "undefined")
        return;
    if (frameRaf !== 0) {
        cancelAnimationFrame(frameRaf);
        frameRaf = 0;
    }
    frameLast = 0;
    frameSum = 0;
    frameMin = Infinity;
    frameMax = 0;
    frameCount = 0;
    frameUntil = performance.now() + Math.max(100, durationMs | 0);
    frameRaf = requestAnimationFrame(frameTick);
}
export function getLastFrameSample() {
    return frameSample;
}
/** Start timing a bulk add of `requested` fleets. */
export function beginBulkAdd(requested) {
    if (active) {
        // Supersede prior bulk without double-logging a partial as "complete".
        clearEndTimer(active);
        active = null;
    }
    const n = Math.max(0, requested | 0);
    const session = {
        requested: n,
        applied: 0,
        startTs: performance.now(),
        endTimer: null,
    };
    session.endTimer = setTimeout(() => {
        if (active === session)
            finishBulk(session, performance.now());
    }, BULK_TIMEOUT_MS);
    active = session;
    if (n === 0) {
        finishBulk(session, performance.now());
    }
}
/** Note N fleets applied on main (batch size). Completes when applied >= requested. */
export function noteBulkApplied(n) {
    if (!active)
        return;
    active.applied += Math.max(0, n | 0);
    if (active.applied >= active.requested) {
        finishBulk(active, performance.now());
    }
}
/** Force-end bulk timing (e.g. clear galaxy mid-add). */
export function endBulkAdd() {
    if (!active)
        return;
    finishBulk(active, performance.now());
}
export function getLastBulkReport() {
    return lastReport;
}
export function getActiveBulkApplied() {
    return active?.applied ?? lastReport?.applied ?? 0;
}
export function isBulkActive() {
    return active != null;
}
/** Install CDP surface once (idempotent). */
export function installGamePerfGlobal() {
    if (typeof globalThis === "undefined")
        return;
    globalThis.__galaxyGamePerf = {
        beginBulkAdd,
        noteBulkApplied,
        endBulkAdd,
        getLastBulkReport,
        getActiveBulkApplied,
        isBulkActive,
        startFrameSample,
        getLastFrameSample,
    };
}
// Auto-install when the module loads (App also calls install for clarity).
installGamePerfGlobal();
//# sourceMappingURL=game-perf.js.map