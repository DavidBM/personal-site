import { fleetOrbitTracking, remoteShipTracking } from './remote/camera-tracking.js';
import { scheduleFxTuning, setFxEnabled } from '../features/battles/fx-tuning.js';
/** Explicit feature commands; no reflection or arbitrary method RPC. */
// @ts-expect-error Native GPU presentation module.
import { scheduleBattleTuning } from '../lib/ship-runtime/battle-tuning.mjs';
import { replayGalaxyOps } from "../galaxy/galaxy-op-replayer.js";
import { createCameraDirectorHost } from "../render/camera-director-host.js";
import { SCENE_FLEET_ORBIT_RADIUS, SCENE_FLEET_ORBIT_MIN_RADIUS } from '../gpu/camera-zoom.js';
// @ts-expect-error declarations live in class-tuning.mjs.d.ts
import { scheduleShipTuning } from "../lib/ship-runtime/class-tuning.mjs";
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
function applySurvey(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case 'planetPresence':
            state.view.survey.planetMarkers.set(command.systemId, command.value);
            return true;
        case 'mapLayers':
            state.view.survey.mapOptions = command.value;
            state.mapRoutes?.options(command.value);
            return true;
        case 'mapColonies':
            state.view.survey.setColonies(command.rows, command.reset);
            return true;
        case 'mapRoute':
            state.mapRoutes?.update(command);
            return true;
        case 'journeyPath':
            state.travel?.path(command.value);
            return true;
        case 'frameFleetJump':
            state.travel?.frameJump(true);
            return true;
        case 'incomingFleets':
            state.view.survey.incomingSystem = command.systemId;
            state.view.survey.incoming = command.rows.slice(0, 32);
            return true;
        case 'surveyRoster':
            state.view.survey.fleetTotals().setRoster(command.fleets);
            return true;
        case 'surveyPlanets':
            state.view.survey.signals.setPlanets(command.value);
            state.view.survey.planetMarkers.catalog(command.value);
            return true;
        case 'surveyAlerts':
            state.view.survey.signals.setAlerts(command.rows, command.partial);
            return true;
        case 'surveyBattle':
            state.view.survey.signals.setBattle(command.value);
            return true;
        case 'surveyBattleClear':
            state.view.survey.signals.removeBattle(command.id);
            return true;
        case 'surveyLocalBattle':
            applySurveyBattle(state, command.event);
            return true;
        default: return false;
    }
}
function applyTopology(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case "topology": {
            state.topologyConnections = command.connections !== false;
            const result = replayGalaxyOps(state.galaxy, command.ops, ctx);
            ctx.maxSolarSystemId = result.maxSolarSystemId;
            return true;
        }
        case "mapConnections":
            applyMapConnections(state, command.patch);
            return true;
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
function applyMapConnections(state, patch) {
    if (patch.clear)
        state.view.clearLines();
    for (const key of patch.remove ?? [])
        state.view.removeConnection(key);
    for (const line of patch.upsert ?? []) {
        if (!state.view.updateConnectionEndpoints(line.key, line.a, line.b))
            state.view.addConnection(line.key, line.a, line.b, line.color);
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
            if (state.selectedFleetId === command.id) {
                stopFollowingShip(state, 'fleet-removed');
                selectFleet(ctx, null);
            }
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
    state.travel?.select(null);
    state.focusedFleetId = null;
    state.fleets.clear();
    state.fleetIds.clear();
    state.view.clearFleets();
    state.sceneFleetIds.clear();
    state.sceneFleetRenderIds.clear();
    state.selectedFleetId = null;
    state.view.setSelectedFleetId(null);
    state.view.setHoveredFleetId(null);
    state.camera.setFollowShip(null, 'fleets-cleared');
    state.view.setFollowShipIndex(null, 'fleets-cleared');
}
function resetDirector(state) {
    state.director = createCameraDirectorHost({ applyPose: (pose) => state.camera.applyDirectorPose(pose) });
}
function clearWorld(ctx) {
    ctx.state.mapRoutes?.clear();
    ctx.state.view.survey.setColonies([]);
    clearFleets(ctx.state);
    resetDirector(ctx.state);
    ctx.focus.clearFocus();
    ctx.state.view.survey.incoming = [];
    ctx.state.view.survey.incomingSystem = null;
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
    resetDirector(ctx.state);
    stopFollowingShip(ctx.state, 'body-selected');
    ctx.state.selectedFleetId = null;
    ctx.state.focusedFleetId = null;
    view.setSelectedFleetId(null);
    view.setFollowShipIndex(null);
    if (store.isSun[command.index]) {
        ctx.focus.clearFocus();
        camera.setSystemOrbitSun();
    }
    else
        ctx.focus.lockBody(command.index);
}
function followShip(state, index, reason = 'follow-command') {
    if (state.view.setFollowShipIndex(index, reason) === false)
        return false;
    state.camera.setFollowShip(index == null ? null : () => state.view.getLiveShipPose(index), reason);
    return true;
}
function stopFollowingShip(state, reason) {
    if (state.camera.isFollowing())
        followShip(state, null, reason);
}
function clearSelection(ctx) {
    const { state } = ctx;
    state.focusedFleetId = null;
    // Clearing only the GPU readback leaves the callback waiting forever for a
    // new pose. Stop the camera first, then release selection/hi-res residency.
    stopFollowingShip(state, 'selection-cleared');
    ctx.focus.clearFocus();
    state.selectedFleetId = null;
    state.view.setSelectedFleetId(null);
    state.view.setFollowShipIndex(null);
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
function sceneFleetFocusPoint(state, renderId) {
    const parked = fleetTargetPosition(state, renderId);
    const local = typeof state.view.sceneFleetTrackingPoint === "function"
        ? state.view.sceneFleetTrackingPoint(renderId)
        : null;
    if (!local)
        return parked;
    return {
        x: local.x + state.view.solarBodies.systemX,
        y: local.y,
        z: local.z + state.view.solarBodies.systemZ,
    };
}
function selectFleet(ctx, id) {
    const { state } = ctx;
    if (id == null) {
        stopFollowingShip(state, 'fleet-deselected');
        state.selectedFleetId = null;
        state.focusedFleetId = null;
        state.view.setSelectedFleetId(null);
        state.view.setFollowShipIndex(null);
        state.camera.setSystemOrbitFree();
        return;
    }
    const renderId = state.sceneFleetRenderIds.get(id) ?? id;
    const visual = state.view.getFleetVisual(renderId);
    const parked = sceneFleetFocusPoint(state, renderId);
    if (!visual || !parked)
        return;
    resetDirector(state);
    stopFollowingShip(state, 'fleet-selected');
    ctx.focus.clearFocus();
    state.selectedFleetId = id;
    state.focusedFleetId = id;
    state.view.setSelectedFleetId(renderId);
    if (state.view.solarBodies.systemId == null)
        return;
    state.camera.setSystemOrbitTarget({
        targetId: -1,
        radius: SCENE_FLEET_ORBIT_RADIUS,
        minRadius: SCENE_FLEET_ORBIT_MIN_RADIUS,
        getPosition: fleetOrbitTracking(state, id, visual, renderId => sceneFleetFocusPoint(state, renderId)),
    });
}
function followFleet(ctx, id, shipType) {
    const { state } = ctx;
    if (id == null) {
        followShip(state, null);
        state.camera.setSystemOrbitFree();
        return;
    }
    const renderId = state.sceneFleetRenderIds.get(id) ?? id;
    const visual = state.view.getFleetVisual(renderId);
    if (!visual || !fleetTargetPosition(state, renderId)) {
        state.view.noteFollowEvent?.('rejected:fleet-not-visible');
        return;
    }
    const types = state.view.sceneShipTypes(renderId);
    const chosen = shipType == null ? types[0] : types.find(row => row.type === shipType);
    if (!chosen) {
        state.view.noteFollowEvent?.('rejected:class-not-admitted');
        return;
    }
    const handle = state.view.getSceneShipHandle(renderId, chosen.ordinal);
    if (handle == null) {
        state.view.noteFollowEvent?.('rejected:ship-not-admitted');
        return;
    }
    // Acquire before releasing other camera targets. Reselecting during empty
    // transit must not temporarily drop the only lease that owns the local frame.
    if (state.view.setFollowShipIndex(handle, 'fleet-follow') === false)
        return;
    state.camera.setFollowShip(remoteShipTracking(state, id, chosen.type, handle), 'fleet-follow');
    ctx.focus.clearFocus();
    state.selectedFleetId = id;
    state.focusedFleetId = id;
    state.view.setSelectedFleetId(renderId);
}
function setSceneFleetIds(ctx, ids) {
    const { state } = ctx;
    const wasListed = state.selectedFleetId != null && state.sceneFleetIds?.has(state.selectedFleetId);
    state.sceneFleetIds = new Set(ids);
    if (state.selectedFleetId == null || state.sceneFleetIds.has(state.selectedFleetId))
        return;
    const renderId = state.sceneFleetRenderIds.get(state.selectedFleetId) ?? state.selectedFleetId;
    // This is the UI's logical roster, not a retirement command. A late departing
    // fleet or retained follow can legitimately outlive membership in that roster.
    if (state.camera.isFollowing() || state.view.isSceneFleetResident?.(renderId)) {
        if (wasListed)
            state.view.noteFollowEvent?.('roster:left-system-follow-preserved');
        return;
    }
    selectFleet(ctx, null);
}
function applyFocus(ctx, command) {
    const { state } = ctx;
    switch (command.type) {
        case 'planetDevelopment': {
            if (command.open && command.live && !state.planetReturn) {
                const store = state.view.solarBodies, index = ctx.focus.getFocusIndex();
                state.planetReturn = { restore: state.camera.captureView(), systemId: store.systemId, catalogId: index == null ? undefined : store.catalogIds[index] };
            }
            if (!command.open && state.planetReturn) {
                resetDirector(state);
                ctx.focus.clearFocus();
                const previous = state.planetReturn, store = state.view.solarBodies;
                if (previous.catalogId && previous.systemId === store.systemId) {
                    const index = store.catalogIds.indexOf(previous.catalogId);
                    if (index >= 0)
                        ctx.focus.lockBody(index, { moveCamera: false });
                }
                previous.restore();
                state.planetReturn = undefined;
            }
            const old = state.planetDevelopment;
            const acquired = old?.open && old.live && old.systemId === command.systemId && old.catalogId === command.catalogId && old.acquired;
            state.planetDevelopment = { ...command, acquired };
            state.view.setPlanetDepthFocus(command.open && command.live && command.systemId != null && command.catalogId ? { systemId: command.systemId, catalogId: command.catalogId } : null);
            state.view.setSceneLabelsVisible(!command.open);
            state.view.setPresentationFrozen(command.open && !command.live);
            if (state.running && (!command.open || command.live))
                state.view.startRenderLoop();
            return true;
        }
        case "selectBody":
            selectBody(ctx, command);
            return true;
        case "sceneFleetIds":
            setSceneFleetIds(ctx, command.ids);
            return true;
        case "markFleet":
            state.selectedFleetId = command.id;
            state.travel?.select(command.id);
            state.view.setSelectedFleetId(command.id == null ? null : (state.sceneFleetRenderIds.get(command.id) ?? command.id));
            return true;
        case "selectFleet":
            selectFleet(ctx, command.id);
            return true;
        case "followFleet":
            followFleet(ctx, command.id, command.shipType);
            return true;
        case "hoverFleet":
            state.view.setHoveredFleetId(command.id == null ? null : (state.sceneFleetRenderIds.get(command.id) ?? command.id));
            return true;
        case "debugDensityVoxels":
            state.view.setDebugDensityVoxels?.(command.on);
            return true;
        case "debugRepulsion":
            state.view.setDebugRepulsion?.(command.on);
            return true;
        case "simulationRate":
            state.view.setSimulationRate(command.hz);
            return true;
        case "clearQualityDiagnostics":
            state.view.clearQualityDiagnostics();
            return true;
        case "starField":
            state.view.setStarField(command.on);
            return true;
        case "highFx":
            state.view.setHighFx(command.on);
            return true;
        case "fleetPaths":
            state.view.setFleetPathsVisible(command.on);
            return true;
        case "fleetDebug":
            state.view.setFleetDebugVisible(command.on);
            return true;
        case "simPause":
            state.view.setSimPause(command);
            return true;
        case 'battleFx':
            scheduleFxTuning(command.patches);
            if (command.enabled !== undefined)
                setFxEnabled(command.enabled);
            return true;
        case 'battleTuning':
            scheduleBattleTuning(command.patches);
            return true;
        case "shipTuning":
            scheduleShipTuning(command);
            return true;
        case "pickBody":
            ctx.focus.tryPickBody(command.x, command.y);
            return true;
        case "clearFocus":
            clearSelection(ctx);
            return true;
        case "followShip":
            followShip(state, command.shipIndex);
            return true;
        case "followRotation":
            state.camera.setFollowRotation(command.enabled);
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
            if (command.input.type === 'reducedMotion')
                state.view.survey.reducedMotion = command.input.value;
            if (command.input.type === 'touchGesture') {
                if (state.director.isPlaying())
                    resetDirector(state);
            }
            if (command.input.type === "doubleClick") {
                state.focusedFleetId = null;
                ctx.focus.clearFocus();
            }
            state.camera.handleInput(command.input);
            return true;
        case "focusPoint":
            state.focusedFleetId = null;
            state.camera.focusOnPoint(command.x, command.z, command.height);
            return true;
        case "cameraPose": {
            const p = command.camera;
            state.view.setCameraLookAt(p.eyeX, p.eyeY, p.eyeZ, p.targetX, p.targetZ, p.targetY);
            state.camera.adoptViewCamera();
            return true;
        }
        case "directorFly":
            state.focusedFleetId = null;
            resetDirector(state);
            state.director.flyToSystem(state.view.getCameraState(), command, command.height, command.durationMs);
            return true;
        default: return false;
    }
}
export function applyRenderCommand(ctx, command) {
    if (command.type === 'input' && ctx.state.planetDevelopment?.open)
        return;
    if (applySurvey(ctx, command))
        return;
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
function applySurveyBattle(state, e) {
    const relationships = [e.attacker, e.defender].map(id => state.view.getFleetVisual(id)?.relationship);
    const involvement = relationships.includes('own') ? 'own' : relationships.includes('ally') ? 'ally' : null;
    state.view.survey.signals.setBattle({ id: `local:${e.id}`, revision: String(e.revision),
        clusterId: e.node.clusterId, systemId: e.node.solarSystemId, involvement: involvement ?? 'own', active: e.stage === 'engaged' && involvement !== null });
}
/** Acquire once after system transit, using normal eased body focus and hi-res loading. */
export function tickPlanetDevelopment(ctx) {
    const { state } = ctx, p = state.planetDevelopment, store = state.view.solarBodies;
    if (!p?.open || !p.live || p.acquired || !p.catalogId || state.director.isPlaying() || store.systemId !== p.systemId)
        return;
    const index = store.catalogIds.indexOf(p.catalogId);
    if (index < 0 || index >= store.currentCount || store.isSun[index])
        return;
    resetDirector(state);
    stopFollowingShip(state, 'planet-development');
    state.focusedFleetId = null;
    state.view.setFollowShipIndex(null);
    ctx.focus.lockBody(index, { development: true });
    p.acquired = true;
}
//# sourceMappingURL=runtime-commands.js.map