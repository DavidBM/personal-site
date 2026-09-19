import { trailViewIntensity, SCENE_KERNEL_COUNT } from "./directed-present.wgsl.js";
const SCREEN_TRAILS = { depthAware: true, sceneTrailScale: false, screenPx: 1 };
const HULL_TRAILS = { depthAware: true, sceneTrailScale: true };
export function createFleetFrameEncoding(ships, models, coordinates, surface, directed = null, modelsLow = null) {
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
        options.kernelTrailCount = frame.sceneOpen ? SCENE_KERNEL_COUNT : 0;
    }
    function integrate(encoder, frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        const proj = frame.sceneOpen ? coordinates.sceneClip() : coordinates.projection;
        ships.prepareTrailVisibility(space.viewProj, space.view, frame.sceneOpen && !frame.referenceTrailVisibility, !frame.sceneOpen, proj, surface.height);
        ships.dispatchIntegrate(encoder, frame.nowMs, frame.dtMs, frame.fleetHighWater, frame.shipHighWater, camera, options);
        directed?.encodeTick(encoder, frame.timeSec, Math.max(0, frame.dtMs) * 0.001, frame.sceneOpen, frame.nowMs);
        ships.dispatchTrailExpand(encoder);
    }
    function prepareVisibility(encoder, frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        models.prepareVisibility(encoder, space.viewProj, space.origin, frame.referenceModelVisibility);
        modelsLow?.prepareVisibility(encoder, space.viewProj, space.origin, frame.referenceModelVisibility);
    }
    function encodeStrategicTrails(pass, frame) {
        if (!frame.sceneOpen || frame.hullsOn)
            return;
        const space = coordinates.system;
        ships.encodeTrails(pass, space.view, coordinates.sceneClip(), surface.width, surface.height, frame.distance, space.origin, {
            ...SCREEN_TRAILS, intensity: trailViewIntensity(frame.distance),
        });
    }
    function encodeShips(pass, frame) {
        if (frame.sceneOpen && frame.hullsOn)
            return;
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        ships.encode(pass, space.viewProj, 0.95, camera, frame.sceneOpen);
    }
    function encodeModels(pass, frame) {
        if (!frame.sceneOpen || !frame.hullsOn)
            return;
        const space = coordinates.system;
        // Rim eye and ShipSim/pathEnd are sun-local. GPU origin remains zero.
        if (frame.hullHighOn) {
            models.encode(pass, space.viewProj, undefined, space.origin, space.eye, frame.timeSec);
        }
        modelsLow?.encode(pass, space.viewProj, undefined, space.origin, space.eye, frame.timeSec);
        // Opaque hulls write depth before the depth-tested, non-writing pot trails.
        ships.encodeTrails(pass, space.view, coordinates.sceneClip(), surface.width, surface.height, frame.distance, space.origin, {
            ...HULL_TRAILS, intensity: trailViewIntensity(frame.distance),
        });
    }
    function encodeDebug(pass, frame) {
        if (!frame.sceneOpen)
            return;
        directed?.encodeDensity?.(pass, coordinates.system.viewProj, frame.focusedBodyIndex);
    }
    return { prepare, integrate, prepareVisibility, encodeStrategicTrails, encodeShips, encodeModels, encodeDebug };
}
//# sourceMappingURL=frame-encoding.js.map