import { JEWEL_RADIUS } from "./directed-present.wgsl.js";
const SCREEN_TRAILS = { depthAware: true, sceneTrailScale: false, screenPx: 1 };
const HULL_TRAILS = { depthAware: true, sceneTrailScale: true };
export function createFleetFrameEncoding(ships, models, coordinates, surface, directed = null, modelsLow = null, modelsTiny = null) {
    const visibilityPeers = [modelsLow, modelsTiny].filter((layer) => layer !== null);
    const camera = {
        cameraY: 1, targetX: 0, targetZ: 0, viewportH: 1, viewportW: 1, tanHalfFov: 1, originX: 0, originY: 0, originZ: 0,
    };
    const options = { anyScene: false, follow: false, systemSceneActive: false, hideNonSceneDraw: false };
    function prepare(frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        camera.cameraY = frame.distance;
        camera.viewportH = frame.cssHeight;
        camera.viewportW = frame.cssWidth ?? frame.cssHeight;
        camera.tanHalfFov = frame.tanHalfFov;
        camera.targetX = frame.sceneOpen ? coordinates.system.target.x : frame.targetX;
        camera.targetZ = frame.sceneOpen ? coordinates.system.target.z : frame.targetZ;
        camera.originX = space.origin.x;
        camera.originY = space.origin.y;
        camera.originZ = space.origin.z;
        options.anyScene = frame.anyScene || frame.following;
        options.follow = frame.following;
        options.systemSceneActive = frame.sceneOpen;
        options.hideNonSceneDraw = frame.sceneOpen || frame.galaxyFade < 1;
        options.kernelTrailCount = frame.sceneOpen ? frame.sceneShipCapacity : 0;
    }
    function integrate(encoder, frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        const proj = frame.sceneOpen ? coordinates.sceneClip() : coordinates.projection;
        ships.prepareTrailVisibility(space.viewProj, space.view, frame.sceneOpen && !frame.referenceTrailVisibility, !frame.sceneOpen, proj, surface.height);
        ships.dispatchIntegrate(encoder, frame.nowMs, frame.dtMs, frame.fleetHighWater, frame.shipHighWater, camera, options);
        const detail = models.getDetailThresholds?.();
        directed?.setPresentationCamera?.(space.viewProj, space.origin, surface.height, proj[5], detail?.[0], detail?.[1]);
        directed?.encodeTick(encoder, frame.timeSec, Math.max(0, frame.dtMs) * 0.001, frame.sceneOpen, frame.nowMs);
        if (frame.sceneOpen)
            directed?.encodeFollowCamera?.(encoder, space.view, proj, coordinates.system.eye);
        ships.dispatchTrailExpand(encoder);
    }
    function prepareVisibility(encoder, frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        const hullSpace = frame.sceneOpen ? coordinates.hulls : space;
        modelsTiny?.setPixelGain(Math.abs(coordinates.sceneClip()[5]) * surface.height);
        if (models.prepareSharedVisibility?.(encoder, hullSpace.viewProj, hullSpace.origin, visibilityPeers, frame.referenceModelVisibility))
            return;
        models.prepareVisibility(encoder, hullSpace.viewProj, hullSpace.origin, frame.referenceModelVisibility);
        modelsLow?.prepareVisibility(encoder, hullSpace.viewProj, hullSpace.origin, frame.referenceModelVisibility);
        modelsTiny?.prepareVisibility(encoder, hullSpace.viewProj, hullSpace.origin, frame.referenceModelVisibility);
    }
    function encodeStrategicTrails(pass, frame) {
        if (!frame.sceneOpen || frame.hullsOn)
            return;
        const space = coordinates.system;
        ships.encodeTrails(pass, space.view, coordinates.sceneClip(), surface.width, surface.height, frame.distance, space.origin, {
            ...SCREEN_TRAILS, intensity: 1, jewelRadius: JEWEL_RADIUS,
        });
    }
    function encodeShips(pass, frame) {
        if (frame.sceneOpen && frame.hullsOn)
            return;
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        ships.encode(pass, space.viewProj, 0.95, camera, frame.sceneOpen);
    }
    function encodeModels(pass, frame, withTrails = true, withHigh = true) {
        if (!frame.sceneOpen || !frame.hullsOn)
            return;
        const space = coordinates.system;
        // Lighting remains sun-local; hull matrices subtract the camera origin first.
        if (withHigh)
            encodeHighModels(pass, frame);
        modelsLow?.encode(pass, coordinates.hulls.viewProj, undefined, coordinates.hulls.origin, space.eye, frame.timeSec);
        modelsTiny?.encode(pass, coordinates.hulls.viewProj, undefined, coordinates.hulls.origin, space.eye, frame.timeSec);
        if (withTrails)
            encodeHullTrails(pass, frame);
    }
    function encodeHighModels(pass, frame) {
        if (frame.sceneOpen && frame.hullsOn && frame.hullHighOn)
            models.encode(pass, coordinates.hulls.viewProj, undefined, coordinates.hulls.origin, coordinates.system.eye, frame.timeSec);
    }
    function encodeHullTrails(pass, frame, glowMode, opaqueDepth) {
        if (!frame.sceneOpen || !frame.hullsOn)
            return;
        const space = coordinates.system;
        // Opaque hulls write depth before the depth-tested, non-writing pot trails.
        ships.encodeTrails(pass, space.view, coordinates.sceneClip(), surface.width, surface.height, frame.distance, space.origin, {
            ...HULL_TRAILS, intensity: 1, jewelRadius: JEWEL_RADIUS, glowMode, opaqueDepth,
        });
    }
    function encodeDebug(pass, frame) {
        if (!frame.sceneOpen)
            return;
        directed?.encodeDensity?.(pass, coordinates.system.viewProj, frame.focusedBodyIndex);
        const viewW = frame.cssWidth || surface.width;
        const viewH = frame.cssHeight || surface.height;
        directed?.encodeFleetAltitude?.(pass, coordinates.system.viewProj, viewW, viewH);
        directed?.encodeRepulsion?.(pass, coordinates.system.viewProj, coordinates.system.view);
    }
    return { battleFxInputs: () => directed?.battleFxInputs?.() ?? null, prepare, integrate, prepareVisibility, encodeStrategicTrails, encodeShips, encodeModels, encodeHighModels, encodeHullTrails, encodeDebug,
        highHullDrawArguments: () => models.compositeDrawArguments(),
        hasHighHullCandidates: () => models.hasDrawCandidates(),
        glowDrawArguments: () => ships.glowDrawArguments() };
}
//# sourceMappingURL=frame-encoding.js.map