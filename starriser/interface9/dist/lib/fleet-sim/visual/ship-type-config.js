/**
 * Per **ship type** motion config (not per instance).
 *
 * typeId 0/1/2 = red / blue / green. Instances inherit at pack init via
 * {@link hashShipMotionParams} (accel/cruise × personal variance; omegaMax fixed).
 *
 * Defaults preserve historic type muls (1 / 2 / 10) on cruise + accel relative
 * to {@link SHIP_MAX_SPEED} / {@link SHIP_MAX_ACCEL}. Red turn rate matches
 * {@link SHIP_MAX_TURN_RAD_S} so planar production feel is unchanged.
 */
import { SHIP_MAX_ACCEL, SHIP_MAX_SPEED, SHIP_MAX_TURN_RAD_S, SHIP_TYPE_MUL_BLUE, SHIP_TYPE_MUL_GREEN, SHIP_TYPE_MUL_RED, } from "./ship-motion-config.js";
/**
 * Built-in table. Red baseline = global SHIP_MAX_*; blue/green scale cruise+accel
 * by historic SHIP_TYPE_MUL_*. Turn: red = SHIP_MAX_TURN_RAD_S; blue/green slightly
 * higher for demos only (does not change red planar hop feel).
 */
const BUILTIN_SHIP_TYPE_CONFIGS = [
    {
        typeId: 0,
        name: "red",
        maxCruiseSpeed: SHIP_MAX_SPEED * SHIP_TYPE_MUL_RED,
        maxTurnRadS: SHIP_MAX_TURN_RAD_S,
        maxAccel: SHIP_MAX_ACCEL * SHIP_TYPE_MUL_RED,
    },
    {
        typeId: 1,
        name: "blue",
        maxCruiseSpeed: SHIP_MAX_SPEED * SHIP_TYPE_MUL_BLUE,
        maxTurnRadS: SHIP_MAX_TURN_RAD_S * 1.25,
        maxAccel: SHIP_MAX_ACCEL * SHIP_TYPE_MUL_BLUE,
    },
    {
        typeId: 2,
        name: "green",
        maxCruiseSpeed: SHIP_MAX_SPEED * SHIP_TYPE_MUL_GREEN,
        maxTurnRadS: SHIP_MAX_TURN_RAD_S * 1.5,
        maxAccel: SHIP_MAX_ACCEL * SHIP_TYPE_MUL_GREEN,
    },
];
/** Mutable override table for demos; null → use builtins. */
let _overrideTable = null;
/** Resolve config for typeId (0 red / 1 blue / 2 green). Unknown → red. */
export function getShipTypeConfig(typeId) {
    const tid = typeId | 0;
    const table = _overrideTable ?? BUILTIN_SHIP_TYPE_CONFIGS;
    for (let i = 0; i < table.length; i++) {
        const c = table[i];
        if (c.typeId === tid)
            return c;
    }
    // Fallback: red baseline (or first entry)
    for (let i = 0; i < table.length; i++) {
        if (table[i].typeId === 0)
            return table[i];
    }
    return table[0] ?? BUILTIN_SHIP_TYPE_CONFIGS[0];
}
/** Snapshot of active type configs (builtins or demo override). */
export function listShipTypeConfigs() {
    return _overrideTable ?? BUILTIN_SHIP_TYPE_CONFIGS;
}
/**
 * Demo / test override: replace the whole type table.
 * Pass `null` to restore builtins. Does not mutate shared const entries —
 * store a new array of configs.
 */
export function setShipTypeConfigTable(configs) {
    if (configs === null) {
        _overrideTable = null;
        return;
    }
    _overrideTable = configs.map((c) => ({ ...c }));
}
/**
 * Convenience: patch one typeId in the active table (copy-on-write).
 * Creates an override from builtins if none is set.
 */
export function setShipTypeConfig(typeId, partial) {
    const tid = typeId | 0;
    const base = listShipTypeConfigs();
    const next = base.map((c) => ({ ...c }));
    let found = false;
    for (let i = 0; i < next.length; i++) {
        if (next[i].typeId === tid) {
            next[i] = { ...next[i], ...partial, typeId: tid };
            found = true;
            break;
        }
    }
    if (!found) {
        next.push({
            typeId: tid,
            maxCruiseSpeed: SHIP_MAX_SPEED,
            maxTurnRadS: SHIP_MAX_TURN_RAD_S,
            maxAccel: SHIP_MAX_ACCEL,
            ...partial,
        });
    }
    _overrideTable = next;
}
//# sourceMappingURL=ship-type-config.js.map