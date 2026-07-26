/**
 * L4 / W4 — pure fleet LOD policy + global instance budget allocator.
 *
 * No GPU / DOM. Map-view (or pack path) calls these to decide per-fleet
 * scatter counts, world impostors, and screen-space icons before packing.
 *
 * Bands (height-first):
 *   0 FORMATION — cameraY < nearY (7k): multi-ship scatter + full agent + trails
 *   1 IMPOSTOR  — nearY ≤ cameraY < farY (120k): full agent (same as 0), single
 *                 screen-space icon draw + lead-ship trail (no multi-ship render)
 *   2 ICON      — cameraY ≥ farY: single icon, no agent, no trail
 *
 * Tests may force NEAR via FleetInstanceGpuLayer option `forceLodNear` only —
 * never a global product flag.
 *
 * Distance gates are optional/light. Demotion hold (LOD_HOLD_MS) keeps a higher
 * live budget for a few seconds so zoom-back does not immediately collapse sim;
 * promotion always applies immediately.
 */
export const LOD_NEAR_Y = 7000;
export const LOD_FAR_Y = 120000;
/** Soft XZ gate — only lightly demotes formation→impostor when very far. */
export const LOD_NEAR_DIST = 25000;
export const LOD_MID_DIST = 120000;
export const CAP_NEAR = 48;
/** Impostor band: always one triangle. */
export const CAP_MID = 1;
/** Icon band: always one triangle. */
export const CAP_FAR = 1;
/** Global visual ship budget (formation + impostor + icon). ~500k @ half trail ring. */
export const GLOBAL_MAX_INSTANCES = 500000;
/**
 * Minimum GPU/CPU ship capacity on first alloc and floor for geometric grow.
 * ~85 fleets @ CAP_NEAR — avoids grow thrash when adding fleets one-by-one
 * (each grow used to re-upload O(all ships) ShipSim + trails).
 */
export const GPU_SHIP_CAPACITY_MIN = 4096;
/** Minimum FleetGpu row capacity (first alloc / grow floor). */
export const GPU_FLEET_CAPACITY_MIN = 256;
/**
 * Next grow-only capacity: at least `needed`, at least `minCap` on first alloc,
 * otherwise double previous (classic amortized vector growth). Never past `maxCap`.
 */
export function nextGrowCapacity(needed, oldCap, minCap, maxCap) {
    const n = Math.max(0, needed | 0);
    if (n <= 0)
        return 0;
    const max = Math.max(0, maxCap | 0);
    const min = Math.max(0, minCap | 0);
    const old = Math.max(0, oldCap | 0);
    let cap = Math.max(n, min);
    if (old > 0) {
        cap = Math.max(cap, old * 2);
    }
    return Math.min(max, cap);
}
/**
 * Demotion hold: keep previous higher shipBudget / band for this long (wall ms)
 * after a demotion would apply. Promote (zoom-in) ignores hold.
 */
export const LOD_HOLD_MS = 2500;
/**
 * R5 — formation promote warm-up: integrate this many frames with FLEET_FLAG_WARM
 * (draw size=0) so agent ships settle before becoming visible. Avoids LOD pop.
 */
export const WARM_FRAMES = 4;
/** Screen-space icon target diameter (px). Stored in draw size; pad marks SS. */
export const ICON_SCREEN_PX = 15;
// ---------------------------------------------------------------------------
// Model LOD (textured glTF) — additive near band; does not change 0/1/2
// ---------------------------------------------------------------------------
/**
 * When a typical formation ship triangle would be this many screen pixels or
 * larger, prefer the textured 3D model draw (up to {@link MODEL_LOD_MAX_INSTANCES}).
 * ~100px requires deep zoom (deeper than strategic formation); existing height
 * bands (NEAR/MID/FAR) stay unchanged — model is a close-up overlay on NEAR.
 *
 * Enter threshold (off → on). Exit is lower — see {@link MODEL_LOD_EXIT_SCREEN_PX}.
 */
export const MODEL_LOD_MIN_SCREEN_PX = 100;
/**
 * Sticky exit: once models are on, stay until projected size falls below this.
 * Prevents pure-pan / borderline thrash at the 100px knife-edge.
 */
export const MODEL_LOD_EXIT_SCREEN_PX = 72;
/**
 * Fleets within this XZ radius (world) share one model band.
 * ~solar-system scale so neighbors in one system are never split
 * model vs triangle by micro eye-distance differences under tilt.
 */
export const MODEL_LOD_NEIGHBOR_RADIUS = 600;
/** Extra view-cull radius scale while sticky (fleet was model last frame). */
export const MODEL_LOD_VIEW_CULL_STICKY_SCALE = 1.25;
/**
 * Hard cap for concurrent textured model instances on screen.
 * Not the 480k formation slot budget — models are the close-up band only.
 */
export const MODEL_LOD_MAX_INSTANCES = 10000;
/**
 * Project a world-space size (diameter-ish) to approximate screen pixels.
 * Inverse of the icon path in fleet-ships WGSL:
 *   worldSize = px * (2 * cameraY * tanHalfFov) / viewportH
 *
 * `cameraY` here is a stand-in for **view distance** (height when top-down).
 * Prefer {@link projectedWorldSizeAtDistanceToScreenPx} when eye↔ship distance
 * is known so pan and zoom agree for equal on-screen size.
 */
export function projectedWorldSizeToScreenPx(worldSize, cameraY, viewportH, tanHalfFov) {
    return projectedWorldSizeAtDistanceToScreenPx(worldSize, cameraY, viewportH, tanHalfFov);
}
/**
 * Project world size at true 3D view distance (eye → ship).
 * Same formula as height-only when dist ≈ cameraY (top-down over ship).
 */
export function projectedWorldSizeAtDistanceToScreenPx(worldSize, dist, viewportH, tanHalfFov) {
    const H = Math.max(viewportH, 1);
    const d = Math.max(dist, 1e-3);
    const th = Math.max(tanHalfFov, 1e-8);
    return (Math.max(0, worldSize) * H) / (2 * d * th);
}
/**
 * 3D distance from camera eye to a ground ship (y≈0).
 */
export function eyeToShipDistance(eyeX, eyeY, eyeZ, shipX, shipZ, shipY = 0) {
    const dx = shipX - eyeX;
    const dy = shipY - eyeY;
    const dz = shipZ - eyeZ;
    return Math.hypot(dx, dy, dz);
}
/**
 * True when the reference ship projects to ≥ {@link MODEL_LOD_MIN_SCREEN_PX}.
 * Pure policy — no GPU. Callers pass live camera frustum terms.
 *
 * Height-only form (global enter gate). Use {@link isModelLodActiveSticky}
 * across frames so pure pan does not thrash at the 100px knife-edge.
 *
 * Does **not** alter classifyHeightBand / classifyFleetLodBand (0/1/2).
 */
export function isModelLodActive(cameraY, viewportH, tanHalfFov, options) {
    const worldSize = options?.worldSize ?? MODEL_LOD_REF_WORLD_SIZE;
    const minPx = options?.minScreenPx ?? MODEL_LOD_MIN_SCREEN_PX;
    return (projectedWorldSizeAtDistanceToScreenPx(worldSize, cameraY, viewportH, tanHalfFov) >= minPx);
}
/**
 * Sticky global model gate (height / nadir projection).
 * Enter at minScreenPx; once on, exit only below exitScreenPx.
 */
export function isModelLodActiveSticky(cameraY, viewportH, tanHalfFov, wasActive, options) {
    const worldSize = options?.worldSize ?? MODEL_LOD_REF_WORLD_SIZE;
    const enterPx = options?.enterScreenPx ?? MODEL_LOD_MIN_SCREEN_PX;
    const exitPx = options?.exitScreenPx ?? MODEL_LOD_EXIT_SCREEN_PX;
    const px = projectedWorldSizeAtDistanceToScreenPx(worldSize, cameraY, viewportH, tanHalfFov);
    if (wasActive)
        return px >= exitPx;
    return px >= enterPx;
}
/**
 * True when a ship at `dist` (eye→ship) projects ≥ min screen px.
 * Equal projected size under pan vs zoom uses the same gate.
 */
export function isModelLodActiveAtDistance(dist, viewportH, tanHalfFov, options) {
    const worldSize = options?.worldSize ?? MODEL_LOD_REF_WORLD_SIZE;
    const minPx = options?.minScreenPx ?? MODEL_LOD_MIN_SCREEN_PX;
    return (projectedWorldSizeAtDistanceToScreenPx(worldSize, dist, viewportH, tanHalfFov) >= minPx);
}
/**
 * How many model instances to draw this frame (0 when inactive).
 * Caps at {@link MODEL_LOD_MAX_INSTANCES}; never exceeds live shipCount.
 */
export function modelLodInstanceCount(modelLodActive, liveShipCount, maxInstances = MODEL_LOD_MAX_INSTANCES) {
    if (!modelLodActive)
        return 0;
    const n = Math.max(0, liveShipCount | 0);
    const cap = Math.max(0, maxInstances | 0);
    return Math.min(n, cap);
}
/**
 * Soft view radius for model cull (world XZ).
 * groundRadius ≈ cameraY · tanHalfFov · viewCullScale (same family as GPU LOD).
 * Floor prevents “zoom in → radius shrinks → models vanish / pan-only gate”.
 */
export const MODEL_LOD_VIEW_CULL_SCALE = 1.5;
/** Minimum ground cull radius (world) so deep zoom still covers a tactical area. */
export const MODEL_LOD_VIEW_CULL_MIN_R = 400;
/**
 * Ground-view cull radius for model selection.
 * Floored so close zoom does not collapse the eligible region to a pinhead.
 */
export function modelLodViewCullRadius(cameraY, tanHalfFov, viewCullScale = MODEL_LOD_VIEW_CULL_SCALE) {
    const r = Math.max(cameraY, 1) *
        Math.max(tanHalfFov, 1e-6) *
        Math.max(viewCullScale, 0.1);
    return Math.max(MODEL_LOD_VIEW_CULL_MIN_R, r);
}
/**
 * True when a fleet/ship at (fx,fz) is inside the model draw budget region
 * around camera look target (in-view + margin). Cheap sphere on XZ.
 */
export function isInModelLodView(fx, fz, cameraTargetX, cameraTargetZ, cameraY, tanHalfFov, viewCullScale = MODEL_LOD_VIEW_CULL_SCALE) {
    const r = modelLodViewCullRadius(cameraY, tanHalfFov, viewCullScale);
    const dx = fx - cameraTargetX;
    const dz = fz - cameraTargetZ;
    return dx * dx + dz * dz <= r * r;
}
/**
 * Pack eligible ship indices for model draw (≤ maxInstances).
 *
 * Product rules (same solar system must not split model vs triangle):
 * 1. **Nadir height gate** (with enter/exit hysteresis) — deep zoom only.
 * 2. **View cull** around look-at (sticky larger radius if fleet was model).
 * 3. **Neighbor share** — fleets within {@link MODEL_LOD_NEIGHBOR_RADIUS} share
 *    the max nadir-based band of the group (no per-fleet eye-distance split).
 * 4. Budget fill nearest look-at first.
 *
 * Pure — no GPU. Optional `sticky` map persists fleet on/off across frames.
 *
 * @param fleets list of { instanceStart, shipBudget, posX, posZ }
 * @returns dense list of ShipSim/draw indices to instance
 */
export function selectModelShipIndices(fleets, camera, maxInstances = MODEL_LOD_MAX_INSTANCES, sticky) {
    const cap = Math.max(0, maxInstances | 0);
    if (cap <= 0 || fleets.length === 0) {
        sticky?.clear();
        return [];
    }
    const viewportH = camera.viewportH ?? 800;
    const worldSize = camera.worldSize ?? MODEL_LOD_REF_WORLD_SIZE;
    const enterPx = camera.minScreenPx ?? MODEL_LOD_MIN_SCREEN_PX;
    const exitPx = camera.exitScreenPx ?? MODEL_LOD_EXIT_SCREEN_PX;
    const neighborR = camera.neighborRadius ?? MODEL_LOD_NEIGHBOR_RADIUS;
    const neighborR2 = neighborR * neighborR;
    // Nadir / height projection — same for every fleet (no tilt eye-distance split).
    const nadirPx = projectedWorldSizeAtDistanceToScreenPx(worldSize, camera.cameraY, viewportH, camera.tanHalfFov);
    // Global height band: if even sticky-exit fails, nobody draws models.
    if (camera.assumeHeightGate !== true) {
        // Without sticky global, require enter threshold for a cold start.
        if (nadirPx < exitPx) {
            sticky?.clear();
            return [];
        }
        // Cold: need enter. Warm fleets handled per-fleet sticky below.
        if (nadirPx < enterPx && (sticky == null || sticky.size === 0)) {
            sticky?.clear();
            return [];
        }
    }
    const rEnter = modelLodViewCullRadius(camera.cameraY, camera.tanHalfFov);
    const rExit = rEnter * MODEL_LOD_VIEW_CULL_STICKY_SCALE;
    const rEnter2 = rEnter * rEnter;
    const rExit2 = rExit * rExit;
    const work = [];
    for (let i = 0; i < fleets.length; i++) {
        const f = fleets[i];
        const n = f.shipBudget | 0;
        if (n <= 0)
            continue;
        const id = f.instanceStart | 0;
        const wasOn = sticky?.get(id) === true;
        const dxT = f.posX - camera.targetX;
        const dzT = f.posZ - camera.targetZ;
        const d2 = dxT * dxT + dzT * dzT;
        // Sticky cull: stay in until clearly outside larger radius.
        const inCull = wasOn ? d2 <= rExit2 : d2 <= rEnter2;
        work.push({
            i,
            instanceStart: id,
            shipBudget: n,
            posX: f.posX,
            posZ: f.posZ,
            distLook2: d2,
            wasOn,
            inCull,
        });
    }
    if (work.length === 0) {
        sticky?.clear();
        return [];
    }
    // Union-find neighborhoods so same solar system shares one model band.
    const parent = new Int32Array(work.length);
    for (let i = 0; i < work.length; i++)
        parent[i] = i;
    const find = (a) => {
        let x = a;
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const unite = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent[rb] = ra;
    };
    for (let i = 0; i < work.length; i++) {
        const a = work[i];
        for (let j = i + 1; j < work.length; j++) {
            const b = work[j];
            const dx = a.posX - b.posX;
            const dz = a.posZ - b.posZ;
            if (dx * dx + dz * dz <= neighborR2)
                unite(i, j);
        }
    }
    const comps = new Map();
    for (let i = 0; i < work.length; i++) {
        const w = work[i];
        const r = find(i);
        let c = comps.get(r);
        if (!c) {
            c = { anyInCull: false, anyWasOn: false, root: r };
            comps.set(r, c);
        }
        if (w.inCull)
            c.anyInCull = true;
        if (w.wasOn)
            c.anyWasOn = true;
    }
    // Component model-on decision with hysteresis on nadir px.
    const compModelOn = new Map();
    for (const [root, c] of comps) {
        if (!c.anyInCull) {
            compModelOn.set(root, false);
            continue;
        }
        // Height hysteresis: warm components (any sticky) use exit threshold.
        const warm = c.anyWasOn;
        const heightOk = warm ? nadirPx >= exitPx : nadirPx >= enterPx;
        compModelOn.set(root, heightOk);
    }
    const eligible = [];
    const nextSticky = new Map();
    for (let i = 0; i < work.length; i++) {
        const w = work[i];
        const root = find(i);
        const on = compModelOn.get(root) === true;
        if (on) {
            eligible.push({
                instanceStart: w.instanceStart,
                shipBudget: w.shipBudget,
                distLook2: w.distLook2,
            });
            nextSticky.set(w.instanceStart, true);
        }
    }
    // Replace sticky map contents (drop fleets not seen / demoted).
    if (sticky) {
        sticky.clear();
        for (const [k, v] of nextSticky)
            sticky.set(k, v);
    }
    // Nearest look-at first for budget fairness.
    eligible.sort((a, b) => a.distLook2 - b.distLook2 || a.instanceStart - b.instanceStart);
    const out = [];
    for (let i = 0; i < eligible.length && out.length < cap; i++) {
        const c = eligible[i];
        for (let s = 0; s < c.shipBudget && out.length < cap; s++) {
            out.push(c.instanceStart + s);
        }
    }
    return out;
}
/** Product default model world scale (10× smaller than first model-LOD default 2.5). */
export const MODEL_LOD_DEFAULT_SCALE = 0.25;
// Topology-scoped model eligibility (focus cluster + jump-gate neighbors).
export { buildModelTopologyContext, chooseFocusClusterId, fleetSystemKey, fleetTopologyLocFromState, isFleetModelTopologyEligible, modelLodFleetCullPos, parseInterClusterConnectionKey, resolveModelFocusClusterId, shouldForceIncludeFollowedFleet, shouldResetFleetTrails, } from "./model-topology-lod.js";
// Per-ship model point light at hop/orbit pathEnd.
export { lightDirFromOrbitCenter, modelNdotL, MODEL_LIGHT_CENTER_EPS, MODEL_LIGHT_FALLBACK_DIR, } from "./model-point-light.js";
/** Max per-ship jump start desync (ms) — visual only. */
export const JUMP_STAGGER_MS_MAX = 500;
/** Deterministic 0..maxMs stagger from fleet seed ^ local index. */
export function jumpStaggerMs(seed, localIndex, maxMs = JUMP_STAGGER_MS_MAX) {
    const s = (seed ^ ((localIndex * 0x9e3779b9) >>> 0)) >>> 0;
    const max = Math.max(0, maxMs | 0);
    if (max <= 0)
        return 0;
    return s % (max + 1);
}
/**
 * Cap hysteresis so the near edge stays reachable on promote:
 * min(8% farY, 20% nearY) → min(9600, 1400) = 1400.
 * Uncapped 0.08*farY made nearY−h negative and permanently stuck in MID.
 */
export const DEFAULT_LOD_POLICY = {
    nearY: LOD_NEAR_Y,
    farY: LOD_FAR_Y,
    nearDist: LOD_NEAR_DIST,
    midDist: LOD_MID_DIST,
    capNear: CAP_NEAR,
    capMid: CAP_MID,
    capFar: CAP_FAR,
    globalMaxInstances: GLOBAL_MAX_INSTANCES,
    hysteresisY: Math.min(0.08 * LOD_FAR_Y, 0.2 * LOD_NEAR_Y),
};
const BAND_NEAR = 0;
const BAND_MID = 1;
const BAND_FAR = 2;
/** Ship type scales / colors (match writeFleetFormation / writeFleetImpostor). */
/** World-space base for individual ship triangles (formation + impostor). */
export const BASE_SHIP_SIZE = 0.8;
/** Blue is the mid type; red is 2× blue for NEAR/sim + impostor sizing. */
export const BLUE_SCALE = 3;
export const RED_SCALE = BLUE_SCALE * 2;
export const GREEN_SCALE = 1;
/**
 * Default world diameter for the model-LOD 5px gate (red-scale formation triangle).
 * = {@link BASE_SHIP_SIZE} * {@link RED_SCALE}.
 */
export const MODEL_LOD_REF_WORLD_SIZE = BASE_SHIP_SIZE * RED_SCALE;
const COLOR_RED = { r: 1.0, g: 0.2, b: 0.2 };
const COLOR_BLUE = { r: 0.2, g: 0.6, b: 1.0 };
const COLOR_GREEN = { r: 0.2, g: 1.0, b: 0.4 };
const COLOR_EMPTY = { r: 0.5, g: 0.5, b: 0.5 };
function resolvePolicy(policy) {
    return policy ?? DEFAULT_LOD_POLICY;
}
export function countShips(counts) {
    return counts.red + counts.blue + counts.green;
}
/**
 * Dominant (largest) ship type present: prefer red if red>0, else blue, else green.
 * Empty fleet → typeId -1 / grey / scale 1.
 */
export function dominantShipType(counts) {
    if (counts.red > 0) {
        return { typeId: 0, scale: RED_SCALE, ...COLOR_RED };
    }
    if (counts.blue > 0) {
        return { typeId: 1, scale: BLUE_SCALE, ...COLOR_BLUE };
    }
    if (counts.green > 0) {
        return { typeId: 2, scale: GREEN_SCALE, ...COLOR_GREEN };
    }
    return { typeId: -1, scale: 1, ...COLOR_EMPTY };
}
/**
 * Height-only band (no distance): near below nearY, far(icon) at/above farY, else mid(impostor).
 */
export function classifyHeightBand(cameraY, policy) {
    const p = resolvePolicy(policy);
    if (cameraY < p.nearY)
        return BAND_NEAR;
    if (cameraY >= p.farY)
        return BAND_FAR;
    return BAND_MID;
}
/**
 * Keep `applied` until cameraY crosses the relevant threshold by ±hysteresisY.
 * Prevents LOD flicker when orbiting near a height boundary.
 *
 * Promote (MID/FAR → NEAR) is never sticky-blocked: any cameraY < nearY
 * returns NEAR immediately so zoom-in cannot get stuck in impostor.
 * Demotion (NEAR → MID, MID → FAR) still requires crossing +hysteresisY.
 */
export function heightBandWithHysteresis(cameraY, applied, policy) {
    const p = resolvePolicy(policy);
    const h = p.hysteresisY;
    if (applied === BAND_NEAR) {
        // Leave near only once clearly above nearY (demotion sticky)
        if (cameraY >= p.nearY + h) {
            return cameraY >= p.farY + h ? BAND_FAR : BAND_MID;
        }
        return BAND_NEAR;
    }
    if (applied === BAND_FAR) {
        // Leave far only once clearly below farY
        if (cameraY < p.farY - h) {
            // Promote to formation immediately when under nearY
            return cameraY < p.nearY ? BAND_NEAR : BAND_MID;
        }
        return BAND_FAR;
    }
    // MID: promote under nearY immediately; demote to far only past farY+h
    if (cameraY < p.nearY)
        return BAND_NEAR;
    if (cameraY >= p.farY + h)
        return BAND_FAR;
    return BAND_MID;
}
/**
 * Per-fleet band from camera height + optional light distance.
 * Optional stickyBand applies light hysteresis so nearby fleets do not thrash.
 */
export function classifyFleetLodBand(cameraY, distXZ, stickyBand, policy) {
    const p = resolvePolicy(policy);
    const raw = classifyFleetLodBandRaw(cameraY, distXZ, p);
    if (stickyBand == null || stickyBand === raw)
        return raw;
    return applyStickyBand(cameraY, distXZ, stickyBand, raw, p);
}
/**
 * Height-first raw band. Soft XZ demotes formation→impostor via nearDist;
 * extreme midDist still demotes; icon is height-only (cameraY ≥ farY).
 * GPU view-cull (cameraY·tanHalfFov·scale) is applied only in WGSL.
 */
export function classifyFleetLodBandRaw(cameraY, distXZ, policy) {
    const p = resolvePolicy(policy);
    // Icon — height only
    if (cameraY >= p.farY)
        return BAND_FAR;
    // Impostor band by height
    if (cameraY >= p.nearY)
        return BAND_MID;
    // Extreme distance
    if (distXZ >= p.midDist)
        return BAND_MID;
    // Soft XZ demotion (policy nearDist) — parity with GPU classifyLodBand
    if (distXZ >= p.nearDist)
        return BAND_MID;
    return BAND_NEAR;
}
/**
 * Light sticky: demotions stay sticky (~hysteresisY on height, ~8% on distance).
 * Promotes (raw NEAR / camera under nearY) are never sticky-blocked.
 */
function applyStickyBand(cameraY, distXZ, sticky, raw, p) {
    const h = p.hysteresisY;
    const distSlack = 0.08;
    if (sticky === BAND_NEAR) {
        // Stay formation until clearly into mid height or soft/extreme XZ demote
        if (cameraY < p.nearY + h &&
            distXZ < p.nearDist * (1 + distSlack) &&
            distXZ < p.midDist * (1 + distSlack)) {
            return BAND_NEAR;
        }
    }
    else if (sticky === BAND_MID) {
        if (cameraY < p.farY + h) {
            if (raw === BAND_NEAR) {
                // Promote never blocked by sticky: under nearY + nearDist accepts NEAR
                if (cameraY < p.nearY && distXZ < p.nearDist)
                    return BAND_NEAR;
                return BAND_MID;
            }
            if (raw === BAND_FAR) {
                if (cameraY >= p.farY + h)
                    return BAND_FAR;
                return BAND_MID;
            }
            return BAND_MID;
        }
    }
    else {
        // sticky ICON: stay until clearly below farY
        if (cameraY >= p.farY - h) {
            return BAND_FAR;
        }
    }
    return raw;
}
/**
 * Demotion hold resolver (pure).
 *
 * - Promote (desired band lower / budget higher): apply immediately, clear hold.
 * - Demote: start hold if none; while hold active keep live band/budget;
 *   when hold expires apply desired and clear hold.
 * - Equal: clear hold, use desired.
 *
 * `liveShipCount === 0` (new fleet) never holds — apply desired.
 */
export function resolveLodHold(desired, live, holdUntilMs, nowMs, holdMs = LOD_HOLD_MS) {
    if (live.shipCount <= 0) {
        return {
            band: desired.band,
            shipCount: desired.shipCount,
            holdUntilMs: 0,
            held: false,
        };
    }
    const demoting = desired.band > live.band || desired.shipCount < live.shipCount;
    const promoting = desired.band < live.band || desired.shipCount > live.shipCount;
    if (promoting) {
        return {
            band: desired.band,
            shipCount: desired.shipCount,
            holdUntilMs: 0,
            held: false,
        };
    }
    if (!demoting) {
        return {
            band: desired.band,
            shipCount: desired.shipCount,
            holdUntilMs: 0,
            held: false,
        };
    }
    // Demotion path
    let until = holdUntilMs;
    if (until <= 0) {
        until = nowMs + holdMs;
    }
    if (nowMs < until) {
        return {
            band: live.band,
            shipCount: live.shipCount,
            holdUntilMs: until,
            held: true,
        };
    }
    // Hold expired — apply demotion
    return {
        band: desired.band,
        shipCount: desired.shipCount,
        holdUntilMs: 0,
        held: false,
    };
}
/**
 * Proportional scale with largest-remainder so sum === min(budget, total).
 * Never invents a type that was 0. If budget≥1 and total≥1, sum ≥ 1.
 */
export function scaleCountsToBudget(counts, budget) {
    const red = Math.max(0, counts.red | 0);
    const blue = Math.max(0, counts.blue | 0);
    const green = Math.max(0, counts.green | 0);
    const total = red + blue + green;
    if (total === 0 || budget <= 0) {
        return { red: 0, blue: 0, green: 0 };
    }
    const target = Math.min(budget | 0, total);
    if (target <= 0) {
        return { red: 0, blue: 0, green: 0 };
    }
    const parts = [];
    const push = (key, n) => {
        if (n <= 0)
            return;
        const exact = (n / total) * target;
        const floor = Math.floor(exact);
        parts.push({ key, floor, rem: exact - floor });
    };
    push("red", red);
    push("blue", blue);
    push("green", green);
    let floorSum = 0;
    for (const part of parts)
        floorSum += part.floor;
    let remaining = target - floorSum;
    // Largest remainder; stable key order breaks ties so results are deterministic
    const keyOrder = { red: 0, blue: 1, green: 2 };
    parts.sort((a, b) => {
        if (b.rem !== a.rem)
            return b.rem - a.rem;
        return keyOrder[a.key] - keyOrder[b.key];
    });
    for (let i = 0; i < remaining && i < parts.length; i++) {
        parts[i].floor += 1;
    }
    const out = { red: 0, blue: 0, green: 0 };
    for (const part of parts) {
        out[part.key] = part.floor;
    }
    // Safety: floating edge cases must still guarantee ≥1 when both sides non-empty
    const outSum = out.red + out.blue + out.green;
    if (outSum === 0 && target >= 1) {
        if (red > 0)
            out.red = 1;
        else if (blue > 0)
            out.blue = 1;
        else
            out.green = 1;
    }
    return out;
}
/**
 * World-space formation scale helper = BASE_SHIP_SIZE * dominant type scale.
 * Empty fleet → 0. Live GPU MID/FAR LOD use {@link ICON_SCREEN_PX}, not this.
 */
export function impostorSize(counts) {
    if (countShips(counts) <= 0)
        return 0;
    return BASE_SHIP_SIZE * dominantShipType(counts).scale;
}
/** Color of dominant ship type; neutral grey if empty. */
export function impostorColor(counts) {
    if (countShips(counts) <= 0)
        return { ...COLOR_EMPTY };
    const d = dominantShipType(counts);
    return { r: d.r, g: d.g, b: d.b };
}
/**
 * Classify each fleet, sort near→far then by distance, assign instance budgets
 * under globalMaxInstances with **reserve-1 fairness**:
 *
 * 1. Pass 1 — each non-empty fleet gets min(1, desired, remaining) in priority order
 * 2. Pass 2 — fill remaining toward full desired (band caps), still near-first
 *
 * Far/mid fleets only starve when globalMax is smaller than the non-empty fleet count.
 */
export function allocateFleetLodBudgets(fleets, cameraY, policy) {
    const p = resolvePolicy(policy);
    const work = new Array(fleets.length);
    for (let i = 0; i < fleets.length; i++) {
        const f = fleets[i];
        const total = countShips(f.trueCounts);
        const band = classifyFleetLodBand(cameraY, f.distXZ, f.stickyBand, p);
        // Formation: min(total, capNear). Impostor/icon: single triangle when non-empty.
        const desired = total <= 0
            ? 0
            : band === BAND_NEAR
                ? Math.min(total, p.capNear)
                : 1;
        work[i] = {
            index: f.index,
            band,
            distXZ: f.distXZ,
            total,
            trueCounts: f.trueCounts,
            desired,
            shipCount: 0,
        };
    }
    // Near first, then closer fleets — preserve visual density where it matters
    work.sort((a, b) => {
        if (a.band !== b.band)
            return a.band - b.band;
        if (a.distXZ !== b.distXZ)
            return a.distXZ - b.distXZ;
        return a.index - b.index;
    });
    let remaining = p.globalMaxInstances;
    // Pass 1: reserve 1 instance per non-empty fleet (fairness before near fill)
    for (let i = 0; i < work.length; i++) {
        const w = work[i];
        if (w.desired <= 0 || remaining <= 0)
            continue;
        const grant = Math.min(1, w.desired, remaining);
        w.shipCount = grant;
        remaining -= grant;
    }
    // Pass 2: fill toward full desired, still priority order
    for (let i = 0; i < work.length; i++) {
        const w = work[i];
        if (w.desired <= w.shipCount || remaining <= 0)
            continue;
        const add = Math.min(w.desired - w.shipCount, remaining);
        w.shipCount += add;
        remaining -= add;
    }
    const allocations = new Array(work.length);
    let totalInstances = 0;
    for (let i = 0; i < work.length; i++) {
        const w = work[i];
        const shipCount = w.shipCount;
        totalInstances += shipCount;
        const isImpostor = w.band === BAND_MID && shipCount > 0;
        const isIcon = w.band === BAND_FAR && shipCount > 0;
        // Formation: scaled visual counts. Impostor/icon: packer uses true counts.
        const visualCounts = shipCount <= 0 || isImpostor || isIcon
            ? { red: 0, blue: 0, green: 0 }
            : scaleCountsToBudget(w.trueCounts, shipCount);
        allocations[i] = {
            index: w.index,
            band: w.band,
            isImpostor,
            isIcon,
            shipCount,
            visualCounts,
        };
    }
    // Restore input order for stable consumers (allocator sorted a working copy)
    allocations.sort((a, b) => a.index - b.index);
    return { allocations, totalInstances };
}
/**
 * Build a FleetLodAllocation for a held (or raw) band + shipCount from true counts.
 * Used by map-view when demotion hold overrides the allocator.
 */
export function allocationForBand(index, band, shipCount, trueCounts) {
    const total = countShips(trueCounts);
    const n = total <= 0 ? 0 : Math.max(0, shipCount | 0);
    const isImpostor = band === BAND_MID && n > 0;
    const isIcon = band === BAND_FAR && n > 0;
    const visualCounts = n <= 0 || isImpostor || isIcon
        ? { red: 0, blue: 0, green: 0 }
        : scaleCountsToBudget(trueCounts, n);
    return {
        index,
        band,
        isImpostor,
        isIcon,
        shipCount: n,
        visualCounts,
    };
}
//# sourceMappingURL=fleet-lod.js.map