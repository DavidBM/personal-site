import { SYSTEM_LOCAL_SPAN, pickSceneParkBodyIndex } from "../../solar-system-lod.js";
import { FLEET_SHIP_DRAW_FLOATS } from "../../fleet-ship-pack.js";
import { WARM_FRAMES, shouldForceIncludeFollowedFleet } from "../../fleet-lod.js";
import { SCENE_AGENT_SCALE } from "../../ship-motion-config.js";
import { FLEET_GPU_STRIDE, FLEET_FLAG_JUMPING, FLEET_FLAG_WARM, FLEET_FLAG_SYSTEM_SCENE, FLEET_FLAG_LOCAL_MOVE, FleetGpuFields } from "../../fleet-layout.js";
import { SHIP_SIM_STRIDE, readShipSim, writeShipSim } from "../../ship-sim-layout.js";
import { SHIP_MODE_JUMP, SHIP_MODE_ORBIT } from "../../ship-flight-ref.js";
import { compactBodySunLocal } from "../../system-scene/frame.js";
import { initializeRemoteShipPose, writeRemoteFleetPath } from "./remote-path.js";
/** Compact-scene membership, local parking and transition resets. */
export class FleetSceneParking {
    get records() { return this.visible.records; }
    get warmingFleetIds() { return this.visible.warmingFleetIds; }
    constructor(storage, visible, solarBodies, lookup, followIndex, layer, timeline) {
        /**
         * CPU SystemSceneSet (topology SolarSystem.id). S2 writes 0–1 look-at winner.
         * S3B ORs FLEET_FLAG_SYSTEM_SCENE from this set.
         */
        this.systemSceneIds = new Set();
        this.revision = 0;
        /** Scratch world pose for SCENE planet parking (no per-fleet alloc). */
        this.parkWorldScratch = { x: 0, y: 0, z: 0 };
        this.storage = storage;
        this.visible = visible;
        this.solarBodies = solarBodies;
        this.lookup = lookup;
        this.followIndex = followIndex;
        this.layer = layer;
        this.timeline = timeline;
    }
    /**
     * CPU authority. Ids are topology SolarSystem.id. At most one catalog SCENE.
     * S2 writes the look-at winner (0 or 1 id). S3B ORs bit 7 from this set.
     * Re-applies FleetGpu flags only when the set actually changes (hysteresis edge).
     */
    setSystemScene(ids) {
        let changed = ids.size !== this.systemSceneIds.size;
        if (!changed) {
            for (const id of ids) {
                if (!this.systemSceneIds.has(id)) {
                    changed = true;
                    break;
                }
            }
        }
        if (!changed)
            return;
        this.revision++;
        this.systemSceneIds.clear();
        for (const id of ids) {
            this.systemSceneIds.add(id);
        }
        this.reapplySystemSceneFlags();
    }
    /** Current SCENE set (0 or 1 topology id). */
    getSystemSceneIds() {
        return this.systemSceneIds;
    }
    /**
     * Jewel loc is the loaded Kepler `solarBodies.systemId`, not a stale
     * SystemSceneSet. When no Kepler is loaded (S3B setSystemScene-only tests),
     * fall back to the CPU set. Inbound jumping still uses endNode via
     * {@link fleetTopologyLocFromState}.
     */
    fleetLocMatchesKepler(state) {
        const node = state.state === "jumping" ? state.endNode : state.node;
        const keplerId = this.solarBodies.systemId;
        return keplerId == null ? this.systemSceneIds.has(node.solarSystemId) : node.solarSystemId === keplerId;
    }
    /**
     * Whole-hop inbound uses endNode via {@link fleetTopologyLocFromState}.
     * Followed fleet is force-included for agents only (no second Kepler set).
     */
    fleetInSystemScene(state, visual) {
        if (this.fleetLocMatchesKepler(state))
            return true;
        return shouldForceIncludeFollowedFleet(this.isFollowedVisual(visual), true);
    }
    isFollowedVisual(visual) {
        const idx = this.followIndex();
        if (idx == null)
            return false;
        const n = visual.instanceCapacity | 0;
        return n > 0 && idx >= visual.instanceStart && idx < visual.instanceStart + n;
    }
    /**
     * True when the chased fleet is in the jewel (loaded Kepler loc, or
     * GPU bit 7 while a SCENE is loaded). Follow force-include bit 7 on the
     * galaxy map is **not** jewel — empty scene set keeps the 1.55 boom.
     */
    isFollowedFleetInSystemScene() {
        if (this.followIndex() == null)
            return false;
        for (const f of this.records.values()) {
            if (!this.isFollowedVisual(f))
                continue;
            if (this.fleetLocMatchesKepler(f.state))
                return true;
            const jewelOpen = this.solarBodies.systemId != null || this.systemSceneIds.size > 0;
            if (!jewelOpen)
                return false;
            const o = f.fleetSlot * FLEET_GPU_STRIDE;
            if (o + 4 > this.storage.fleetGpuBytes.byteLength)
                return false;
            const flags = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
            return (flags & FLEET_FLAG_SYSTEM_SCENE) !== 0;
        }
        return false;
    }
    /**
     * Re-OR bit 7 after a flags rebuild. 0→1 on a live visual starts WARM_FRAMES.
     * Formation capacity is not touched.
     */
    orSystemSceneFlag(visual, state, flags, prevFlags) {
        if (!this.fleetInSystemScene(state, visual))
            return flags;
        let next = flags;
        if ((prevFlags & FLEET_FLAG_SYSTEM_SCENE) === 0 &&
            visual.instanceCapacity > 0) {
            visual.warmFramesLeft = WARM_FRAMES;
            this.warmingFleetIds.add(visual.id);
            next |= FLEET_FLAG_WARM;
        }
        return next | FLEET_FLAG_SYSTEM_SCENE;
    }
    /**
     * Sparse flag write on SCENE/follow edge. Formation (instanceStart / shipBudget)
     * stays put — never a host re-pack.
     */
    reapplySystemSceneFlags() {
        if (this.records.size === 0)
            return;
        for (const f of this.records.values()) {
            if (f.remote) {
                this.updateRemoteSpace(f);
                continue;
            }
            const slot = f.fleetSlot;
            const o = slot * FLEET_GPU_STRIDE;
            if (o + 4 > this.storage.fleetGpuBytes.byteLength)
                continue;
            const flags = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
            const next = this.fleetInSystemScene(f.state, f)
                ? this.orSystemSceneFlag(f, f.state, flags, flags)
                : (flags & ~FLEET_FLAG_SYSTEM_SCENE) >>> 0;
            if (next !== flags) {
                this.storage.fleetGpuView.setUint32(o + FleetGpuFields.flags, next >>> 0, true);
                if ((flags & FLEET_FLAG_SYSTEM_SCENE) !== 0 &&
                    (next & FLEET_FLAG_SYSTEM_SCENE) === 0) {
                    this.restoreTopologyPathEnd(f);
                }
                this.storage.markFleetDirty(slot);
            }
        }
    }
    updateRemoteSpace(visual) {
        const offset = visual.fleetSlot * FLEET_GPU_STRIDE + FleetGpuFields.flags;
        const wasLocal = (this.storage.fleetGpuView.getUint32(offset, true) & FLEET_FLAG_SYSTEM_SCENE) !== 0;
        const local = this.fleetLocMatchesKepler(visual.state);
        writeRemoteFleetPath(this.storage, visual, local, this.lookup(), this.timeline.elapsedMs);
        if (local && !wasLocal) {
            initializeRemoteShipPose(this.storage, visual, this.timeline.elapsedMs);
            this.layer.killTrailRange(visual.instanceStart, visual.instanceCapacity);
        }
    }
    /** Topology dest xz (system node). Jumping uses endNode. */
    topologyPathEndXZ(state) {
        const lookup = this.lookup();
        if (!lookup)
            return null;
        if (state.state === "jumping") {
            const end = lookup(state.endNode);
            return end ? { x: end.x, z: end.z } : null;
        }
        if (state.state === "cooldown" || state.state === "awaiting") {
            const node = lookup(state.node);
            return node ? { x: node.x, z: node.z } : null;
        }
        return null;
    }
    restoreTopologyPathEnd(visual) {
        if (visual.remote) {
            this.updateRemoteSpace(visual);
            return;
        }
        const pos = this.topologyPathEndXZ(visual.state);
        if (!pos)
            return;
        const o = visual.fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.storage.fleetGpuBytes.byteLength)
            return;
        const lookup = this.lookup();
        const state = visual.state;
        let startX = pos.x;
        let startZ = pos.z;
        if (state.state === "jumping" && lookup) {
            const start = lookup(state.startNode);
            if (start) {
                startX = start.x;
                startZ = start.z;
            }
        }
        this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartX, startX, true);
        this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartZ, startZ, true);
        this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndX, pos.x, true);
        this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndZ, pos.z, true);
        const flags = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
        const topologyFlags = (flags & ~FLEET_FLAG_LOCAL_MOVE) >>> 0;
        const next = state.state === "jumping"
            ? (topologyFlags | FLEET_FLAG_JUMPING) >>> 0
            : (topologyFlags & ~FLEET_FLAG_JUMPING) >>> 0;
        this.storage.fleetGpuView.setUint32(o + FleetGpuFields.flags, next, true);
        // Closed-scene rendering uses galaxy icon proxies and does not consume
        // ShipSim or trails. Keep the dormant local pose until the next explicit
        // scene entry replaces its coordinate frame once.
        visual.poseSystemId = null;
    }
    /**
     * Visual-only: SCENE fleets CIRCULATE a hashed compact planet, not the
     * system node. Stored pathStart/pathEnd are **sun-relative** (no unit).
     * Topology dest stays SolarSystem.position. Formation
     * (instanceStart / shipBudget) is not touched. On first entry, moving fleets
     * begin just outside the destination and seek its orbit. Later frames update
     * only the moving Kepler target, preserving the approach and orbit phase.
     */
    writeParkedPathEnd(visual, timeSec) {
        if (visual.remote)
            return;
        const store = this.solarBodies;
        if (store.systemId == null || store.currentCount <= 0)
            return;
        const slot = visual.fleetSlot;
        const o = slot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.storage.fleetGpuBytes.byteLength)
            return;
        const hash = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.fleetIdHash, true);
        const idx = pickSceneParkBodyIndex(hash, store);
        const local = compactBodySunLocal(store, idx, timeSec, this.parkWorldScratch);
        if (!local)
            return;
        // Reuse the pose scratch; this runs for every visible fleet each frame.
        const lx = local.x, ly = local.y, lz = local.z;
        const systemId = store.systemId;
        const prevFlags = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.flags, true);
        const movingToOrbit = visual.state.state !== "awaiting";
        const nextFlags = this.orSystemSceneFlag(visual, visual.state, visual.state.state === "jumping"
            ? (prevFlags | FLEET_FLAG_JUMPING | FLEET_FLAG_LOCAL_MOVE) >>> 0
            : ((prevFlags & ~FLEET_FLAG_JUMPING) | FLEET_FLAG_LOCAL_MOVE) >>> 0, prevFlags);
        const entering = visual.poseInitialized && visual.poseSystemId !== systemId;
        if (this.parkedPathMatches(o, lx, ly, lz, nextFlags) && !entering)
            return;
        const seedPath = !visual.poseInitialized || entering;
        this.writeScenePath(visual, o, hash, lx, ly, lz, nextFlags, seedPath, movingToOrbit);
        this.storage.markFleetDirty(slot);
        // Only a coordinate-space transition seeds ShipSim. Target distance is not
        // lifecycle evidence: a same-system retarget must steer from the live pose.
        if (visual.instanceCapacity > 0 &&
            entering) {
            this.layer.killTrailRange(visual.instanceStart, visual.instanceCapacity);
            this.positionShipsForSceneState(visual);
            this.storage.markShipDirty(visual.instanceStart, visual.instanceCapacity);
        }
        if (visual.poseInitialized)
            visual.poseSystemId = systemId;
    }
    writeScenePath(visual, o, hash, x, y, z, flags, entering, moving) {
        if (entering && moving) {
            const entry = this.sceneApproachStart(visual, x, z, hash);
            this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartX, entry.x, true);
            this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartZ, entry.z, true);
        }
        else if (!moving) {
            this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartX, x, true);
            this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathStartZ, z, true);
        }
        this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndX, x, true);
        this.storage.fleetGpuView.setFloat32(o + FleetGpuFields.pathEndZ, z, true);
        this.storage.fleetGpuView.setFloat32(o + FleetGpuFields._pad0, y, true);
        this.storage.fleetGpuView.setUint32(o + FleetGpuFields.flags, flags, true);
    }
    sceneApproachStart(visual, targetX, targetZ, hash) {
        let dx = 0;
        let dz = 0;
        if (visual.state.state === "jumping") {
            const lookup = this.lookup();
            const start = lookup?.(visual.state.startNode);
            const end = lookup?.(visual.state.endNode);
            if (start && end) {
                dx = start.x - end.x;
                dz = start.z - end.z;
            }
        }
        const len = Math.hypot(dx, dz);
        if (len <= 1e-9) {
            const angle = (hash / 4294967296) * Math.PI * 2;
            dx = Math.sin(angle);
            dz = Math.cos(angle);
        }
        else {
            dx /= len;
            dz /= len;
        }
        const approachDistance = SYSTEM_LOCAL_SPAN * 0.25;
        return {
            x: targetX + dx * approachDistance,
            z: targetZ + dz * approachDistance,
        };
    }
    /**
     * Every frame while Kepler is live: park SCENE-loc fleets on a hashed planet.
     * Followed fleets outside the SCENE keep galaxy pathEnd (bit 7 is agents only).
     */
    applyScenePlanetParking() {
        if (this.records.size === 0)
            return;
        const store = this.solarBodies;
        if (store.systemId == null || store.currentCount <= 0)
            return;
        const timeSec = this.timeline.seconds;
        for (const f of this.records.values()) {
            // Loc-only: do not park a followed galaxy fleet onto compact planets.
            if (!this.fleetLocMatchesKepler(f.state))
                continue;
            this.writeParkedPathEnd(f, timeSec);
        }
    }
    /**
     * Place jewel ships on SCENE-scaled CIRCULATE around parked pathEnd.
     * Host formation pack uses galaxy ORBIT_R (2–7); Kepler field is 0.1.
     */
    snapShipsToSceneOrbit(visual) {
        const path = this.storage.fleetGpuPath(visual);
        if (!path)
            return;
        const n = visual.instanceCapacity;
        const k = SCENE_AGENT_SCALE;
        for (let i = 0; i < n; i++) {
            const idx = visual.instanceStart + i;
            const rec = readShipSim(this.storage.shipSimView, idx * SHIP_SIM_STRIDE);
            const orbitR = this.sceneOrbitRadiusCanonical(visual, i, rec.orbitR ?? 2);
            const R = Math.max(1e-6, orbitR * k);
            const phase = rec.orbitPhase ?? 0;
            const x = path.pathEndX + R * Math.sin(phase);
            const z = path.pathEndZ + R * Math.cos(phase);
            const y = (rec.slotY ?? 0) * k;
            writeShipSim(this.storage.shipSimView, idx * SHIP_SIM_STRIDE, {
                ...rec,
                orbitR,
                posX: x,
                posY: path.pathEndY + y,
                posZ: z,
                speed: Math.abs((rec.orbitOmega ?? 0) * R),
                mode: SHIP_MODE_ORBIT,
            });
            const io = idx * FLEET_SHIP_DRAW_FLOATS;
            this.storage.instanceData[io] = x;
            this.storage.instanceData[io + 1] = path.pathEndY + y;
            this.storage.instanceData[io + 2] = z;
        }
    }
    /** Seed a visible local-space arrival without planting ships on the orbit. */
    placeShipsAtSceneApproach(visual) {
        const path = this.storage.fleetGpuPath(visual);
        if (!path)
            return;
        const n = visual.instanceCapacity;
        const k = SCENE_AGENT_SCALE;
        const heading = Math.atan2(path.pathEndX - path.pathStartX, path.pathEndZ - path.pathStartZ);
        for (let i = 0; i < n; i++) {
            const idx = visual.instanceStart + i;
            const rec = readShipSim(this.storage.shipSimView, idx * SHIP_SIM_STRIDE);
            const phase = rec.orbitPhase ?? 0;
            const orbitR = this.sceneOrbitRadiusCanonical(visual, i, rec.orbitR ?? 2);
            const scatter = Math.max(1e-6, orbitR * k * 0.45);
            const x = path.pathStartX + scatter * Math.sin(phase);
            const z = path.pathStartZ + scatter * Math.cos(phase);
            writeShipSim(this.storage.shipSimView, idx * SHIP_SIM_STRIDE, {
                ...rec,
                orbitR,
                posX: x,
                posY: path.pathEndY + (rec.slotY ?? 0) * k,
                posZ: z,
                speed: 0,
                heading,
                mode: SHIP_MODE_JUMP,
            });
            const io = idx * FLEET_SHIP_DRAW_FLOATS;
            this.storage.instanceData[io] = x;
            this.storage.instanceData[io + 1] = path.pathEndY + (rec.slotY ?? 0) * k;
            this.storage.instanceData[io + 2] = z;
        }
    }
    positionShipsForSceneState(visual) {
        if (visual.state.state === "awaiting")
            this.snapShipsToSceneOrbit(visual);
        else
            this.placeShipsAtSceneApproach(visual);
    }
    /** Planet-relative altitude keeps every hull clear of the body surface. */
    sceneOrbitRadiusCanonical(visual, shipIndex, fallback) {
        const o = visual.fleetSlot * FLEET_GPU_STRIDE;
        if (o + FLEET_GPU_STRIDE > this.storage.fleetGpuBytes.byteLength)
            return fallback;
        const hash = this.storage.fleetGpuView.getUint32(o + FleetGpuFields.fleetIdHash, true);
        const bodyIndex = pickSceneParkBodyIndex(hash, this.solarBodies);
        const bodyRadius = this.solarBodies.radius[bodyIndex] ?? 0;
        if (!(bodyRadius > 0))
            return fallback;
        const mixed = Math.imul((hash ^ shipIndex) >>> 0, 0x9e3779b1) >>> 0;
        const altitudeMul = 2.2 + (mixed / 4294967296) * 1.2;
        return (bodyRadius * altitudeMul) / SCENE_AGENT_SCALE;
    }
    parkedPathMatches(o, x, y, z, flags) {
        const row = this.storage.fleetGpuView;
        const px = Math.fround(x), py = Math.fround(y), pz = Math.fround(z);
        return row.getFloat32(o + FleetGpuFields.pathEndX, true) === px
            && row.getFloat32(o + FleetGpuFields.pathEndZ, true) === pz
            && row.getFloat32(o + FleetGpuFields._pad0, true) === py
            && row.getUint32(o + FleetGpuFields.flags, true) === flags;
    }
}
//# sourceMappingURL=scene-parking.js.map