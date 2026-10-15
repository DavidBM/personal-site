const GALAXY_FADE_SKIP = 0.02;
export function createGalaxyEncoding(topology, lines, points, coordinates, survey, routes) {
    let topologyEncoded = false;
    function encodeLines(pass, frame) {
        const { galaxy, projection } = coordinates;
        survey.encodeBackground(pass, frame);
        topologyEncoded = frame.strategicVisible && frame.galaxyFade >= 1;
        if (topologyEncoded)
            lines.encode(pass, galaxy.view, projection, galaxy.origin);
        if (frame.strategicVisible && frame.galaxyFade >= GALAXY_FADE_SKIP)
            routes?.encode(pass, galaxy.viewProj, galaxy.origin, frame.cssWidth, frame.cssHeight, survey.reducedMotion ? 0 : frame.timeSec);
    }
    function encodePoints(pass, frame) {
        const { galaxy, cameraRight, cameraUp } = coordinates;
        if (frame.strategicVisible && frame.galaxyFade >= GALAXY_FADE_SKIP)
            points.encode(pass, galaxy.viewProj, topology.pointWorldScale, topology.store.currentCount, cameraRight, cameraUp, galaxy.origin, frame.galaxyFade);
        if (frame.strategicVisible && frame.galaxyFade >= GALAXY_FADE_SKIP)
            survey.encode(pass);
    }
    return { encodeHud: (encoder, target) => survey.encodeHud(encoder, target), prepare: (frame) => survey.prepare(frame), encode: (pass, frame) => { encodeLines(pass, frame); encodePoints(pass, frame); }, encodeLines, encodePoints, wasTopologyEncoded: () => topologyEncoded };
}
//# sourceMappingURL=galaxy-encoding.js.map