export function clusterPayloadToData(payload) {
    return {
        id: payload.id,
        name: payload.name,
        position: copyGalaxyDataPosition(payload.position),
        radius: payload.radius,
        color: normalizeGalaxyDataClusterColor(payload.color),
        maxSystemDistance: payload.maxSystemDistance,
        connectedTo: payload.connectedTo.slice(),
        solarSystems: payload.solarSystems.map((sys) => solarSystemPayloadToData(sys)),
    };
}
export function solarSystemPayloadToData(payload) {
    return {
        id: payload.id,
        name: payload.name,
        position: copyGalaxyDataPosition(payload.position),
        isJumpGate: payload.isJumpGate ?? false,
        connections: payload.connections?.slice() ?? [],
        connectedToClusterId: payload.connectedToClusterId ?? null,
    };
}
export function normalizeGalaxyDataClusterColor(color) {
    if (typeof color === "number") {
        return color;
    }
    if (Array.isArray(color)) {
        return [color[0], color[1], color[2]];
    }
    const maybeColor = color;
    if (typeof maybeColor.r === "number" &&
        typeof maybeColor.g === "number" &&
        typeof maybeColor.b === "number") {
        return [maybeColor.r, maybeColor.g, maybeColor.b];
    }
    return 0xffffff;
}
export function copyGalaxyDataPosition(position) {
    return {
        x: position.x,
        y: position.y,
        z: position.z,
    };
}
//# sourceMappingURL=galaxy-data-adapters.js.map