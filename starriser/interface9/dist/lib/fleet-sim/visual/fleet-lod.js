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