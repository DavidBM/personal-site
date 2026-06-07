const BASE_SHIP_SIZE = 2.4;
const SHIP_SPREAD = 26;
const RED_SCALE = 20;
const BLUE_SCALE = 3;
const GREEN_SCALE = 1;
function pickTriangle(size, centerOffset, rotation) {
    const a = rotation;
    const b = rotation + (Math.PI * 2) / 3;
    const c = rotation + (Math.PI * 4) / 3;
    const scale = size;
    const ax = Math.cos(a) * scale + centerOffset.x;
    const az = Math.sin(a) * scale + centerOffset.z;
    const bx = Math.cos(b) * scale + centerOffset.x;
    const bz = Math.sin(b) * scale + centerOffset.z;
    const cx = Math.cos(c) * scale + centerOffset.x;
    const cz = Math.sin(c) * scale + centerOffset.z;
    const y = centerOffset.y;
    return [ax, y, az, bx, y, bz, cx, y, cz];
}
function writeFleetShips(counts, writeShip) {
    const writeScaledShips = (count, scale, color) => {
        for (let i = 0; i < count; i++) {
            const centerOffset = {
                x: (Math.random() - 0.5) * SHIP_SPREAD * scale,
                y: 0,
                z: (Math.random() - 0.5) * SHIP_SPREAD * scale,
            };
            const rotation = Math.random() * Math.PI * 2;
            const size = BASE_SHIP_SIZE * scale * (0.6 + Math.random() * 0.4);
            writeShip(color, centerOffset, rotation, size);
        }
    };
    writeScaledShips(counts.red, RED_SCALE, [1.0, 0.2, 0.2]);
    writeScaledShips(counts.blue, BLUE_SCALE, [0.2, 0.6, 1.0]);
    writeScaledShips(counts.green, GREEN_SCALE, [0.2, 1.0, 0.4]);
}
export function buildFleetGeometry(counts) {
    const totalShips = counts.red + counts.blue + counts.green;
    const vertexCount = totalShips * 3;
    const offsets = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    let cursor = 0;
    writeFleetShips(counts, (color, centerOffset, rotation, size) => {
        const tri = pickTriangle(size, centerOffset, rotation);
        for (let i = 0; i < 9; i += 3) {
            offsets[cursor] = tri[i];
            offsets[cursor + 1] = tri[i + 1];
            offsets[cursor + 2] = tri[i + 2];
            colors[cursor] = color[0];
            colors[cursor + 1] = color[1];
            colors[cursor + 2] = color[2];
            cursor += 3;
        }
    });
    return { offsets, colors, vertexCount };
}
export function buildFleetVisualGeometry(counts) {
    const totalShips = counts.red + counts.blue + counts.green;
    const vertexCount = totalShips * 3;
    const offsets = new Float32Array(vertexCount * 3);
    const vertexColors = new Float32Array(vertexCount * 3);
    const centers = new Float32Array(totalShips * 3);
    const rotations = new Float32Array(totalShips);
    const sizes = new Float32Array(totalShips);
    const instanceColors = new Float32Array(totalShips * 3);
    let vertexCursor = 0;
    let instanceCursor = 0;
    writeFleetShips(counts, (color, centerOffset, rotation, size) => {
        const instanceVectorCursor = instanceCursor * 3;
        centers[instanceVectorCursor] = centerOffset.x;
        centers[instanceVectorCursor + 1] = centerOffset.y;
        centers[instanceVectorCursor + 2] = centerOffset.z;
        rotations[instanceCursor] = rotation;
        sizes[instanceCursor] = size;
        instanceColors[instanceVectorCursor] = color[0];
        instanceColors[instanceVectorCursor + 1] = color[1];
        instanceColors[instanceVectorCursor + 2] = color[2];
        instanceCursor += 1;
        const tri = pickTriangle(size, centerOffset, rotation);
        for (let i = 0; i < 9; i += 3) {
            offsets[vertexCursor] = tri[i];
            offsets[vertexCursor + 1] = tri[i + 1];
            offsets[vertexCursor + 2] = tri[i + 2];
            vertexColors[vertexCursor] = color[0];
            vertexColors[vertexCursor + 1] = color[1];
            vertexColors[vertexCursor + 2] = color[2];
            vertexCursor += 3;
        }
    });
    return {
        offsets,
        vertexColors,
        vertexCount,
        centers,
        rotations,
        sizes,
        instanceCount: totalShips,
        instanceColors,
    };
}
export function scaleFleetCounts(counts, scale) {
    return {
        red: Math.max(0, Math.floor(counts.red * scale)),
        blue: Math.max(0, Math.floor(counts.blue * scale)),
        green: Math.max(0, Math.floor(counts.green * scale)),
    };
}
//# sourceMappingURL=fleet-geometry.js.map