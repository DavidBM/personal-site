/** A mutable renderer-owned observation, distinct from the caller's allocation.
 * Copy optional fields explicitly so a removed intent/override cannot survive.
 * Nested geometry/state is borrowed read-only; it is never rewritten here. */
export function copySceneFleetRow(source, out = {}) {
    out.id = source.id;
    out.generation = source.generation;
    out.slot = source.slot;
    out.gpuSlot = source.gpuSlot;
    out.groupId = source.groupId;
    out.systemId = source.systemId;
    out.instanceStart = source.instanceStart;
    out.shipCount = source.shipCount;
    out.paused = source.paused;
    out.serialBase = source.serialBase;
    out.type = source.type;
    out.marker = source.marker;
    out.warpOffsets = source.warpOffsets;
    out.orbitSeedOrigin = source.orbitSeedOrigin;
    out.bodyIndex = source.bodyIndex;
    out.bodyRadius = source.bodyRadius;
    out.toward = source.toward;
    out.nowMs = source.nowMs;
    out.fromX = source.fromX;
    out.fromZ = source.fromZ;
    out.toX = source.toX;
    out.toZ = source.toZ;
    out.classCounts = source.classCounts;
    out.state = source.state;
    out.plan = source.plan;
    out.ownerSystemId = source.ownerSystemId;
    out.retainedCount = source.retainedCount;
    out.retainedPlan = source.retainedPlan;
    return out;
}
/** Rows may change within one occupant's lifetime. Replacing an occupant creates
 * a new row, so async admission/route work cannot see a different fleet in it. */
export function createSceneFleetRows(capacity) {
    const rows = new Array(capacity);
    const seen = new Uint8Array(capacity);
    return {
        begin() { seen.fill(0); },
        copy(source) {
            const slot = source.slot ?? 0;
            if (!Number.isInteger(slot) || slot < 0 || slot >= capacity)
                throw Error('Invalid scene fleet row slot');
            const old = rows[slot];
            const same = old && old.id === source.id && old.generation === source.generation && old.systemId === source.systemId;
            const row = copySceneFleetRow(source, same ? old : undefined);
            rows[slot] = row;
            seen[slot] = 1;
            return row;
        },
        end() { for (let i = 0; i < capacity; i++)
            if (!seen[i])
                rows[i] = undefined; },
        clear() { rows.fill(undefined); seen.fill(0); },
    };
}
//# sourceMappingURL=scene-fleet-row.js.map