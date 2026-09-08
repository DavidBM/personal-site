const GALAXY_FADE_SKIP = 0.02;
export function createGalaxyEncoding(topology, lines, points, impostors, coordinates) {
    let topologyEncoded = false;
    function encode(pass, frame) {
        const { galaxy, projection, cameraRight, cameraUp } = coordinates;
        topologyEncoded = frame.galaxyFade >= 1;
        if (topologyEncoded)
            lines.encode(pass, galaxy.view, projection, galaxy.origin);
        if (frame.galaxyFade < GALAXY_FADE_SKIP)
            return;
        points.encode(pass, galaxy.viewProj, topology.pointWorldScale, topology.store.currentCount, cameraRight, cameraUp, galaxy.origin, frame.galaxyFade);
        impostors.encode(pass, galaxy.viewProj, topology.pointWorldScale, topology.impostorStore.currentCount, cameraRight, cameraUp, galaxy.origin, frame.galaxyFade);
    }
    return { encode, wasTopologyEncoded: () => topologyEncoded };
}
//# sourceMappingURL=galaxy-encoding.js.map