export const DEFAULT_CONNECTION_OVERLAY_COLOR = [
    1,
    0,
    0.2,
];
export function buildGalaxyRenderConnectionOverlayState(connectionColors) {
    const selectedConnectionKeys = [];
    const overlayConnectionColors = {};
    if (connectionColors) {
        for (const key of Object.keys(connectionColors)) {
            selectedConnectionKeys.push(key);
            overlayConnectionColors[key] = connectionColors[key];
        }
    }
    return {
        selectedConnectionKeys,
        overlayConnectionColors,
    };
}
export function collectGalaxyRenderConnectionOverlayLines({ selectedConnectionKeys, overlayConnectionColors, positions, keyToIndex, }) {
    if (!selectedConnectionKeys || selectedConnectionKeys.length === 0) {
        return [];
    }
    const lines = [];
    const colors = overlayConnectionColors ?? {};
    for (const key of selectedConnectionKeys) {
        const slot = keyToIndex.get(key);
        if (typeof slot !== "number")
            continue;
        const offset = slot * 2 * 3;
        const p1 = {
            x: positions[offset + 0],
            y: positions[offset + 1],
            z: positions[offset + 2],
        };
        const p2 = {
            x: positions[offset + 3],
            y: positions[offset + 4],
            z: positions[offset + 5],
        };
        if (!isRenderableConnectionOverlaySegment(p1, p2))
            continue;
        lines.push({
            key,
            slot,
            p1,
            p2,
            color: normalizeConnectionOverlayColor(colors[key]),
        });
    }
    return lines;
}
export function normalizeConnectionOverlayColor(color) {
    if (typeof color === "number") {
        return [
            ((color >> 16) & 0xff) / 255,
            ((color >> 8) & 0xff) / 255,
            (color & 0xff) / 255,
        ];
    }
    if (Array.isArray(color))
        return color;
    return DEFAULT_CONNECTION_OVERLAY_COLOR;
}
function isRenderableConnectionOverlaySegment(p1, p2) {
    if (Number.isNaN(p1.x) ||
        Number.isNaN(p1.y) ||
        Number.isNaN(p1.z) ||
        Number.isNaN(p2.x) ||
        Number.isNaN(p2.y) ||
        Number.isNaN(p2.z)) {
        return false;
    }
    return p1.x !== p2.x || p1.y !== p2.y || p1.z !== p2.z;
}
//# sourceMappingURL=galaxy-render-connection-overlays.js.map