/** Model selection and shared model/triangle/trail ownership, before integrate. */
import { BASE_SHIP_SIZE, MODEL_LOD_MAX_INSTANCES, isModelLodActiveSticky, fleetTopologyLocFromState, resolveModelFocusClusterId, isFleetModelTopologyEligible } from "../../fleet-lod.js";
import { SCENE_AGENT_SCALE, SCENE_SHIP_VISUAL_MUL } from "../../ship-motion-config.js";
import { FLEET_GPU_STRIDE, FleetGpuFields } from "../../fleet-layout.js";
import { createModelSelectionWorkspace, selectModelShipIndicesInto } from "../../../lib/fleet-sim/visual/model-selection.js";
const SCENE_WORLD_SIZE = BASE_SHIP_SIZE * SCENE_AGENT_SCALE * SCENE_SHIP_VISUAL_MUL;
const HEIGHT_GATE = { worldSize: SCENE_WORLD_SIZE, enterScreenPx: 8, exitScreenPx: 5 };
const EMPTY_INDICES = [];
export class FleetModelPresentation {
    constructor(ports) {
        this.workspace = createModelSelectionWorkspace();
        this.candidates = [];
        this.cache = new WeakMap();
        this.sticky = new Map();
        this.globalSticky = false;
        this.camera = {
            targetX: 0, targetZ: 0, cameraY: 1, tanHalfFov: 1,
            worldSize: SCENE_WORLD_SIZE, minScreenPx: 8, exitScreenPx: 5, neighborRadius: 2,
            assumeHeightGate: true,
        };
        this.ports = ports;
    }
    update(sceneOpen, distance, viewportH, tanHalfFov, frame, targetGalaxyX, targetGalaxyZ) {
        this.globalSticky = isModelLodActiveSticky(distance, viewportH, tanHalfFov, this.globalSticky, sceneOpen ? HEIGHT_GATE : undefined);
        if (sceneOpen)
            this.globalSticky = true;
        let indices = EMPTY_INDICES;
        if (sceneOpen && this.globalSticky && this.ports.models.isReady()) {
            this.updateCamera(frame, distance, viewportH, tanHalfFov);
            this.collectCandidates(frame, targetGalaxyX, targetGalaxyZ);
            indices = selectModelShipIndicesInto(this.workspace, this.candidates, this.camera, MODEL_LOD_MAX_INSTANCES, this.sticky);
            this.includeFollowedShip(indices, this.ports.follow.followShipIndex);
        }
        else
            this.sticky.clear();
        this.applyOwnership(indices);
        return indices;
    }
    updateCamera(frame, distance, viewportH, tanHalfFov) {
        const camera = this.camera;
        camera.targetX = frame.target.x;
        camera.targetZ = frame.target.z;
        camera.eyeX = frame.eye.x;
        camera.eyeY = frame.eye.y;
        camera.eyeZ = frame.eye.z;
        camera.cameraY = distance;
        camera.viewportH = viewportH;
        camera.tanHalfFov = tanHalfFov;
    }
    followedFleet() {
        const index = this.ports.follow.followShipIndex;
        if (index == null)
            return null;
        for (const fleet of this.ports.records.values()) {
            if (index >= fleet.instanceStart && index < fleet.instanceStart + fleet.instanceCapacity)
                return fleet;
        }
        return null;
    }
    collectCandidates(frame, targetX, targetZ) {
        const { follow, topology } = this.ports;
        const followed = this.followedFleet();
        const followLoc = followed ? fleetTopologyLocFromState(followed.state) : null;
        const focusId = resolveModelFocusClusterId(targetX, targetZ, topology.getModelClusterCenters(), followLoc);
        const context = focusId == null ? null : topology.getModelTopologyContext(focusId);
        const pose = follow.followShipIndex == null ? null : follow.getLiveShipPose(follow.followShipIndex);
        this.candidates.length = 0;
        for (const fleet of this.ports.records.values()) {
            if (!this.isSceneCandidate(fleet))
                continue;
            const candidate = this.candidateFor(fleet, context);
            if (!candidate.eligible && fleet !== followed)
                continue;
            this.updateCullPosition(candidate, fleet, frame);
            if (fleet === followed && pose) {
                candidate.posX = pose.posX - frame.anchor.x;
                candidate.posZ = pose.posZ - frame.anchor.z;
            }
            this.candidates.push(candidate);
        }
    }
    isSceneCandidate(fleet) {
        return fleet.instanceCapacity > 0 && this.ports.scene.fleetInSystemScene(fleet.state, fleet);
    }
    candidateFor(fleet, context) {
        let candidate = this.cache.get(fleet);
        if (!candidate) {
            this.sticky.delete(fleet.instanceStart);
            candidate = { instanceStart: fleet.instanceStart, shipBudget: fleet.instanceCapacity, posX: 0, posZ: 0, context: null, state: null, eligible: true };
            this.cache.set(fleet, candidate);
        }
        if (candidate.context !== context || candidate.state !== fleet.state) {
            candidate.eligible = context == null || isFleetModelTopologyEligible(fleetTopologyLocFromState(fleet.state), context);
            candidate.context = context;
            candidate.state = fleet.state;
        }
        return candidate;
    }
    updateCullPosition(candidate, fleet, frame) {
        const row = this.ports.storage.fleetGpuView, o = fleet.fleetSlot * FLEET_GPU_STRIDE;
        const markerX = row.getFloat32(o + FleetGpuFields.posX, true), markerZ = row.getFloat32(o + FleetGpuFields.posZ, true);
        const endX = row.getFloat32(o + FleetGpuFields.pathEndX, true), endZ = row.getFloat32(o + FleetGpuFields.pathEndZ, true);
        const mx = markerX - frame.target.x, mz = markerZ - frame.target.z;
        const ex = endX - frame.target.x, ez = endZ - frame.target.z;
        const endCloser = ex * ex + ez * ez <= mx * mx + mz * mz;
        candidate.posX = endCloser ? endX : markerX;
        candidate.posZ = endCloser ? endZ : markerZ;
    }
    includeFollowedShip(indices, tracked) {
        if (tracked == null || indices.includes(tracked))
            return;
        if (indices.length >= MODEL_LOD_MAX_INSTANCES)
            indices[indices.length - 1] = tracked;
        else
            indices.push(tracked);
    }
    applyOwnership(indices) {
        const { models, ships } = this.ports;
        const active = indices.length > 0;
        models.setActive(active);
        ships.setModelLodActive(active);
        if (!active) {
            ships.setModelHideIndices(EMPTY_INDICES);
            ships.setTrailDrawShipIndices(null);
            return;
        }
        ships.setModelHideIndices(indices);
        ships.setTrailDrawShipIndices(indices);
        const sim = ships.getShipSimBuffer();
        if (sim)
            models.setShipSimBuffer(sim);
        const fleets = ships.getFleetGpuBuffer();
        if (fleets)
            models.setFleetGpuBuffer(fleets);
        models.setShipIndices(indices);
    }
}
//# sourceMappingURL=model-presentation.js.map