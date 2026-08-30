/**
 * Camera director — pick systems and sample camera eases (pure, no GPU / DOM).
 *
 * Live playback lives in {@link ../main/camera-director-host.ts}: the App
 * applies these samples each rAF. Tests import this module only.
 */
import { smoothstep01 } from "./camera-zoom.js";
function clamp01(t) {
    if (!(t > 0))
        return 0;
    if (t >= 1)
        return 1;
    return t;
}
export function fleetLocsFromState(state, opts) {
    if (state.state === "jumping") {
        if (opts?.includeJumping === false)
            return [];
        const out = [];
        if (state.startNode)
            out.push(state.startNode);
        if (state.endNode)
            out.push(state.endNode);
        return out;
    }
    if (state.node)
        return [state.node];
    return [];
}
export function sameSystem(a, b) {
    return a.clusterId === b.clusterId && a.solarSystemId === b.solarSystemId;
}
export function pickRandomItem(items, rng = Math.random) {
    const n = items.length;
    if (n <= 0)
        return null;
    let u = rng();
    if (!Number.isFinite(u))
        u = 0;
    const i = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
    return items[i] ?? null;
}
export function pickRandomCluster(clusters, rng = Math.random) {
    return pickRandomItem(clusters, rng);
}
export function pickRandomSystem(systems, rng = Math.random) {
    return pickRandomItem(systems, rng);
}
export function systemsWithShips(systems, fleets) {
    const keys = new Set();
    for (let i = 0; i < fleets.length; i++) {
        const locs = fleets[i].locs;
        for (let j = 0; j < locs.length; j++) {
            const loc = locs[j];
            keys.add(`${loc.clusterId}:${loc.solarSystemId}`);
        }
    }
    const out = [];
    for (let i = 0; i < systems.length; i++) {
        const s = systems[i];
        if (keys.has(`${s.clusterId}:${s.solarSystemId}`))
            out.push(s);
    }
    return out;
}
export function pickSystemWithShips(systems, fleets, rng = Math.random) {
    return pickRandomItem(systemsWithShips(systems, fleets), rng);
}
export function fleetsPresentAt(fleets, clusterId, solarSystemId) {
    const hit = [];
    const want = { clusterId, solarSystemId };
    for (let i = 0; i < fleets.length; i++) {
        const f = fleets[i];
        for (let j = 0; j < f.locs.length; j++) {
            if (sameSystem(f.locs[j], want)) {
                hit.push(f);
                break;
            }
        }
    }
    return hit;
}
export function arrivalShipsPresent(fleets, clusterId, solarSystemId) {
    const hit = fleetsPresentAt(fleets, clusterId, solarSystemId);
    return {
        present: hit.length > 0,
        count: hit.length,
        ids: hit.map((f) => f.id),
    };
}
export function directorLerpPose(from, to, t) {
    const u = clamp01(t);
    const s = smoothstep01(u);
    return {
        eyeX: from.eyeX + (to.eyeX - from.eyeX) * s,
        eyeY: from.eyeY + (to.eyeY - from.eyeY) * s,
        eyeZ: from.eyeZ + (to.eyeZ - from.eyeZ) * s,
        targetX: from.targetX + (to.targetX - from.targetX) * s,
        targetY: from.targetY + (to.targetY - from.targetY) * s,
        targetZ: from.targetZ + (to.targetZ - from.targetZ) * s,
    };
}
/**
 * Sample a fly from A to B. `count` includes endpoints (min 3).
 * Interior samples are strictly between A and B on every changing axis.
 */
export function directorEaseSamples(from, to, count = 5) {
    const n = Math.max(3, count | 0);
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(directorLerpPose(from, to, i / (n - 1)));
    }
    return out;
}
export function directorFlyToSystem(from, system, height, durationMs) {
    const h = Number.isFinite(height) && height > 0 ? height : 350;
    return {
        kind: "fly",
        from: { ...from },
        to: {
            eyeX: system.x,
            eyeY: h,
            eyeZ: system.z,
            targetX: system.x,
            targetY: 0,
            targetZ: system.z,
        },
        durationMs: Math.max(1, durationMs),
        meta: { clusterId: system.clusterId, solarSystemId: system.solarSystemId },
    };
}
/** Queue of camera steps (later: multi-shot). FIFO. */
export function createDirectorQueue() {
    const steps = [];
    return {
        enqueue(step) {
            steps.push(step);
            return steps.length;
        },
        next() {
            return steps.shift();
        },
        remaining() {
            return steps.length;
        },
        peek() {
            return steps[0];
        },
    };
}
//# sourceMappingURL=camera-director.js.map