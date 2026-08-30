/**
 * Sun-local numeric space for one compact Kepler SCENE.
 *
 * Galaxy abs is only for placing the jewel on the map. Sim / draw inside the
 * SCENE use local coordinates with the sun at the origin. Do not mix a
 * galaxy-abs eye at |xz| ≳ 1e5 into this frame.
 *
 * Local diameter is {@link SYSTEM_SCENE_SPAN} (1). Compact Kepler world
 * diameter {@link SYSTEM_LOCAL_SPAN} (0.1) maps onto that via {@link systemSceneUnit}.
 * Live parking / ShipSim use {@link compactBodySunLocal} (subtract sun only).
 */
import { SYSTEM_LOCAL_SPAN, composeCompactBodyWorld, } from "../solar-system-lod.js";
/** Local diameter of the compact Kepler field. */
export const SYSTEM_SCENE_SPAN = 1.0;
/**
 * Rings + 50% sit inside this multiple of SPAN/2 (local radius 0.75).
 * Outer compact ring (SPAN/2) is local 0.5; pad 1.5 → 0.75.
 */
export const SYSTEM_SCENE_PAD = 1.5;
/** SPAN / SYSTEM_LOCAL_SPAN — compact outer ring (SPAN/2) → local 0.5. */
export function systemSceneUnit() {
    return SYSTEM_SCENE_SPAN / SYSTEM_LOCAL_SPAN;
}
export function createSystemSceneFrame(sunX, sunZ) {
    return { sunX, sunZ, unit: systemSceneUnit() };
}
/**
 * Galaxy abs → sun-local. Sun y is 0; `toSystemLocal(frame, sunX, 0, sunZ)`
 * is (0,0,0).
 */
export function toSystemLocal(frame, gx, gy, gz) {
    const u = frame.unit;
    return {
        x: (gx - frame.sunX) * u,
        y: gy * u,
        z: (gz - frame.sunZ) * u,
    };
}
/** Sun-local → galaxy abs. Inverse of {@link toSystemLocal}. */
export function fromSystemLocal(frame, lx, ly, lz) {
    const inv = frame.unit !== 0 ? 1 / frame.unit : 0;
    return {
        x: lx * inv + frame.sunX,
        y: ly * inv,
        z: lz * inv + frame.sunZ,
    };
}
/**
 * Compact Kepler pose with the sun subtracted (no {@link systemSceneUnit}).
 * Sun slot → (0, y, 0). Planet → Kepler-local offset even when `systemX` is 1e5.
 */
export function compactBodySunLocal(store, index, timeSec, out) {
    const world = composeCompactBodyWorld(store, index, timeSec, out);
    if (!world)
        return null;
    world.x -= store.systemX;
    world.z -= store.systemZ;
    return world;
}
//# sourceMappingURL=frame.js.map