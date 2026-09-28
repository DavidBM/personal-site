/** Screen-space lens and near-hull protection, using the same camera as rendering. */
export function writeWarpView(data, sample, coordinates, width, height, strength, timeSec) {
    const m = coordinates.system.viewProj, p = coordinates.sceneClip();
    const w = m[3] * sample.x + m[7] * sample.y + m[11] * sample.z + m[15];
    if (!(w > 0) || !Number.isFinite(w))
        return false;
    const x = (m[0] * sample.x + m[4] * sample.y + m[8] * sample.z + m[12]) / w * .5 + .5;
    const y = .5 - (m[1] * sample.x + m[5] * sample.y + m[9] * sample.z + m[13]) / w * .5;
    const radius = Math.max(0, sample.hullRadius), screenRadius = radius * Math.abs(p[5]) / w * .5;
    data.set([width, height, 1 / width, 1 / height, x, y, strength, timeSec % 4096,
        x, y, screenRadius, w + radius * 4, p[10], p[14], width / height, 0]);
    return data.every(Number.isFinite);
}
//# sourceMappingURL=warp-view.js.map