import { replayGalaxyOps } from "../galaxy/galaxy-op-replayer.js";
import { createCameraDirectorHost } from "../render/camera-director-host.js";
import { SCENE_FLEET_ORBIT_MAX_RADIUS, SCENE_FLEET_ORBIT_MIN_RADIUS, SCENE_FLEET_ORBIT_RADIUS, } from "../gpu/camera-zoom.js";
function moveCluster(ctx, command) {
    const { state, dragStarts } = ctx;
    const cluster = state.galaxy.getClusterById(command.clusterId);
    if (!cluster)
        return;
    if (!dragStarts.has(cluster.id))
        dragStarts.set(cluster.id, { ...cluster.position });
    state.galaxy.previewMoveCluster(cluster, command.position);
    if (command.commit) {
        state.galaxy.commitMoveCluster(cluster, dragStarts.get(cluster.id), command.position);
        dragStarts.delete(cluster.id);
    }
    state.view.updateEditOverlayPosition(cluster.id, command.position);
}
function applyTopology(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case "topology": {
            const result = replayGalaxyOps(state.galaxy, command.ops, ctx);
            ctx.maxSolarSystemId = result.maxSolarSystemId;
            return true;
        }
        case "finalize":
            state.view.finalizeBuffers(state.galaxy);
            return true;
        case "moveCluster":
            moveCluster(ctx, command);
            return true;
        case "connectionColors":
            state.view.setConnectionColors(command.colors);
            return true;
        case "hover":
            state.view.setHoverRing(command.ring);
            return true;
        case "select":
            state.view.setSelectRing(command.ring);
            return true;
        default: return false;
    }
}
function applyEditing(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case "showEditHandles":
            state.edit = { clusterId: command.clusterId, handles: command.handles, radius: command.radius };
            state.view.showEditHandles(command.clusterId, command.handles, command.radius);
            return true;
        case "hideEditHandles":
            state.edit = null;
            state.view.hideEditHandles();
            return true;
        case "editMode":
            state.editMode = command.active;
            return true;
        default: return false;
    }
}
function applyFleets(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case "fleetSpawn":
            state.fleets.enqueue(command.fleets);
            return true;
        case "fleetState":
            if (!state.fleets.update(command.id, command.state))
                state.view.updateFleetState(command.id, command.state);
            return true;
        case "fleetRemove":
            state.fleets.remove(command.id);
            state.fleetIds.delete(command.id);
            state.sceneFleetIds.delete(command.id);
            if (state.selectedFleetId === command.id)
                selectFleet(ctx, null);
            state.view.removeFleet(command.id);
            return true;
        case "clearFleets":
            clearFleets(state);
            return true;
        case "fleetBudget":
            state.view.setBulkShipBudgetHint(command.count);
            return true;
        case "reserveFleets":
            state.view.reserveFleetCapacity(command.count, command.shipsPerFleet);
            return true;
        default: return false;
    }
}
function clearFleets(state) {
    state.fleets.clear();
    state.fleetIds.clear();
    state.view.clearFleets();
    state.sceneFleetIds.clear();
    state.sceneFleetRenderIds.clear();
    state.selectedFleetId = null;
    state.camera.setFollowShip(null);
    state.view.setFollowShipIndex(null);
}
function resetDirector(state) {
    state.director = createCameraDirectorHost({ applyPose: (pose) => state.camera.applyDirectorPose(pose) });
}
function clearWorld(ctx) {
    clearFleets(ctx.state);
    resetDirector(ctx.state);
    ctx.focus.clearFocus();
    ctx.state.view.clear();
    ctx.state.galaxy.clear();
    ctx.state.edit = null;
    ctx.dragStarts.clear();
    ctx.maxSolarSystemId = 0;
}
function applyLifecycle(ctx, command) {
    const { view } = ctx.state;
    switch (command.type) {
        case "clear":
            clearWorld(ctx);
            return true;
        case "viewport":
            view.resize(command.viewport.width, command.viewport.height, command.viewport.dpr);
            return true;
        case "start":
            ctx.state.running = true;
            view.startRenderLoop();
            return true;
        case "stop":
            ctx.state.running = false;
            view.stopLoop();
            return true;
        case "sampleFrames":
            view.beginFrameCpuSample();
            return true;
        case "pumpHiLoad":
            view.catalogResidency.pumpHiLoad();
            return true;
        default: return false;
    }
}
function selectBody(ctx, command) {
    const { view, camera } = ctx.state;
    const store = view.solarBodies;
    if (store.systemId == null || store.systemId !== command.systemId)
        return;
    if (command.index < 0 || command.index >= store.currentCount)
        return;
    const catalogId = store.catalogIds[command.index] ?? store.defs[command.index]?.id;
    if (command.catalogId != null && command.catalogId !== catalogId)
        return;
    ctx.state.selectedFleetId = null;
    view.setFollowShipIndex(null);
    if (store.isSun[command.index]) {
        ctx.focus.clearFocus();
        camera.setSystemOrbitSun();
    }
    else
        ctx.focus.lockBody(command.index);
}
function followShip(state, index) {
    state.view.setFollowShipIndex(index);
    state.camera.setFollowShip(index == null ? null : () => state.view.getLiveShipPose(index));
}
function fleetTargetPosition(state, renderId) {
    const slot = state.view.readFleetGpuSlot(renderId);
    if (!slot)
        return null;
    const local = (slot.flags & 128) !== 0 && state.view.solarBodies.systemId != null;
    return {
        x: slot.pathEndX + (local ? state.view.solarBodies.systemX : 0),
        y: local ? slot.pathEndY : 0,
        z: slot.pathEndZ + (local ? state.view.solarBodies.systemZ : 0),
    };
}
function liveFleetTarget(state, renderId, shipIndex) {
    if (!state.view.getFleetVisual(renderId))
        return null;
    const pose = state.view.getLiveShipPose(shipIndex);
    return pose ? { x: pose.posX, y: pose.posY, z: pose.posZ } : fleetTargetPosition(state, renderId);
}
function selectFleet(ctx, id) {
    const { state } = ctx;
    if (id == null) {
        state.selectedFleetId = null;
        state.view.setFollowShipIndex(null);
        state.camera.setSystemOrbitFree();
        return;
    }
    const renderId = state.sceneFleetRenderIds.get(id) ?? id;
    const visual = state.view.getFleetVisual(renderId);
    if (!visual || !fleetTargetPosition(state, renderId))
        return;
    ctx.focus.clearFocus();
    state.selectedFleetId = id;
    state.view.setFollowShipIndex(visual.instanceStart);
    state.view.refreshFollowPoseFromGpu(visual.instanceStart);
    state.camera.setSystemOrbitTarget({
        targetId: visual.fleetSlot + 1000000,
        getPosition: () => liveFleetTarget(state, renderId, visual.instanceStart),
        radius: SCENE_FLEET_ORBIT_RADIUS,
        minRadius: SCENE_FLEET_ORBIT_MIN_RADIUS,
        maxRadius: SCENE_FLEET_ORBIT_MAX_RADIUS,
    });
}
function setSceneFleetIds(ctx, ids) {
    const { state } = ctx;
    state.sceneFleetIds = new Set(ids);
    if (state.selectedFleetId != null && !state.sceneFleetIds.has(state.selectedFleetId))
        selectFleet(ctx, null);
}
function applyFocus(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case "selectBody":
            selectBody(ctx, command);
            return true;
        case "sceneFleetIds":
            setSceneFleetIds(ctx, command.ids);
            return true;
        case "selectFleet":
            selectFleet(ctx, command.id);
            return true;
        case "pickBody":
            ctx.focus.tryPickBody(command.x, command.y);
            return true;
        case "clearFocus":
            ctx.focus.clearFocus();
            state.selectedFleetId = null;
            state.view.setFollowShipIndex(null);
            return true;
        case "followShip":
            followShip(state, command.shipIndex);
            return true;
        case "followRandomShip": {
            if (state.camera.isFollowing())
                followShip(state, null);
            else {
                const ship = state.view.pickRandomShipPose();
                if (ship)
                    followShip(state, ship.shipIndex);
            }
            return true;
        }
        default: return false;
    }
}
function applyNavigation(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case "input":
            if (command.input.type === "doubleClick")
                ctx.focus.clearFocus();
            state.camera.handleInput(command.input);
            return true;
        case "focusPoint":
            state.camera.focusOnPoint(command.x, command.z, command.height);
            return true;
        case "cameraPose": {
            const p = command.camera;
            state.view.setCameraLookAt(p.eyeX, p.eyeY, p.eyeZ, p.targetX, p.targetZ, p.targetY);
            state.camera.adoptViewCamera();
            return true;
        }
        case "directorFly":
            state.director.flyToSystem(state.view.getCameraState(), command, command.height, command.durationMs);
            return true;
        default: return false;
    }
}
export function applyRenderCommand(ctx, command) {
    if (applyTopology(ctx, command))
        return;
    if (applyEditing(ctx, command))
        return;
    if (applyFleets(ctx, command))
        return;
    if (applyLifecycle(ctx, command))
        return;
    if (applyFocus(ctx, command))
        return;
    if (applyNavigation(ctx, command))
        return;
    throw new Error(`Unknown render command: ${command.type}`);
}
//# sourceMappingURL=runtime-commands.js.map