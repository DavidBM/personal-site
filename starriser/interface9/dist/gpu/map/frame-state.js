/** One mutable frame record, reused by the fixed map pass sequence. */
export function createMapFrameState() {
    return {
        referenceModelVisibility: false, referenceTrailVisibility: false,
        sceneOpen: false, anyScene: false, following: false, keplerEncode: false,
        distance: 1, tanHalfFov: 1, cssHeight: 1, fovyDeg: 45,
        eyeX: 0, eyeY: 1, eyeZ: 0, targetX: 0, targetZ: 0,
        galaxyFade: 1, focusedBodyIndex: null,
        nowMs: 0, dtMs: 16, timeSec: 0, fleetHighWater: 0, shipHighWater: 0,
        modelIndices: [], bandC: false,
    };
}
//# sourceMappingURL=frame-state.js.map