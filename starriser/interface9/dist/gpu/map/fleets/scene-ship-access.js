export const SCENE_SHIP_HANDLE_BASE = 0x10000000;
const ORDINAL_CAPACITY = 8192;
let nextSerial = SCENE_SHIP_HANDLE_BASE;
export class SceneShipAccess {
    constructor() {
        this.fleets = new Map();
        this.handles = new Map();
    }
    /** O(scene fleets), only on membership/table changes. Physical moves keep owners. */
    sync(fleets, ranges) {
        const live = new Set();
        for (const fleet of fleets) {
            if (!fleet.id)
                continue;
            live.add(fleet.id);
            const entry = this.ensureFleet(fleet);
            const range = ranges.get(entry.slot);
            entry.start = range?.start ?? -1;
            entry.count = Math.min(fleet.shipCount, range?.cap ?? 0);
            fleet.serialBase = entry.base;
        }
        for (const [id] of this.fleets)
            if (!live.has(id))
                this.fleets.delete(id);
        for (const [id, row] of this.handles) {
            if (this.fleets.get(row.handle.fleetId) !== row.owner || row.handle.ordinal >= row.owner.count)
                this.handles.delete(id);
        }
    }
    ensureFleet(fleet) {
        const generation = fleet.generation ?? 0;
        let entry = this.fleets.get(fleet.id);
        if (!entry || entry.generation !== generation) {
            // Never wrap a serial into an old handle or silently alias another ship.
            if (nextSerial + ORDINAL_CAPACITY > 0xffffffff)
                throw new Error('Scene ship serial space exhausted');
            entry = { fleetId: fleet.id, generation, slot: fleet.slot ?? 0, base: nextSerial, count: 0, start: -1 };
            nextSerial += ORDINAL_CAPACITY;
            this.fleets.set(fleet.id, entry);
        }
        entry.slot = fleet.slot ?? 0;
        return entry;
    }
    capture(fleetId, ordinal) {
        const owner = this.fleets.get(fleetId);
        if (!owner || !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= owner.count)
            return null;
        const id = owner.base + ordinal;
        let row = this.handles.get(id);
        if (!row) {
            row = { handle: Object.freeze({ id, fleetId, ordinal, generation: owner.generation }), owner };
            this.handles.set(id, row);
        }
        return row.handle;
    }
    resolve(id) {
        const row = this.handles.get(id);
        if (!row || this.fleets.get(row.handle.fleetId) !== row.owner || row.handle.ordinal >= row.owner.count || row.owner.start < 0)
            return null;
        return { handle: row.handle, kernelIndex: row.owner.start + row.handle.ordinal };
    }
    fleetSlot(fleetId) { return this.fleets.get(fleetId)?.slot ?? null; }
    serialBase(fleetId) { return this.fleets.get(fleetId)?.base; }
    clear() { this.fleets.clear(); this.handles.clear(); }
}
//# sourceMappingURL=scene-ship-access.js.map