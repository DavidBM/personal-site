/**
 * Band B / Band C sticky LOD policy (pure, no GPU / DOM).
 *
 * Galaxy point LOD stays O(clusters) in galaxy-point-lod.ts.
 * This module owns SYSTEM_LOCAL_SPAN + one Schmitt pair (enter/exit px + hold).
 * Span is 0.1 (point-scale Kepler) — do not add a second reveal-radius constant.
 *
 * Pixels are **drawing-buffer** height (canvas.height), not CSS viewportH.
 */
import { RENDER_PLANE_Y } from "../contracts/render-constants.js";
import { LOD_HOLD_MS, projectedWorldSizeAtDistanceToScreenPx } from "./fleet-lod.js";
import { keplerPhaseLocalF32 } from "./math/world-origin.js";
/**
 * Compact Kepler field diameter (world). Neighbors sit ~25 apart, so span 0.1
 * is 250 diameters away. Schmitt uses projected {@link SYSTEM_LOCAL_SPAN} only
 * — do not add a second reveal-radius constant.
 */
export const SYSTEM_LOCAL_SPAN = 0.1;
/** Showcase outer orbit (solar-bodies / planet-catalog). */
export const SHOWCASE_ORBIT_SPAN = 56;
/** Uniform scale so showcase orbits fit {@link SYSTEM_LOCAL_SPAN}. */
export const KEPLER_SCALE = SYSTEM_LOCAL_SPAN / SHOWCASE_ORBIT_SPAN;
/**
 * Enter Band B when projected span ≥ this (drawing-buffer px).
 * At the 5% sun/span ratio, sun diameter here is
 * `2 * 0.005 / 0.1 * 50 = 5` = `SYSTEM_POINT_DIAMETER_PX` — the 5px icon
 * becomes a 5px sun rather than a 24px field pop.
 */
export const SCENE_ENTER_PX = 50;
/** Leave Band B only when projected span ≤ this (~30% Schmitt vs enter). */
export const SCENE_EXIT_PX = 35;
/** Demotion hold — same family as fleet model LOD. */
export const SCENE_HOLD_MS = LOD_HOLD_MS;
/** Band C limb enter (pure helper; live map is click-lock only). */
export const FOCUS_ENTER_PX = 180;
/** Band C limb exit. */
export const FOCUS_EXIT_PX = 130;
/** Band C demotion hold. */
export const FOCUS_HOLD_MS = SCENE_HOLD_MS;
/**
 * Skip planets smaller than this unless focused (sun is never skipped).
 * Product draw policy for Band B — not a second Schmitt span constant.
 */
export const BODY_SCREEN_R_MIN = 1.5;
function keplerPhaseAt(phase0, period, timeSec) {
    return phase0 + (timeSec / Math.max(1e-6, period)) * Math.PI * 2;
}
/**
 * World pose of a compact Kepler slot (y = gameplay plane).
 * Optional `out` reuses a scratch vec so the rAF parking path does not alloc.
 */
export function composeCompactBodyWorld(store, index, timeSec, out) {
    if (index < 0 || index >= store.currentCount)
        return null;
    const dest = out ?? { x: 0, y: RENDER_PLANE_Y, z: 0 };
    if (store.isSun[index]) {
        dest.x = store.systemX;
        dest.y = RENDER_PLANE_Y;
        dest.z = store.systemZ;
        return dest;
    }
    const local = keplerPhaseLocalF32(KEPLER_SCALE, store.orbitRadius[index], keplerPhaseAt(store.phase0[index], store.orbitPeriod[index], timeSec));
    dest.x = store.systemX + local.x;
    dest.y = RENDER_PLANE_Y;
    dest.z = store.systemZ + local.z;
    return dest;
}
/**
 * Stable SCENE park body for a fleet. Skip the sun; if there are no planets,
 * fall back to index 0 (sun).
 */
export function pickSceneParkBodyIndex(fleetIdHash, store) {
    const n = store.currentCount | 0;
    if (n <= 0)
        return 0;
    let planets = 0;
    for (let i = 0; i < n; i++) {
        if (!store.isSun[i])
            planets++;
    }
    if (planets <= 0)
        return 0;
    const pick = (fleetIdHash >>> 0) % planets;
    let k = 0;
    for (let i = 0; i < n; i++) {
        if (store.isSun[i])
            continue;
        if (k === pick)
            return i;
        k++;
    }
    return 0;
}
/**
 * World-space camera → body on the gameplay plane (y = {@link RENDER_PLANE_Y}).
 *
 * Use this for screenR, never `hypot(centerRel − eyeRel)` after a y=0 compose:
 * camera-origin dive then collapses dist to 0 (`|| 1`) and every planet
 * passes the 1.5 px gate at a 34 px span.
 */
export function cameraToPlaneDistance(eyeX, eyeY, eyeZ, worldX, worldZ) {
    return Math.hypot(worldX - eyeX, RENDER_PLANE_Y - eyeY, worldZ - eyeZ);
}
/** Projected limb radius in drawing-buffer px at camera distance `dist`. */
export function bodyScreenRadiusPx(radiusWorld, dist, viewportH, fovyDeg) {
    const halfFov = ((fovyDeg * Math.PI) / 180) * 0.5;
    return projectedWorldSizeAtDistanceToScreenPx(radiusWorld, dist, viewportH, Math.tan(halfFov));
}
/** Sun always draws (replaces the 5px). Planets need screenR ≥ 1.5 unless focused. */
export function shouldEncodeBandBBody(isSun, screenR, focused) {
    if (isSun)
        return true;
    if (focused)
        return true;
    return screenR >= BODY_SCREEN_R_MIN;
}
/** Projected screen px of {@link SYSTEM_LOCAL_SPAN} at distance `d`. */
export function systemSpanScreenPx(d, viewportH, fovyDeg) {
    const halfFov = ((fovyDeg * Math.PI) / 180) * 0.5;
    return projectedWorldSizeAtDistanceToScreenPx(SYSTEM_LOCAL_SPAN, d, viewportH, Math.tan(halfFov));
}
/** Camera distance where {@link SYSTEM_LOCAL_SPAN} projects to `px`. */
export function distanceForSpanPx(px, viewportH, fovyDeg) {
    const halfFov = ((fovyDeg * Math.PI) / 180) * 0.5;
    const th = Math.tan(halfFov);
    const p = Math.max(1e-6, px);
    return (SYSTEM_LOCAL_SPAN * Math.max(1, viewportH)) / (2 * p * th);
}
/** Nearest candidate to look-at (xz). */
export function pickLookAtWinner(candidates, lookAtX, lookAtZ) {
    let bestId = null;
    let bestD2 = Infinity;
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const dx = c.x - lookAtX;
        const dz = c.z - lookAtZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
            bestD2 = d2;
            bestId = c.id;
        }
    }
    return bestId;
}
/**
 * Nearest cluster center to look-at. Caller walks O(clusters) and skips
 * empty clusters — never a full-galaxy system list.
 */
export function pickLookAtClusterId(forEachCluster, lookAtX, lookAtZ) {
    let bestId = null;
    let bestD2 = Infinity;
    forEachCluster((id, x, z) => {
        const dx = x - lookAtX;
        const dz = z - lookAtZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
            bestD2 = d2;
            bestId = id;
        }
    });
    return bestId;
}
/**
 * Fill `out` with one cluster’s systems (≤80) plus `prevSceneId` if it is
 * not already in that list. Reuses `out[i]` objects; sets `out.length`.
 */
export function fillSceneCandidatesForCluster(out, systemIds, recs, prevSceneId) {
    let n = 0;
    const write = (id) => {
        const rec = recs.get(id);
        if (!rec)
            return;
        let c = out[n];
        if (!c) {
            c = { id, x: rec.x, z: rec.z };
            out[n] = c;
        }
        else {
            c.id = id;
            c.x = rec.x;
            c.z = rec.z;
        }
        n++;
    };
    for (let i = 0; i < systemIds.length; i++) {
        write(systemIds[i]);
    }
    if (prevSceneId != null) {
        let hasPrev = false;
        for (let i = 0; i < systemIds.length; i++) {
            if (systemIds[i] === prevSceneId) {
                hasPrev = true;
                break;
            }
        }
        if (!hasPrev)
            write(prevSceneId);
    }
    out.length = n;
    return out;
}
/**
 * One sticky SCENE system (look-at winner).
 *
 * Enter when span ≥ 24 px; stay until span ≤ 16 px **and** hold 2500 ms.
 * Switching look-at winner while still in-band is immediate (promote).
 */
export function oneSceneWithHysteresis(input) {
    const spanPx = systemSpanScreenPx(input.d, input.viewportH, input.fovyDeg);
    const winnerId = pickLookAtWinner(input.candidates, input.lookAtX, input.lookAtZ);
    const prev = input.prev;
    if (winnerId == null) {
        return { sceneId: null, holdStartMs: 0, spanPx, winnerId: null };
    }
    if (prev.sceneId != null) {
        if (spanPx > SCENE_EXIT_PX) {
            // Stay in band — follow look-at winner (at most one catalog SCENE).
            return {
                sceneId: winnerId,
                holdStartMs: 0,
                spanPx,
                winnerId,
            };
        }
        const holdStart = prev.holdStartMs > 0 ? prev.holdStartMs : input.nowMs;
        if (input.nowMs - holdStart >= SCENE_HOLD_MS) {
            return { sceneId: null, holdStartMs: 0, spanPx, winnerId };
        }
        return {
            sceneId: prev.sceneId,
            holdStartMs: holdStart,
            spanPx,
            winnerId,
        };
    }
    if (spanPx >= SCENE_ENTER_PX) {
        return { sceneId: winnerId, holdStartMs: 0, spanPx, winnerId };
    }
    return { sceneId: null, holdStartMs: 0, spanPx, winnerId };
}
/**
 * Band C: sticky focus on one body limb. Pure helper for tests.
 * Live map camera is click-lock only — do not call this from `tick()`.
 * Enter when the winning limb ≥ 180 px; exit ≤ 130 px + hold.
 */
export function planetFocusWithHysteresis(input) {
    const limbs = input.limbPx;
    let bestI = -1;
    let bestPx = -1;
    for (let i = 0; i < limbs.length; i++) {
        const px = limbs[i];
        if (px > bestPx) {
            bestPx = px;
            bestI = i;
        }
    }
    if (bestI < 0) {
        return { focusIndex: null, holdStartMs: 0 };
    }
    const prev = input.prev;
    if (prev.focusIndex != null) {
        const px = limbs[prev.focusIndex] ?? 0;
        if (px > FOCUS_EXIT_PX) {
            if (bestI !== prev.focusIndex && bestPx >= FOCUS_ENTER_PX) {
                return { focusIndex: bestI, holdStartMs: 0 };
            }
            return { focusIndex: prev.focusIndex, holdStartMs: 0 };
        }
        const holdStart = prev.holdStartMs > 0 ? prev.holdStartMs : input.nowMs;
        if (input.nowMs - holdStart >= FOCUS_HOLD_MS) {
            return { focusIndex: null, holdStartMs: 0 };
        }
        return { focusIndex: prev.focusIndex, holdStartMs: holdStart };
    }
    if (bestPx >= FOCUS_ENTER_PX) {
        return { focusIndex: bestI, holdStartMs: 0 };
    }
    return { focusIndex: null, holdStartMs: 0 };
}
//# sourceMappingURL=solar-system-lod.js.map