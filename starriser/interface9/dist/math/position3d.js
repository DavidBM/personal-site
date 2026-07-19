/** Copy x/y/z into a plain Position3D (never shares references with callers). */
export function copyPosition3D(src) {
    return { x: src.x, y: src.y, z: src.z };
}
/** Mutate `target` to match `src` (in-place; avoids allocation in hot paths). */
export function setPosition3D(target, src) {
    target.x = src.x;
    target.y = src.y;
    target.z = src.z;
}
export function setPosition3Dxyz(target, x, y, z) {
    target.x = x;
    target.y = y;
    target.z = z;
}
//# sourceMappingURL=position3d.js.map