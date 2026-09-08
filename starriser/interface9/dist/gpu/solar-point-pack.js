import { writeSplitPosition } from '../math/split-position.js';
export const SOLAR_POINT_UNIFORM_BYTES = 144;
export const SOLAR_POINT_INSTANCE_FLOATS = 9;
const RIGHT = [1, 0, 0];
const UP = [0, 1, 0];
const ZERO = { x: 0, y: 0, z: 0 };
export function packSolarPointInstanceRange(store, target, startIndex, count) {
    const { positions, colors } = store;
    const end = Math.min(store.currentCount, startIndex + count);
    for (let index = Math.max(0, startIndex); index < end; index++) {
        const source = index * 3;
        const dest = index * SOLAR_POINT_INSTANCE_FLOATS;
        writeSplitPosition(target, dest, dest + 6, positions[source], positions[source + 1], positions[source + 2]);
        target[dest + 3] = colors[source];
        target[dest + 4] = colors[source + 1];
        target[dest + 5] = colors[source + 2];
    }
}
export function packSolarPointInstances(store, target) {
    packSolarPointInstanceRange(store, target, 0, store.currentCount);
}
function writeAxis(target, offset, axis, fallback) {
    target[offset] = axis[0] ?? fallback[0];
    target[offset + 1] = axis[1] ?? fallback[1];
    target[offset + 2] = axis[2] ?? fallback[2];
    target[offset + 3] = 0;
}
export function packSolarPointUniforms(target, viewProj, worldScale, right = RIGHT, up = UP, origin = ZERO, galaxyFade = 1) {
    target.set(viewProj, 0);
    target[16] = worldScale;
    target[17] = 0;
    target[18] = 0;
    target[19] = 0;
    writeAxis(target, 20, right, RIGHT);
    writeAxis(target, 24, up, UP);
    writeSplitPosition(target, 28, 32, origin.x, origin.y, origin.z);
    const fade = Number.isFinite(galaxyFade) ? galaxyFade : 1;
    target[31] = Math.max(0, Math.min(1, fade));
    target[35] = 0;
}
//# sourceMappingURL=solar-point-pack.js.map