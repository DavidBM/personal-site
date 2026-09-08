/** Optional split-position upload; the default overlay layout stays unchanged. */
import { packSegmentPositions, polylineToSegments } from './line-geometry.js';
import { writeSplitPosition } from '../../math/split-position.js';
export function linePositionSegments(positions, polyline, splitPosition) {
    if (!splitPosition)
        return polyline ? polylineToSegments(positions) : packSegmentPositions(positions);
    if (!polyline) {
        if (positions.length % 6 !== 0)
            throw new Error('Line2 positions must contain xyz segment pairs');
        return positions;
    }
    if (positions.length < 3 || positions.length % 3 !== 0)
        throw new Error('Line2 polyline must contain xyz triples');
    const pairs = new Float64Array(Math.max(0, positions.length - 3) * 2);
    for (let i = 0; i < positions.length - 3; i += 3) {
        for (let axis = 0; axis < 6; axis++)
            pairs[i * 2 + axis] = positions[i + axis];
    }
    return pairs;
}
/** One existing position buffer: high start/end followed by low start/end. */
export function packSplitLinePositions(positions, scratch) {
    const length = positions.length * 2;
    const target = scratch.length >= length ? scratch : new Float32Array(length);
    for (let i = 0; i < positions.length; i += 6) {
        const out = i * 2;
        writeSplitPosition(target, out, out + 6, positions[i], positions[i + 1], positions[i + 2]);
        writeSplitPosition(target, out + 3, out + 9, positions[i + 3], positions[i + 4], positions[i + 5]);
    }
    return target;
}
//# sourceMappingURL=line-position-pack.js.map