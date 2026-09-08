import { createPassSetFlags, fillPassSetFlags, hashPassSet, solarStoreHasDisc, solarStoreHasSun } from "../pass-set.js";
export function createSolarScenePresentation(layer, store, residency, coordinates) {
    const flags = createPassSetFlags();
    const options = {
        store, residency, viewProjRel: coordinates.galaxy.viewProj, frameOrigin: coordinates.galaxy.origin,
        eyeX: 0, eyeY: 1, eyeZ: 0, cameraRight: coordinates.cameraRight, cameraUp: coordinates.cameraUp,
        viewportH: 1, fovyDeg: 45, timeSec: 0, focusedBodyIndex: null, bandC: false,
    };
    let hash = 0;
    function prepare(frame, height) {
        frame.bandC = isFocusedPlanet(store, frame.focusedBodyIndex);
        options.viewProjRel = frame.sceneOpen ? coordinates.system.viewProj : coordinates.galaxy.viewProj;
        options.frameOrigin = frame.sceneOpen ? coordinates.system.anchor : coordinates.galaxy.origin;
        options.eyeX = frame.eyeX;
        options.eyeY = frame.eyeY;
        options.eyeZ = frame.eyeZ;
        options.viewportH = height;
        options.fovyDeg = frame.fovyDeg;
        options.timeSec = frame.timeSec;
        options.focusedBodyIndex = frame.focusedBodyIndex;
        options.bandC = frame.bandC;
        layer.prepare(options);
        updatePassSet(frame);
    }
    function updatePassSet(frame) {
        const discs = frame.keplerEncode && solarStoreHasDisc(store.isSun, store.currentCount);
        const sun = frame.keplerEncode && solarStoreHasSun(store.isSun, store.currentCount);
        const atmosphere = discs || (frame.keplerEncode && frame.bandC);
        fillPassSetFlags(flags, discs, sun, atmosphere, frame.modelIndices.length > 0, frame.following);
        hash = hashPassSet(flags);
    }
    function encodeColor(pass) {
        if (flags.discs || flags.sun)
            layer.encode(pass);
        else
            layer.clearLastDrawCount();
    }
    function encodeDepth(pass) {
        if (flags.discs || flags.sun)
            layer.encodeDepth(pass);
    }
    function encodeAtmosphere(pass) {
        if (flags.discs)
            layer.encodeAtmosphere(pass);
    }
    return { prepare, encodeColor, encodeDepth, encodeAtmosphere, flags, getHash: () => hash };
}
function isFocusedPlanet(store, index) {
    return index != null && index >= 0 && store.currentCount > 0 && store.isSun[index] !== 1;
}
//# sourceMappingURL=solar-scene-presentation.js.map