/**
 * Year-1 hashed sticky pass-set — discrete module combo only:
 *   { discs, sun, atm, models, integrate-split }
 *
 * This is **not** a Frostbite / Unreal RDG. WebGPU already inserts barriers.
 * Compile this year is “skip the unused `encode` call,” not “rebuild a DAG of
 * PassData at 120 Hz.” Pipelines stay init-time; the hash is a sticky `number`.
 *
 * Bit packing (stable 32-bit; same flags ⇒ same hash; flip any ⇒ different):
 *
 * | Bit | Flag            | Live map meaning                                              |
 * |-----|-----------------|---------------------------------------------------------------|
 * | 0   | `discs`         | Band-B planet draws recorded (non-sun body + SCENE open)      |
 * | 1   | `sun`           | Band-B sun draw recorded (SCENE open + store has a sun)       |
 * | 2   | `atm`           | O’Neil on Band-B discs and/or Band-C FOCUS (Hillaire / O’Neil)|
 * | 3   | `models`        | `modelOn && modelN > 0` after `selectModelLod`                |
 * | 4   | `integrateSplit`| Follow lockstep (`followShipIndex != null`) — names the split |
 *
 * Do **not** hash points, Line2, overlays, or `cs_fleets`. Do **not** skip
 * `cs_ships` via this hash (host skip + compact own that).
 *
 * Pure: no GPU types, no map-view import, no allocations in
 * {@link hashPassSet} (bit ops on a number).
 */
export const PASS_SET_BITS = {
    discs: 1 << 0,
    sun: 1 << 1,
    atm: 1 << 2,
    models: 1 << 3,
    integrateSplit: 1 << 4,
};
/** Reused dest for the view’s one flags field. Caller owns the object. */
export function createPassSetFlags() {
    return {
        discs: false,
        sun: false,
        atm: false,
        models: false,
        integrateSplit: false,
    };
}
/**
 * Mutate `dest` in place (no allocation). Positional args so the hot path
 * does not allocate `{ discs, … }`.
 */
export function fillPassSetFlags(dest, discs, sun, atm, models, integrateSplit) {
    dest.discs = discs;
    dest.sun = sun;
    dest.atm = atm;
    dest.models = models;
    dest.integrateSplit = integrateSplit;
    return dest;
}
/** Stable 32-bit. Same flags ⇒ same hash. Flip any flag ⇒ different hash. */
export function hashPassSet(flags) {
    let h = 0;
    if (flags.discs)
        h |= PASS_SET_BITS.discs;
    if (flags.sun)
        h |= PASS_SET_BITS.sun;
    if (flags.atm)
        h |= PASS_SET_BITS.atm;
    if (flags.models)
        h |= PASS_SET_BITS.models;
    if (flags.integrateSplit)
        h |= PASS_SET_BITS.integrateSplit;
    return h >>> 0;
}
/** True if any slot in `[0, count)` is a sun (`isSun[i] !== 0`). */
export function solarStoreHasSun(isSun, count) {
    const n = count | 0;
    for (let i = 0; i < n; i++) {
        if (isSun[i])
            return true;
    }
    return false;
}
/** True if any slot in `[0, count)` is a non-sun disc. */
export function solarStoreHasDisc(isSun, count) {
    const n = count | 0;
    for (let i = 0; i < n; i++) {
        if (!isSun[i])
            return true;
    }
    return false;
}
//# sourceMappingURL=pass-set.js.map