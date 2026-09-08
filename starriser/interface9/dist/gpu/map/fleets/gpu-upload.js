/** GPU capacity preservation and one coalesced upload phase per frame. */
export function createFleetGpuUpload(storage, slotAlloc, layer) {
    /**
     * Grow GPU instance / ShipSim / trail buffers so every ship high-water index
     * is valid. Same geometric capacity; data uploads stay deferred to flush.
     * Preserve bound = last flushed high-water (live GPU poses).
     */
    function ensureGpuShipCapacity(shipHw) {
        const hw = Math.max(0, shipHw | 0);
        if (hw <= 0)
            return;
        const preserve = storage.flushedShipHw;
        if (hw > layer.getInstanceCapacity()) {
            layer.growInstancesPreserving(hw, preserve, storage.instanceData, 0, 0);
        }
        if (hw > layer.getShipSimCapacity()) {
            layer.growShipSimPreserving(hw, preserve, storage.shipSimU8, 0, 0);
        }
        // Trails share the ship index space — always ≥ high-water after this call.
        layer.ensureTrailCapacity(hw);
    }
    /**
     * Push pending CPU fleet/ship packs to the GPU once per frame (before integrate).
     * Coalesces dirty ranges so 250 spawns → a handful of writeBuffers, not ~1000.
     */
    function flushFleetGpuDirt() {
        const fleetHw = slotAlloc.fleetHighWater;
        const shipHw = slotAlloc.shipHighWater;
        storage.instanceLiveCount = shipHw;
        const hasFleetDirt = storage.dirtyFleetSlots.length > 0;
        const hasShipDirt = storage.dirtyShipRangeCount > 0;
        if (!hasFleetDirt &&
            !hasShipDirt &&
            shipHw === storage.flushedShipHw &&
            fleetHw === storage.flushedFleetHw) {
            return;
        }
        storage.ensureFleetGpuCapacity(fleetHw);
        storage.ensureCpuInstanceCapacity(shipHw);
        storage.ensureCpuShipSimCapacity(shipHw);
        flushFleetRows(fleetHw, hasFleetDirt);
        flushShips(shipHw);
    }
    function flushFleetRows(fleetHw, dirty) {
        if (fleetHw <= 0) {
            layer.setFleetGpuData(EMPTY_BYTES, 0);
        }
        else {
            const grew = layer.ensureFleetCapacity(fleetHw);
            if (grew || storage.flushedFleetHw === 0)
                layer.setFleetGpuData(storage.fleetGpuU8, fleetHw);
            else if (dirty)
                uploadDirtyFleetRows(fleetHw);
        }
        storage.flushedFleetHw = fleetHw;
        storage.dirtyFleetSlots.length = 0;
    }
    function uploadDirtyFleetRows(fleetHw) {
        const slots = storage.dirtyFleetSlots;
        slots.sort(ascending);
        let i = 0;
        while (i < slots.length) {
            const start = slots[i++];
            let end = start + 1;
            while (i < slots.length && slots[i] <= end)
                end = Math.max(end, slots[i++] + 1);
            layer.uploadFleetGpuRange(storage.fleetGpuU8, start, end - start);
        }
        const from = layer.getFleetCount();
        if (from < fleetHw)
            layer.uploadFleetGpuRange(storage.fleetGpuU8, from, fleetHw - from);
    }
    function flushShips(shipHw) {
        if (storage.dirtyShipRangeCount === 0 && shipHw === storage.flushedShipHw)
            return;
        // --- Ships (instances + ShipSim + trails) ---
        if (shipHw <= 0) {
            layer.setInstances(EMPTY_INSTANCES, 0);
            layer.setShipSimData(EMPTY_BYTES, 0);
            layer.ensureTrailCapacity(0);
            storage.flushedShipHw = 0;
            storage.dirtyShipRangeCount = 0;
            return;
        }
        const shipRanges = storage.dirtyShipRanges;
        const rangeCount = storage.dirtyShipRangeCount;
        storage.sortShipRanges();
        // Capacity already kept in lockstep on add; still ensure (clear/reload edge).
        ensureGpuShipCapacity(shipHw);
        layer.setLiveInstanceCount(shipHw);
        let i = 0;
        while (i < rangeCount) {
            const r = shipRanges[i++];
            let end = r.start + r.count;
            while (i < rangeCount && shipRanges[i].start <= end) {
                const next = shipRanges[i++];
                end = Math.max(end, next.start + next.count);
            }
            const count = end - r.start;
            layer.uploadInstancesRange(storage.instanceData, r.start, count);
            layer.uploadShipSimRange(storage.shipSimU8, r.start, count);
        }
        storage.dirtyShipRangeCount = 0;
        storage.flushedShipHw = shipHw;
    }
    return { ensureGpuShipCapacity, flushFleetGpuDirt };
}
const EMPTY_BYTES = new Uint8Array(0);
const EMPTY_INSTANCES = new Float32Array(0);
const ascending = (a, b) => a - b;
//# sourceMappingURL=gpu-upload.js.map