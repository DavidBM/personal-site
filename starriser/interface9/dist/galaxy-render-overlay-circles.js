export function buildGalaxyRenderCirclePositions({ radius = 1, segments = 96, closed = false, } = {}) {
    const safeSegments = Math.max(3, Math.floor(segments));
    const positions = [];
    for (let index = 0; index < safeSegments; index += 1) {
        const theta = (index / safeSegments) * Math.PI * 2;
        positions.push(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
    }
    if (closed) {
        positions.push(positions[0], positions[1], positions[2]);
    }
    return positions;
}
export function getGalaxyRenderOverlayCircleStyle(type, scale = 1) {
    if (type === "hover") {
        return {
            color: 0xffe81f,
            linewidth: 2 * scale,
            opacity: 0.72,
            renderOrder: 5000,
        };
    }
    if (type === "select") {
        return {
            color: 0xff3c3c,
            linewidth: 4 * scale,
            opacity: 0.72,
            renderOrder: 5000,
        };
    }
    return {
        color: 0x21c441,
        linewidth: 9 * scale,
        opacity: 0.72,
        renderOrder: 5000,
    };
}
//# sourceMappingURL=galaxy-render-overlay-circles.js.map