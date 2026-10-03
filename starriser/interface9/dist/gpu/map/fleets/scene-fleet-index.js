import { sceneFleetFingerprint } from './directed-present.wgsl.js';
export const SCENE_MEMBERSHIP_CHANGED = 1;
export const SCENE_OCCUPANCY_CHANGED = 2;
const STRIDE = 6;
const INDEX_CHANGED = 4;
/** Bounded scene-slot index, not a replacement for persistent external fleet IDs.
 * Capture scalars: callers may mutate their rows before the next update. The
 * index borrows current rows; it never changes or pools rows retained elsewhere. */
export function createSceneFleetIndex(capacity) {
    const slots = new Array(capacity);
    const ids = [];
    const numbers = new Float64Array(capacity * STRIDE);
    const idSlots = new Map();
    let count = 0, pausedKey = '';
    function clear() {
        slots.fill(undefined);
        ids.length = 0;
        idSlots.clear();
        count = 0;
        pausedKey = '';
    }
    function update(fleets, poses) {
        if (fleets.length > capacity)
            throw new Error('Scene fleet index capacity exceeded');
        let changes = fleets.length === count ? 0 : 7;
        slots.fill(undefined);
        for (let i = 0; i < fleets.length; i++)
            changes |= captureFleet(fleets[i], i);
        count = fleets.length;
        ids.length = count;
        if (changes & INDEX_CHANGED) {
            idSlots.clear();
            for (const fleet of fleets)
                idSlots.set(fleet.id ?? '', fleet.slot ?? 0);
        }
        // Legacy/component paused poses are CPU-owned inputs. Production passes null.
        const key = pausedPoseKey(fleets, poses);
        if (key !== pausedKey)
            changes |= SCENE_MEMBERSHIP_CHANGED;
        pausedKey = key;
        return changes & (SCENE_MEMBERSHIP_CHANGED | SCENE_OCCUPANCY_CHANGED);
    }
    function captureFleet(fleet, index) {
        const id = fleet.id ?? '', slot = fleet.slot ?? 0, at = index * STRIDE;
        if (!Number.isInteger(slot) || slot < 0 || slot >= capacity)
            throw new Error('Invalid scene fleet slot');
        const identityChanged = ids[index] !== id || numbers[at] !== slot;
        const changes = captureNumbers(numbers, at, fleet);
        ids[index] = id;
        slots[slot] = fleet;
        return changes | (identityChanged ? 7 : 0);
    }
    return { update, clear, slots,
        get(id) { const slot = idSlots.get(id); return slot == null ? undefined : slots[slot]; },
    };
}
function pausedPoseKey(fleets, poses) {
    return poses && fleets.length && fleets.every(fleet => fleet.paused) ? sceneFleetFingerprint(fleets, poses) : '';
}
function captureNumber(data, at, value) {
    const old = data[at];
    data[at] = value;
    return old !== value && !(Number.isNaN(old) && Number.isNaN(value));
}
function captureNumbers(data, at, fleet) {
    // Do not short-circuit: every field must be captured, including after a change.
    const slot = captureNumber(data, at, fleet.slot ?? 0);
    const size = captureNumber(data, at + 1, fleet.shipCount);
    const generation = captureNumber(data, at + 2, fleet.generation ?? 0);
    const system = captureNumber(data, at + 3, fleet.ownerSystemId ?? fleet.systemId ?? NaN);
    const start = captureNumber(data, at + 4, fleet.instanceStart);
    const paused = captureNumber(data, at + 5, Number(fleet.paused));
    const occupancy = Number(slot) | Number(size);
    const membership = occupancy | Number(generation) | Number(system) | Number(start) | Number(paused);
    return occupancy * SCENE_OCCUPANCY_CHANGED | membership * SCENE_MEMBERSHIP_CHANGED;
}
//# sourceMappingURL=scene-fleet-index.js.map