/** Preserve a JS-double position across a float32 GPU boundary. */
export function writeSplitPosition(target, highOffset, lowOffset, x, y, z) {
    target[highOffset] = Math.fround(x);
    target[highOffset + 1] = Math.fround(y);
    target[highOffset + 2] = Math.fround(z);
    target[lowOffset] = x - target[highOffset];
    target[lowOffset + 1] = y - target[highOffset + 1];
    target[lowOffset + 2] = z - target[highOffset + 2];
}
//# sourceMappingURL=split-position.js.map