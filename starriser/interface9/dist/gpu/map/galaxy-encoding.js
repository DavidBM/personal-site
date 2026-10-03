const GALAXY_FADE_SKIP = 0.02;
export function createGalaxyEncoding(topology, lines, points, coordinates, survey) {
    let topologyEncoded = false;
    function encodeLines(pass, frame) {
        const { galaxy, projection } = coordinates;
        survey.encodeBackground(pass, frame);
        topologyEncoded = frame.strategicVisible && frame.galaxyFade >= 1;
        if (topologyEncoded)
            lines.encode(pass, galaxy.view, projection, galaxy.origin);
    }
    function encodePoints(pass, frame) {
        const { galaxy, cameraRight, cameraUp } = coordinates;
        if (!frame.strategicVisible || frame.galaxyFade < GALAXY_FADE_SKIP)
            return;
        points.encode(pass, galaxy.viewProj, topology.pointWorldScale, topology.store.currentCount, cameraRight, cameraUp, galaxy.origin, frame.galaxyFade);
        survey.encode(pass);
    }
    return { prepare: (frame) => survey.prepare(frame), encode: (pass, frame) => { encodeLines(pass, frame); encodePoints(pass, frame); }, encodeLines, encodePoints, wasTopologyEncoded: () => topologyEncoded };
}
//# sourceMappingURL=galaxy-encoding.js.map