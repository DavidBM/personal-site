import { FLEET_GPU_STRIDE, FLEET_FLAG_JUMPING, FLEET_FLAG_SPACE3D, FLEET_FLAG_LOCAL_MOVE, FLEET_FLAG_SYSTEM_SCENE, FLEET_FLAG_SIM_PAUSED, FleetGpuFields } from "../../fleet-layout.js";
import { SHIP_SIM_STRIDE, ShipSimFields, readShipSim, writeShipSim } from "../../ship-sim-layout.js";
import { SHIP_MODE_ORBIT } from "../../ship-flight-ref.js";
import { followPoseFromAgent, stepFollowShipAgent } from "../../follow-cam-pose.js";
/** One tracked ship: asynchronous seed, then same-frame camera/simulation shadow. */
export class FleetFollowShadow {
    get records() { return this.visible.records; }
    constructor(storage, visible, solarBodies, scene, layer, isUnavailable) {
        /** Cached GPU agent pose for third-person follow (updated after integrate). */
        this.followPoseCache = null;
        /** Last known good pose — never return null mid-follow if readback hiccups. */
        this.followPoseLastGood = null;
        this.followReadbackBusy = false;
        /** Ship index currently being followed (if any). */
        this.followShipIndex = null;
        /**
         * True after the one-shot GPU seed (or after the first shadow step when no
         * seed is needed). Per-frame camera never uses MAP_READ after this.
         */
        this.followShadowLive = false;
        /** Accept at most one async seed so late readbacks do not re-introduce lag. */
        this.followSeedDone = false;
        this.seedEpoch = 0;
        this.storage = storage;
        this.visible = visible;
        this.solarBodies = solarBodies;
        this.scene = scene;
        this.layer = layer;
        this.isUnavailable = isUnavailable;
    }
    /**
     * Pick a random **formation ship** (NEAR agent) for third-person follow.
     * Prefers fleets with shipBudget > 1 so we chase a real agent, not an impostor icon.
     * When a jewel SCENE is loaded, prefers Kepler-loc parked fleets.
     * Returns a stable shipIndex; use {@link getLiveShipPose} each frame.
     */
    pickRandomShipPose() {
        const all = [...this.records.values()].filter((f) => f.instanceActive > 0);
        if (all.length === 0)
            return null;
        // Jewel: prefer parked Kepler loc; fallback to any multi-ship fleet.
        const jewelOpen = this.solarBodies.systemId != null || this.scene.systemSceneIds.size > 0;
        const scene = jewelOpen
            ? all.filter((f) => this.scene.fleetLocMatchesKepler(f.state))
            : [];
        const fromSceneOrAll = scene.length > 0 ? scene : all;
        const multi = fromSceneOrAll.filter((f) => f.instanceCapacity > 1);
        const pool = multi.length > 0 ? multi : fromSceneOrAll;
        const f = pool[(Math.random() * pool.length) | 0];
        const n = Math.max(1, f.instanceActive | 0);
        const local = (Math.random() * n) | 0;
        const shipIndex = f.instanceStart + local;
        // Force an immediate GPU readback so chase starts on agent pose, not stale pack.
        this.followPoseCache = null;
        this.refreshFollowPoseFromGpu(shipIndex);
        return this.getLiveShipPose(shipIndex);
    }
    /**
     * Follow opts for {@link chooseFrameOrigin}: ship pose + planar CIRCULATE
     * pathEnd when the chased agent is orbiting (not SPACE3D). Pure data for
     * floating origin — camera look-at still uses {@link getLiveShipPose}.
     */
    followFrameOriginOpts(shipIndex) {
        const pose = this.getLiveShipPose(shipIndex);
        if (!pose)
            return null;
        const i = shipIndex | 0;
        const o = i * SHIP_SIM_STRIDE;
        let planarCirculate = false;
        let pathEndX;
        let pathEndY;
        let pathEndZ;
        if (o + SHIP_SIM_STRIDE <= this.storage.shipSimView.byteLength) {
            const mode = this.storage.shipSimView.getUint32(o + ShipSimFields.mode, true);
            const fleetSlot = this.storage.shipSimView.getUint32(o + ShipSimFields.fleetIndex, true);
            const fo = fleetSlot * FLEET_GPU_STRIDE;
            if (fo + FLEET_GPU_STRIDE <= this.storage.fleetGpuView.byteLength) {
                const flags = this.storage.fleetGpuView.getUint32(fo + FleetGpuFields.flags, true);
                const space3d = (flags & FLEET_FLAG_SPACE3D) !== 0;
                // Planar CIRCULATE only — matches model/scatter phase-local gate.
                if (mode === SHIP_MODE_ORBIT && !space3d) {
                    planarCirculate = true;
                    pathEndX = this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndX, true);
                    pathEndZ = this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndZ, true);
                    // Planar pathEndY is 0 in _pad0; keep explicit for origin Y.
                    pathEndY = this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields._pad0, true);
                    if (!Number.isFinite(pathEndY))
                        pathEndY = 0;
                }
            }
        }
        return {
            posX: pose.posX,
            posY: pose.posY,
            posZ: pose.posZ,
            planarCirculate,
            pathEndX,
            pathEndY,
            pathEndZ,
        };
    }
    /**
     * Live chase pose for the followed ship.
     * While follow is active, this is the **same-frame CPU shadow** stepped before
     * camera / floating origin (not a multi-frame async MAP_READ).
     * Falls back to CPU ShipSim mirror / last-good before the first shadow step.
     */
    getLiveShipPose(shipIndex) {
        const i = shipIndex | 0;
        if (i < 0)
            return null;
        const pose = this.followPoseCache?.shipIndex === i
            ? { ...this.followPoseCache } : this.readUncachedPose(i);
        if (!pose)
            return null;
        // GPU ShipSim is sun-relative while Kepler is loaded; camera / UI stay galaxy.
        const store = this.solarBodies;
        if (store.systemId == null)
            return pose;
        return {
            ...pose,
            posX: pose.posX + store.systemX,
            posZ: pose.posZ + store.systemZ,
        };
    }
    readUncachedPose(i) {
        let pose = null;
        // Bootstrap before first same-frame shadow step / seed.
        const o = i * SHIP_SIM_STRIDE;
        if (o + SHIP_SIM_STRIDE <= this.storage.shipSimView.byteLength) {
            pose = {
                posX: this.storage.shipSimView.getFloat32(o + ShipSimFields.posX, true),
                posY: this.storage.shipSimView.getFloat32(o + ShipSimFields.posY, true),
                posZ: this.storage.shipSimView.getFloat32(o + ShipSimFields.posZ, true),
                heading: this.storage.shipSimView.getFloat32(o + ShipSimFields.heading, true),
                shipIndex: i,
                speed: this.storage.shipSimView.getFloat32(o + ShipSimFields.speed, true),
            };
            if (this.followPoseLastGood &&
                this.followPoseLastGood.shipIndex === i &&
                !Number.isFinite(pose.posX)) {
                pose = { ...this.followPoseLastGood };
            }
            else if (Number.isFinite(pose.posX) && Number.isFinite(pose.posZ)) {
                this.followPoseLastGood = { ...pose, speed: pose.speed ?? 0 };
            }
        }
        else if (this.followPoseLastGood &&
            this.followPoseLastGood.shipIndex === i) {
            pose = { ...this.followPoseLastGood };
        }
        return pose;
    }
    /**
     * One-shot seed: pull ShipSim from GPU so the CPU shadow starts on the live
     * agent (not a stale pack). Not used as the per-frame camera source.
     */
    refreshFollowPoseFromGpu(shipIndex) {
        const index = shipIndex | 0;
        if (index < 0 || this.followReadbackBusy || this.followSeedDone || this.isUnavailable())
            return;
        const request = this.captureSeedRequest(index);
        let retry = false;
        this.followReadbackBusy = true;
        void this.layer.readbackShipSimOne(index).then((bytes) => {
            if (!this.seedRequestCurrent(request)) {
                retry = true;
                return;
            }
            this.acceptSeed(index, bytes);
        }).catch(() => { }).finally(() => {
            this.followReadbackBusy = false;
            if (retry && this.followShipIndex != null)
                this.refreshFollowPoseFromGpu(this.followShipIndex);
        });
    }
    ownerOf(index) {
        for (const fleet of this.records.values()) {
            if (index >= fleet.instanceStart && index < fleet.instanceStart + fleet.instanceCapacity)
                return fleet;
        }
        return null;
    }
    captureSeedRequest(index) {
        return { index, epoch: this.seedEpoch, owner: this.ownerOf(index), revision: this.scene.revision,
            systemId: this.solarBodies.systemId, systemX: this.solarBodies.systemX, systemZ: this.solarBodies.systemZ };
    }
    seedRequestCurrent(request) {
        if (this.isUnavailable() || this.followSeedDone)
            return false;
        return request.index === this.followShipIndex && request.epoch === this.seedEpoch
            && request.owner === this.ownerOf(request.index) && request.revision === this.scene.revision
            && this.seedSpaceCurrent(request);
    }
    seedSpaceCurrent(request) {
        return request.systemId === this.solarBodies.systemId
            && request.systemX === this.solarBodies.systemX && request.systemZ === this.solarBodies.systemZ;
    }
    acceptSeed(index, bytes) {
        const offset = index * SHIP_SIM_STRIDE;
        if (offset + SHIP_SIM_STRIDE > this.storage.shipSimBytes.byteLength)
            return;
        const pose = followPoseFromAgent(readShipSim(new DataView(bytes), 0), index);
        if (!Number.isFinite(pose.posX) || !Number.isFinite(pose.posZ) || !Number.isFinite(pose.heading))
            return;
        this.storage.shipSimU8.set(new Uint8Array(bytes), offset);
        this.followPoseCache = pose;
        this.followPoseLastGood = pose;
        this.followShadowLive = true;
        this.followSeedDone = true;
    }
    resetTracking() {
        this.seedEpoch++;
        this.followShipIndex = null;
        this.followPoseCache = null;
        this.followPoseLastGood = null;
        this.followShadowLive = false;
        this.followSeedDone = false;
    }
    setFollowShipIndex(shipIndex) {
        this.resetTracking();
        this.followShipIndex = shipIndex;
        if (shipIndex != null)
            this.refreshFollowPoseFromGpu(shipIndex);
        // Follow force-includes bit 7 (agents only). Re-OR on the edge, not every rAF.
        this.scene.reapplySystemSceneFlags();
    }
    /**
     * Same-frame follow shadow: step the tracked ship on CPU with the same path
     * inputs / dt the GPU integrate will use, then cache pose for camera + origin.
     * Returns true when a pose was written to {@link followPoseCache}.
     */
    stepFollowShipShadow(dtMs, nowRel) {
        const i = this.followShipIndex;
        if (i == null || i < 0)
            return false;
        const o = i * SHIP_SIM_STRIDE;
        if (o + SHIP_SIM_STRIDE > this.storage.shipSimBytes.byteLength)
            return false;
        const rec = readShipSim(this.storage.shipSimView, o);
        if (!Number.isFinite(rec.posX) || !Number.isFinite(rec.posZ))
            return false;
        const fleetSlot = rec.fleetIndex | 0;
        const fo = fleetSlot * FLEET_GPU_STRIDE;
        let path;
        if (fo + FLEET_GPU_STRIDE <= this.storage.fleetGpuBytes.byteLength) {
            const flags = this.storage.fleetGpuView.getUint32(fo + FleetGpuFields.flags, true);
            path = {
                pathStartX: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.pathStartX, true),
                pathStartZ: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.pathStartZ, true),
                pathEndX: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndX, true),
                pathEndZ: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.pathEndZ, true),
                pathEndY: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields._pad0, true),
                t0: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.t0, true),
                durationMs: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.durationMs, true),
                domainWarpActive: (flags & FLEET_FLAG_JUMPING) !== 0,
                space3d: (flags & FLEET_FLAG_SPACE3D) !== 0,
                simPaused: (flags & FLEET_FLAG_SIM_PAUSED) !== 0,
                localMovement: (flags & (FLEET_FLAG_LOCAL_MOVE | FLEET_FLAG_SYSTEM_SCENE)) === (FLEET_FLAG_LOCAL_MOVE | FLEET_FLAG_SYSTEM_SCENE),
                formationHeading: this.storage.fleetGpuView.getFloat32(fo + FleetGpuFields.heading, true),
            };
        }
        else {
            // No fleet row — park orbit at current pos (still advances orientation).
            path = {
                pathStartX: rec.posX,
                pathStartZ: rec.posZ,
                pathEndX: rec.posX,
                pathEndZ: rec.posZ,
                pathEndY: rec.posY ?? 0,
                t0: nowRel,
                durationMs: 1,
                domainWarpActive: false,
            };
        }
        const agent = {
            posX: rec.posX,
            posY: rec.posY,
            posZ: rec.posZ,
            heading: rec.heading,
            speed: rec.speed,
            slotX: rec.slotX,
            slotY: rec.slotY,
            slotZ: rec.slotZ,
            qx: rec.qx,
            qy: rec.qy,
            qz: rec.qz,
            qw: rec.qw,
            mode: rec.mode,
            orbitR: rec.orbitR,
            orbitOmega: rec.orbitOmega,
            orbitPhase: rec.orbitPhase,
            accel: rec.accel,
            cruiseV: rec.cruiseV,
            omegaMax: rec.omegaMax,
        };
        stepFollowShipAgent(agent, path, dtMs, nowRel);
        writeShipSim(this.storage.shipSimView, o, {
            ...rec,
            posX: agent.posX,
            posY: agent.posY,
            posZ: agent.posZ,
            heading: agent.heading,
            speed: agent.speed,
            qx: agent.qx,
            qy: agent.qy,
            qz: agent.qz,
            qw: agent.qw,
            mode: agent.mode,
            orbitPhase: agent.orbitPhase,
            orbitR: agent.orbitR,
            orbitOmega: agent.orbitOmega,
            accel: agent.accel,
            cruiseV: agent.cruiseV,
            omegaMax: agent.omegaMax,
        });
        const pose = followPoseFromAgent(agent, i);
        this.followPoseCache = pose;
        this.followPoseLastGood = pose;
        this.followShadowLive = true;
        return true;
    }
    /**
     * Upload followed-ship pose so model draw matches the camera shadow.
     * Must **not** full-row upload — that clobbers GPU trailWrite/sinceSample and
     * kills pot trails on the chased ship only (see uploadShipSimFollowShadowPose).
     */
    uploadFollowShipShadowToGpu() {
        const i = this.followShipIndex;
        if (i == null || i < 0 || !this.followShadowLive)
            return;
        this.layer.uploadShipSimFollowShadowPose(this.storage.shipSimU8, i);
    }
}
//# sourceMappingURL=follow-shadow.js.map