import { composeCompactBodyWorld } from "../gpu/solar-system-lod.js";
const SNAPSHOT_SCENE_FLEET_LIMIT = 256;
function collectSceneFleetRefs(state, remote) {
    const refs = [];
    for (const id of state.sceneFleetIds) {
        const visual = state.view.getFleetVisual(id);
        if (visual)
            refs.push({ id, visual });
        if (refs.length >= SNAPSHOT_SCENE_FLEET_LIMIT)
            return refs;
    }
    refs.push(...remote.slice(0, SNAPSHOT_SCENE_FLEET_LIMIT - refs.length));
    return refs;
}
function fleetSnapshotPosition(state, id, visual, slot) {
    if (state.selectedFleetId === id) {
        const pose = state.view.getLiveShipPose(visual.instanceStart);
        if (pose)
            return { x: pose.posX, y: pose.posY, z: pose.posZ };
    }
    const sceneLocal = (slot.flags & 128) !== 0 && state.view.solarBodies.systemId != null;
    if (!sceneLocal)
        return { x: slot.pathEndX, y: 0, z: slot.pathEndZ };
    return {
        x: slot.pathEndX + state.view.solarBodies.systemX,
        y: slot.pathEndY,
        z: slot.pathEndZ + state.view.solarBodies.systemZ,
    };
}
function observeSceneFleet(state, id, visual) {
    const slot = state.view.readFleetGpuSlot(visual.id);
    if (!slot || visual.instanceActive <= 0)
        return null;
    const position = fleetSnapshotPosition(state, id, visual, slot);
    return {
        id, shipIndex: visual.instanceStart,
        ...position,
        shipCount: visual.counts.red + visual.counts.blue + visual.counts.green,
        state: visual.state.state,
    };
}
export function sceneFleetPage(state, remote, offset, limit) {
    const refs = [];
    for (const id of state.sceneFleetIds) {
        const visual = state.view.getFleetVisual(id);
        if (visual)
            refs.push({ id, visual });
    }
    refs.push(...remote);
    const start = Math.max(0, offset | 0), count = Math.max(1, Math.min(256, limit | 0));
    const fleets = [];
    for (const { id, visual } of refs.slice(start, start + count)) {
        const row = observeSceneFleet(state, id, visual);
        if (row)
            fleets.push(row);
        state.sceneFleetRenderIds.set(id, visual.id);
    }
    return { total: refs.length, offset: start, fleets };
}
function sceneFleetSnapshots(state, remote) {
    const out = [];
    for (const { id, visual } of collectSceneFleetRefs(state, remote)) {
        const observed = observeSceneFleet(state, id, visual);
        if (!observed)
            continue;
        out.push(observed);
        state.sceneFleetRenderIds.set(id, visual.id);
    }
    return out;
}
export function bodySnapshots(state) {
    const store = state.view.solarBodies;
    const time = state.view.getSceneTimeSec();
    const bodies = [];
    for (let index = 0; index < store.currentCount; index++) {
        const def = store.defs[index];
        const position = composeCompactBodyWorld(store, index, time);
        if (!def || !position)
            continue;
        bodies.push({
            index, name: def.name, kind: def.kind,
            catalogId: store.catalogIds[index] ?? def.id, isSun: store.isSun[index] === 1,
            ...position, radius: store.radius[index], drawMargin: def.drawMargin,
        });
    }
    return bodies;
}
export function renderSnapshot(state, remote = [], remoteTotal = remote.length) {
    const { view, camera } = state;
    return {
        sequence: state.sequence, camera: view.getCameraState(), origin: view.getFrameOrigin(),
        dragging: camera.isDragging, following: camera.isFollowing(), orbiting: camera.isOrbiting(),
        cursor: state.cursor, galaxyFade: view.getGalaxyFade(),
        systemId: view.solarBodies.systemId, sceneNode: view.getSceneFleetNode(),
        sceneTimeSec: view.getSceneTimeSec(), bodies: bodySnapshots(state),
        sceneFleets: sceneFleetSnapshots(state, remote), selectedFleetId: state.selectedFleetId,
        sceneFleetCount: state.sceneFleetIds.size + remoteTotal,
        focusIndex: view.getFocusedBodyIndex() ?? camera.getOrbitPose()?.focusIndex ?? null,
        hiCatalogId: view.catalogResidency.hiCatalogId(), sceneSpanPx: view.getSceneSpanPx(),
        bandBDraws: view.getBandBLastDrawCount(), bandCDraws: view.getLastBandCDrawCount(),
        edit: state.edit,
        director: { playing: state.director.isPlaying(), target: state.director.currentMeta() },
        metrics: {
            frame: state.frame, lastCpuMs: view.getLastFrameCpuMs(), lastGpuMs: view.getLastFrameGpuMs(),
            cpuAverageMs: view.getFrameCpuSampleAvg(), cpuSamples: view.getFrameCpuSampleCount(),
            gpuAverageMs: view.getFrameGpuSampleAvg(), gpuSamples: view.getFrameGpuSampleCount(),
            fleetCount: view.getFleetCount(), shipHighWater: view.getShipHighWater(),
            pendingFleets: state.fleets.size(), bulkShipBudgetHint: view.getBulkShipBudgetHint(),
            deviceLost: view.isDeviceLost(),
        },
    };
}
export function sceneDiagnostics(state) {
    const { view } = state;
    const points = [];
    for (const cluster of state.galaxy.clusters) {
        for (const system of cluster.solarSystems) {
            const bufferIndex = system._bufferIndex ?? -1;
            points.push({ systemId: system.id, bufferIndex, hidden: view.store.lodHidden[bufferIndex] === 1 });
        }
    }
    const fleets = [];
    for (const id of state.fleetIds) {
        const slot = view.readFleetGpuSlot(id);
        if (slot)
            fleets.push({ id, slot });
    }
    return {
        snapshot: renderSnapshot(state), points, fleets,
        topologyEncoded: view.getLastGalaxyTopologyEncoded(), passSetHash: view.getLastPassSetHash(),
        orbitRingSegments: view.getLastOrbitRingSegments(), jumpRaySegments: view.getLastJumpRaySegments(),
        resolveDepthAttached: view.wasPassResolveDepthAttached(), focusAtmosphere: view.getLastFocusAtmMode(),
        modelReady: view.modelLayer.isReady(), modelActive: view.modelLayer.isActive(),
        modelSelectedCount: view.modelLayer.getLastShipIndices().length,
        modelSubmittedCandidates: view.modelLayer.getLastInstanceCount(), modelInstanceLimit: view.modelLayer.getMaxInstances(),
    };
}
//# sourceMappingURL=runtime-state.js.map