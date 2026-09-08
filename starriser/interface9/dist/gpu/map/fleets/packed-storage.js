import { FLEET_SHIP_DRAW_FLOATS } from "../../fleet-ship-pack.js";
import { GLOBAL_MAX_INSTANCES, GPU_FLEET_CAPACITY_MIN, GPU_SHIP_CAPACITY_MIN, nextGrowCapacity } from "../../fleet-lod.js";
import { FLEET_GPU_STRIDE, FleetGpuFields } from "../../fleet-layout.js";
import { SHIP_SIM_STRIDE } from "../../ship-sim-layout.js";
/** Grow-only CPU packs and deferred sparse dirt. Never mirrors live GPU poses on update. */
export class PackedFleetStorage {
    constructor() {
        /** CPU instance buffer: grow-only up to GLOBAL_MAX_INSTANCES; bases by L5. */
        this.instanceData = new Float32Array(0);
        /** Dispatch/draw ship bound = slotAlloc.shipHighWater (size-0 holes OK). */
        this.instanceLiveCount = 0;
        /**
         * CPU FleetGpu mirror (stride 64). Uploaded sparsely on state change;
         * compute integrates each frame. Index = fleetSlot (stable).
         */
        this.fleetGpuBytes = new ArrayBuffer(0);
        this.fleetGpuView = new DataView(this.fleetGpuBytes);
        this.fleetGpuU8 = new Uint8Array(this.fleetGpuBytes);
        /**
         * CPU ShipSim mirror (stride 96). One row per ship slot (high-water).
         * Inited on spawn; compute integrates each frame (GPU is pose source of truth).
         */
        this.shipSimBytes = new ArrayBuffer(0);
        this.shipSimView = new DataView(this.shipSimBytes);
        this.shipSimU8 = new Uint8Array(this.shipSimBytes);
        /**
         * Deferred GPU upload (flush once per frame before integrate).
         * Bulk spawn used to call writeBuffer 3–4× per fleet + 48× per warm-end —
         * that murdered FPS. CPU is authoritative until flush.
         */
        this.dirtyFleetSlots = [];
        this.dirtyShipRanges = [];
        this.dirtyShipRangeCount = 0;
        /** Ship high-water last successfully flushed to GPU (grow-preserve bound). */
        this.flushedShipHw = 0;
        this.flushedFleetHw = 0;
    }
    /** Grow CPU draw buffer; never past GLOBAL_MAX_INSTANCES. */
    ensureCpuInstanceCapacity(neededInstances) {
        const capped = Math.min(Math.max(0, neededInstances | 0), GLOBAL_MAX_INSTANCES);
        const floats = capped * FLEET_SHIP_DRAW_FLOATS;
        if (floats <= this.instanceData.length)
            return;
        const maxFloats = GLOBAL_MAX_INSTANCES * FLEET_SHIP_DRAW_FLOATS;
        const oldShips = Math.floor(this.instanceData.length / FLEET_SHIP_DRAW_FLOATS);
        const nextShips = nextGrowCapacity(capped, oldShips, GPU_SHIP_CAPACITY_MIN, GLOBAL_MAX_INSTANCES);
        const next = Math.min(maxFloats, nextShips * FLEET_SHIP_DRAW_FLOATS);
        const grown = new Float32Array(next);
        grown.set(this.instanceData);
        this.instanceData = grown;
    }
    /** Grow CPU ShipSim mirror; never past GLOBAL_MAX_INSTANCES. */
    ensureCpuShipSimCapacity(neededInstances) {
        const capped = Math.min(Math.max(0, neededInstances | 0), GLOBAL_MAX_INSTANCES);
        const bytes = capped * SHIP_SIM_STRIDE;
        if (bytes <= this.shipSimBytes.byteLength)
            return;
        const maxBytes = GLOBAL_MAX_INSTANCES * SHIP_SIM_STRIDE;
        const oldShips = Math.floor(this.shipSimBytes.byteLength / SHIP_SIM_STRIDE);
        const nextShips = nextGrowCapacity(capped, oldShips, GPU_SHIP_CAPACITY_MIN, GLOBAL_MAX_INSTANCES);
        const next = Math.min(maxBytes, nextShips * SHIP_SIM_STRIDE);
        const grown = new ArrayBuffer(next);
        if (this.shipSimU8.byteLength > 0) {
            new Uint8Array(grown).set(this.shipSimU8);
        }
        this.shipSimBytes = grown;
        this.shipSimView = new DataView(grown);
        this.shipSimU8 = new Uint8Array(grown);
    }
    ensureFleetGpuCapacity(fleetCount) {
        const needed = fleetCount * FLEET_GPU_STRIDE;
        if (needed <= this.fleetGpuBytes.byteLength)
            return;
        const oldFleets = Math.floor(this.fleetGpuBytes.byteLength / FLEET_GPU_STRIDE);
        // Same geometric policy as GPU fleet buffer.
        const nextFleets = nextGrowCapacity(fleetCount, oldFleets, GPU_FLEET_CAPACITY_MIN, GLOBAL_MAX_INSTANCES);
        const next = nextFleets * FLEET_GPU_STRIDE;
        const grown = new ArrayBuffer(next);
        new Uint8Array(grown).set(this.fleetGpuU8);
        this.fleetGpuBytes = grown;
        this.fleetGpuView = new DataView(grown);
        this.fleetGpuU8 = new Uint8Array(grown);
    }
    markFleetDirty(slot) {
        if (slot < 0)
            return;
        this.dirtyFleetSlots.push(slot | 0);
    }
    markShipDirty(start, count) {
        if (count <= 0 || start < 0)
            return;
        const index = this.dirtyShipRangeCount++;
        const range = this.dirtyShipRanges[index] ?? (this.dirtyShipRanges[index] = { start: 0, count: 0 });
        range.start = start | 0;
        range.count = count | 0;
    }
    sortShipRanges() {
        // Old spare records sort after active records and remain available for reuse.
        for (let i = this.dirtyShipRangeCount; i < this.dirtyShipRanges.length; i++)
            this.dirtyShipRanges[i].start = Infinity;
        this.dirtyShipRanges.sort((a, b) => a.start - b.start);
    }
    /** Path endpoints from the FleetGpu row (stable fleetSlot). */
    fleetGpuPath(visual) {
        const fleetSlot = visual.fleetSlot;
        if (fleetSlot < 0)
            return null;
        const o = fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.fleetGpuBytes.byteLength)
            return null;
        return {
            pathStartX: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartX, true),
            pathStartZ: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartZ, true),
            pathEndX: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndX, true),
            pathEndY: this.fleetGpuView.getFloat32(o + FleetGpuFields._pad0, true),
            pathEndZ: this.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndZ, true),
        };
    }
}
//# sourceMappingURL=packed-storage.js.map