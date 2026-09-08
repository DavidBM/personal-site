const STRATEGIC_TRAILS = { depthAware: true, sceneTrailScale: true };
const MODEL_TRAILS = { depthAware: true, sceneTrailScale: true };
export function createFleetFrameEncoding(ships, models, coordinates, surface) {
    const camera = {
        cameraY: 1, targetX: 0, targetZ: 0, viewportH: 1, tanHalfFov: 1, originX: 0, originY: 0, originZ: 0,
    };
    const options = { anyScene: false, follow: false, systemSceneActive: false, hideNonSceneDraw: false };
    function prepare(frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        camera.cameraY = frame.distance;
        camera.viewportH = frame.cssHeight;
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
    }
    function integrate(encoder, frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        ships.prepareTrailVisibility(space.viewProj, space.view, frame.sceneOpen && !frame.referenceTrailVisibility, true, coordinates.projection, surface.height);
        ships.dispatchIntegrate(encoder, frame.nowMs, frame.dtMs, frame.fleetHighWater, frame.shipHighWater, camera, options);
    }
    function prepareVisibility(encoder, frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        models.prepareVisibility(encoder, space.viewProj, space.origin, frame.referenceModelVisibility);
    }
    function encodeStrategicTrails(pass, frame) {
        if (!frame.sceneOpen || frame.modelIndices.length > 0)
            return;
        const space = coordinates.system;
        ships.encodeTrails(pass, space.view, coordinates.projection, surface.width, surface.height, frame.distance, space.origin, STRATEGIC_TRAILS);
    }
    function encodeShips(pass, frame) {
        const space = frame.sceneOpen ? coordinates.system : coordinates.galaxy;
        ships.encode(pass, space.viewProj, 0.95, camera, frame.sceneOpen);
    }
    function encodeModels(pass, frame) {
        if (!frame.sceneOpen || frame.modelIndices.length === 0)
            return;
        const space = coordinates.system;
        // Rim eye and ShipSim/pathEnd are sun-local. GPU origin remains zero.
        models.encode(pass, space.viewProj, undefined, space.origin, space.eye, frame.timeSec);
        // Opaque hulls write depth before the depth-tested, non-writing pot trails.
        ships.encodeTrails(pass, space.view, coordinates.projection, surface.width, surface.height, frame.distance, space.origin, MODEL_TRAILS);
    }
    return { prepare, integrate, prepareVisibility, encodeStrategicTrails, encodeShips, encodeModels };
}
//# sourceMappingURL=frame-encoding.js.map