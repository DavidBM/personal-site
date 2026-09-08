import { hashStringSeed, FLEET_SHIP_DRAW_FLOATS } from "../../fleet-ship-pack.js";
import { CAP_NEAR, GLOBAL_MAX_INSTANCES, WARM_FRAMES, countShips, scaleCountsToBudget, shouldResetFleetTrails } from "../../fleet-lod.js";
import { createFleetSlotAllocator } from "../../fleet-slot-allocator.js";
import { FLEET_GPU_STRIDE, FLEET_FLAG_ALIVE, FLEET_FLAG_WARM, FleetGpuFields } from "../../fleet-layout.js";
import { SHIP_SIM_STRIDE, ShipSimFields } from "../../ship-sim-layout.js";
import { SHIP_MODE_PAUSED } from "../../ship-flight-ref.js";
import { packFormation } from "../../fleet-motion-api.js";
import { configureRemoteShipMotion, initializeRemoteShipPose } from "./remote-path.js";
import { PackedFleetStorage } from "./packed-storage.js";
import { FleetSceneParking } from "./scene-parking.js";
import { FleetFollowShadow } from "./follow-shadow.js";
import { createFleetGpuUpload } from "./gpu-upload.js";
import { createFleetPathPacking } from "./path-packing.js";
/** Fleet lifecycle facade. Resource phases have separate, narrowly scoped owners. */
const MAX_FLEET_SLOTS = 100000;
export class FleetPresentation {
    get records() { return this.visible.records; }
    getVisual(id) { return this.records.get(id) ?? null; }
    /**
     * Fleets still in R5 warm-up (`warmFramesLeft > 0`). tickWarmFleets only
     * walks this set — O(warming), not O(all fleets). Scanning 10k fleets every
     * frame was ~4ms and tanked steady-state FPS after bulk spawn.
     */
    get warmingFleetIds() { return this.visible.warmingFleetIds; }
    /** Prepared indexes become visible together in the caller's publication task. */
    publishVisibleIndex(index) {
        this.visible.records = index.records;
        this.visible.warmingFleetIds = index.warmingFleetIds;
    }
    constructor(layer, isUnavailable, solarBodies, timeline) {
        this.visible = { records: new Map(), warmingFleetIds: new Set() };
        /**
         * Free-list: stable fleetSlot + ship ranges. High-water never shrinks;
         * remove tombstones (ALIVE=0 / size 0) and returns slots to the free lists.
         */
        this.slotAlloc = createFleetSlotAllocator({
            maxFleets: MAX_FLEET_SLOTS,
            maxShips: GLOBAL_MAX_INSTANCES,
        });
        /**
         * Optional cap on ships packed per new fleet (bulk fairness under
         * GLOBAL_MAX_INSTANCES). null = normal CAP_NEAR path.
         */
        this.bulkShipBudgetHint = null;
        this.positionLookup = null;
        this.storage = new PackedFleetStorage();
        this.layer = layer;
        this.isUnavailable = isUnavailable;
        this.solarBodies = solarBodies;
        this.timeline = timeline;
        this.scene = new FleetSceneParking(this.storage, this.visible, solarBodies, () => this.positionLookup, () => this.follow.followShipIndex, layer, timeline);
        this.follow = new FleetFollowShadow(this.storage, this.visible, solarBodies, this.scene, layer, isUnavailable);
        this.upload = createFleetGpuUpload(this.storage, this.slotAlloc, layer);
        this.packing = createFleetPathPacking(this.storage, () => this.positionLookup, timeline, this.scene);
    }
    /**
     * CPU FleetGpu row after {@link writeFleetGpuFromState} / parked scatter.
     * Tests-only read of the host mirror — no MAP_READ (avoids a second device
     * mapping while the map-view glTF load / 4096-ship first alloc is in flight).
     */
    readFleetGpuSlot(id) {
        const f = this.records.get(id);
        if (!f)
            return null;
        const o = f.fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.storage.fleetGpuBytes.byteLength)
            return null;
        return {
            flags: this.storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true),
            shipBudget: this.storage.fleetGpuView.getUint32(o + FleetGpuFields.shipBudget, true),
            instanceStart: this.storage.fleetGpuView.getUint32(o + FleetGpuFields.instanceStart, true),
            pad1: this.storage.fleetGpuView.getUint32(o + FleetGpuFields._pad1, true),
            posX: this.storage.fleetGpuView.getFloat32(o + FleetGpuFields.posX, true),
            posZ: this.storage.fleetGpuView.getFloat32(o + FleetGpuFields.posZ, true),
            pathStartX: this.storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartX, true),
            pathStartZ: this.storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathStartZ, true),
            pathEndX: this.storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndX, true),
            pathEndZ: this.storage.fleetGpuView.getFloat32(o + FleetGpuFields.pathEndZ, true),
            pathEndY: this.storage.fleetGpuView.getFloat32(o + FleetGpuFields._pad0, true),
            fleetSlot: f.fleetSlot,
        };
    }
    setFleetPositionProvider(lookup) {
        this.positionLookup = lookup;
        // Sparse re-write path endpoints; no structure rebuild (slots stay stable).
        if (this.records.size === 0)
            return;
        for (const f of this.records.values()) {
            if (this.packing.writeFleetGpuFromState(f, f.state, f.fleetSlot)) {
                this.storage.markFleetDirty(f.fleetSlot);
            }
        }
    }
    // --- FleetStatusRenderer surface ---
    /**
     * Fair per-fleet ship budget for bulk add (null = full CAP_NEAR when space).
     * 50k fleets: hint = min(48, floor(500k/50k)) = 10; 1k → 48.
     */
    setBulkShipBudgetHint(n) {
        if (n == null || !Number.isFinite(n) || n <= 0) {
            this.bulkShipBudgetHint = null;
            return;
        }
        this.bulkShipBudgetHint = Math.max(1, Math.min(CAP_NEAR, n | 0));
    }
    getBulkShipBudgetHint() {
        return this.bulkShipBudgetHint;
    }
    getFleetCount() {
        return this.records.size;
    }
    /** Free-list ship high-water (visual instance index space). */
    getShipHighWater() {
        return this.slotAlloc.shipHighWater;
    }
    /**
     * Pre-grow CPU + GPU buffers once for bulk so mid-apply does not thrash
     * geometric doubles + full dead trail inits (device-lost risk at ~500k).
     */
    reserveFleetCapacity(fleetCount, shipsPerFleet) {
        const fleets = Math.max(0, fleetCount | 0);
        const per = Math.max(0, Math.min(CAP_NEAR, shipsPerFleet | 0));
        const fleetNeed = Math.min(MAX_FLEET_SLOTS, this.slotAlloc.fleetHighWater + fleets);
        const shipNeed = Math.min(GLOBAL_MAX_INSTANCES, this.slotAlloc.shipHighWater + fleets * per);
        this.storage.ensureFleetGpuCapacity(fleetNeed);
        this.storage.ensureCpuInstanceCapacity(shipNeed);
        this.storage.ensureCpuShipSimCapacity(shipNeed);
        if (fleetNeed > 0) {
            this.layer.ensureFleetCapacity(fleetNeed);
        }
        // Prefer one-shot GPU grow (avoids mid-bulk thrash). Soft-fail: headless
        // SwiftShader may lose the device on huge trail allocs; addFleet then
        // grows geometrically with chunked dead-init.
        if (shipNeed > 0 && !this.isUnavailable()) {
            try {
                this.upload.ensureGpuShipCapacity(shipNeed);
            }
            catch (err) {
                console.warn("[fleets] reserveFleetCapacity GPU grow failed; will grow on apply", err);
            }
        }
    }
    /**
     * Visual ship slots for this spawn under CAP_NEAR + bulk hint + grow remaining.
     * When high-water is full, still return hint/want so free-list holes can fit.
     */
    chooseShipBudget(counts) {
        const want = Math.min(countShips(counts), CAP_NEAR);
        if (want <= 0)
            return 0;
        let n = want;
        if (this.bulkShipBudgetHint != null) {
            n = Math.min(n, Math.max(1, this.bulkShipBudgetHint));
        }
        const remaining = Math.max(0, GLOBAL_MAX_INSTANCES - this.slotAlloc.shipHighWater);
        if (remaining > 0) {
            n = Math.min(n, remaining);
        }
        return Math.max(1, n);
    }
    /**
     * Free-list spawn: alloc fleetSlot + N ship slots (chooseShipBudget),
     * pack formation once, init ShipSim on CPU. GPU upload is **deferred** to the
     * next frame flush (coalesced) so bulk spawn is not N× writeBuffer.
     * Re-add of the same id tombstones the prior slot first.
     */
    addFleet(id, counts, state, remote) {
        if (this.records.has(id)) {
            this.removeFleet(id);
        }
        let N = this.chooseShipBudget(counts);
        if (N <= 0) {
            // Domain counts empty — still try zero-size ship range so fleet row exists.
            N = 0;
        }
        const fleetSlot = this.slotAlloc.allocFleetSlot();
        if (fleetSlot === null) {
            console.warn(`[fleets] fleet slot exhausted (max ${MAX_FLEET_SLOTS})`);
            return;
        }
        let range = this.slotAlloc.allocShipRange(N);
        // If chosen N does not fit a free hole / grow room, fall back to icon (N=1).
        if (range === null && N > 1) {
            N = 1;
            range = this.slotAlloc.allocShipRange(1);
        }
        if (range === null) {
            this.slotAlloc.freeFleetSlot(fleetSlot);
            console.warn("[fleets] ship instance budget exhausted");
            return;
        }
        const visual = {
            id,
            counts,
            state,
            remote,
            seed: hashStringSeed(id),
            fleetSlot,
            instanceStart: range.start,
            instanceCapacity: N,
            instanceActive: N,
            poseInitialized: false,
            poseSystemId: null,
            warmFramesLeft: N > 0 ? WARM_FRAMES : 0,
        };
        this.records.set(id, visual);
        if (visual.warmFramesLeft > 0)
            this.warmingFleetIds.add(id);
        this.storage.ensureFleetGpuCapacity(this.slotAlloc.fleetHighWater);
        this.storage.ensureCpuInstanceCapacity(this.slotAlloc.shipHighWater);
        this.storage.ensureCpuShipSimCapacity(this.slotAlloc.shipHighWater);
        this.storage.instanceLiveCount = this.slotAlloc.shipHighWater;
        // GPU ship index space (instances + ShipSim + trails) must cover high-water
        // as soon as slots exist — not only on flush. Otherwise remove/killTrail
        // OOB when fleets complete before the first deferred upload.
        this.upload.ensureGpuShipCapacity(this.slotAlloc.shipHighWater);
        this.initializeVisual(visual);
        this.storage.markFleetDirty(fleetSlot);
        if (N > 0)
            this.storage.markShipDirty(range.start, N);
    }
    initializeVisual(visual) {
        const N = visual.instanceCapacity;
        // Pack formation at current visual base (path miss → origin; first integrate fixes).
        // Spawn structure only — never re-pack every frame (GPU owns continuous pose).
        const base = this.packing.fleetSpawnBase(visual.state);
        if (N > 0) {
            const visualCounts = scaleCountsToBudget(visual.counts, N);
            packFormation(this.storage.instanceData, visual.instanceStart, visualCounts, visual.seed, { x: base.x, y: base.y, z: base.z });
        }
        // FleetGpu first so initShipSim can read path/heading from the row.
        if (!this.packing.writeFleetGpuFromState(visual, visual.state, visual.fleetSlot)) {
            this.packing.writeFleetGpuParkedScatter(visual, visual.fleetSlot, base.x, base.z);
        }
        if (N > 0) {
            this.packing.initShipSimForFleet(visual);
            // Galaxy formation is O(1–7) around pathEnd; Kepler span is 0.1.
            // Seed a sun-local pose. Parked fleets use their ring; arrivals begin a
            // short visible approach and settle during the domain cooldown.
            if (visual.remote) {
                configureRemoteShipMotion(this.storage, visual);
                initializeRemoteShipPose(this.storage, visual, this.timeline.elapsedMs);
            }
            else if (this.scene.fleetLocMatchesKepler(visual.state)) {
                this.scene.positionShipsForSceneState(visual);
            }
            // Free-list reuse + fresh spawn: wipe trail rings so old segments never stitch.
            this.layer.killTrailRange(visual.instanceStart, N);
        }
        visual.poseInitialized = true;
        visual.poseSystemId = this.scene.fleetLocMatchesKepler(visual.state)
            ? this.solarBodies.systemId
            : null;
    }
    /**
     * Discrete phase / path command only. ShipSim pose lives on the GPU after the
     * last integrate — the CPU mirror is **stale** and must never be re-uploaded on
     * jump edge (that caused one-frame position/heading snaps).
     * A jump is just: pathStart/pathEnd/t0/durationMs + JUMPING flag. Integrate steers
     * each ship from its current world pose toward pathEnd+slot over the duration.
     */
    updateFleetState(id, state) {
        const f = this.records.get(id);
        if (!f)
            return;
        const prev = f.state;
        f.state = state;
        this.storage.ensureFleetGpuCapacity(this.slotAlloc.fleetHighWater);
        // Skip mark on lookup miss — keep prior FleetGpu row (no origin teleport).
        if (this.packing.writeFleetGpuFromState(f, state, f.fleetSlot)) {
            this.storage.markFleetDirty(f.fleetSlot);
        }
        // Significant path / node change → reset trails (no ghost stitch across hops).
        if (f.instanceCapacity > 0 &&
            shouldResetFleetTrails(prev, state) &&
            !(this.scene.fleetLocMatchesKepler(prev) && this.scene.fleetLocMatchesKepler(state))) {
            this.layer.killTrailRange(f.instanceStart, f.instanceCapacity);
        }
    }
    /**
     * Tombstone remove: clear FLEET_FLAG_ALIVE, pause ships + size 0, free slots.
     * No fleetOrder renumber, no full structure rebuild. GPU upload deferred.
     */
    removeFleet(id) {
        const f = this.records.get(id);
        if (!f)
            return;
        const slot = f.fleetSlot;
        const start = f.instanceStart;
        const cap = f.instanceCapacity;
        // Clear ALIVE on CPU FleetGpu mirror.
        const o = slot * FLEET_GPU_STRIDE;
        if (o + 4 <= this.storage.fleetGpuBytes.byteLength) {
            const flags = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
            this.storage.fleetGpuView.setUint32(o + FleetGpuFields.flags, (flags & ~FLEET_FLAG_ALIVE) >>> 0, true);
            this.storage.markFleetDirty(slot);
        }
        // Tombstone ships: PAUSED + draw size 0 + kill trails immediately.
        // Trail draw still covers high-water; without a wipe, segments ghost after
        // ships disappear (PAUSED integrate used to skip trail clear).
        if (cap > 0) {
            this.storage.ensureCpuInstanceCapacity(start + cap);
            this.storage.ensureCpuShipSimCapacity(start + cap);
            for (let i = 0; i < cap; i++) {
                const inst = start + i;
                const drawO = inst * FLEET_SHIP_DRAW_FLOATS;
                if (drawO + 8 <= this.storage.instanceData.length) {
                    this.storage.instanceData[drawO + 7] = 0; // size
                }
                const simO = inst * SHIP_SIM_STRIDE;
                if (simO + 4 <= this.storage.shipSimBytes.byteLength) {
                    this.storage.shipSimView.setUint32(simO + ShipSimFields.mode, SHIP_MODE_PAUSED, true);
                    this.storage.shipSimView.setFloat32(simO + ShipSimFields.speed, 0, true);
                }
            }
            this.storage.markShipDirty(start, cap);
            // Same indices as draw/ShipSim; capacity already ≥ high-water from add.
            this.layer.killTrailRange(start, cap);
        }
        this.slotAlloc.freeShipRange(start, cap);
        this.slotAlloc.freeFleetSlot(slot);
        this.warmingFleetIds.delete(id);
        this.records.delete(id);
        const followed = this.follow.followShipIndex;
        if (followed != null && followed >= start && followed < start + cap)
            this.follow.setFollowShipIndex(null);
    }
    clearFleets() {
        this.follow.resetTracking();
        this.records.clear();
        this.warmingFleetIds.clear();
        this.slotAlloc.reset();
        this.storage.instanceLiveCount = 0;
        this.storage.flushedShipHw = 0;
        this.storage.flushedFleetHw = 0;
        this.storage.dirtyFleetSlots.length = 0;
        this.storage.dirtyShipRangeCount = 0;
        this.layer.setInstances(new Float32Array(0), 0);
        this.layer.setFleetGpuData(new Uint8Array(0), 0);
        this.layer.setShipSimData(new Uint8Array(0), 0);
        // Drop trail sample/line buffers so no ghost lines remain.
        this.layer.ensureTrailCapacity(0);
    }
    /**
     * R5 — after each integrate: count a warm frame for spawn warm-up.
     * Only fleets in {@link warmingFleetIds} (not a full map scan).
     * When warm ends: clear FLEET_FLAG_WARM only. cs_ships already restores draw
     * size from color when size was zeroed under WARM.
     */
    tickWarmFleets() {
        if (this.warmingFleetIds.size === 0)
            return;
        for (const id of this.warmingFleetIds) {
            const f = this.records.get(id);
            if (!f || f.warmFramesLeft <= 0) {
                this.warmingFleetIds.delete(id);
                continue;
            }
            f.warmFramesLeft -= 1;
            if (f.warmFramesLeft > 0)
                continue;
            this.warmingFleetIds.delete(id);
            const slot = f.fleetSlot;
            const o = slot * FLEET_GPU_STRIDE;
            if (o + 4 <= this.storage.fleetGpuBytes.byteLength) {
                const flags = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
                this.storage.fleetGpuView.setUint32(o + FleetGpuFields.flags, (flags & ~FLEET_FLAG_WARM) >>> 0, true);
                this.storage.markFleetDirty(slot);
            }
        }
    }
}
//# sourceMappingURL=fleet-presentation.js.map