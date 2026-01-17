/**
 * Returns a random point in disk with given center (x, y, z), radius, and y-range [y, y+heightVar]
 */
export function randomPointInDisk(centerX, centerY, centerZ, radius, heightVar) {
    const r = Math.sqrt(Math.random()) * radius;
    const theta = Math.random() * Math.PI * 2;
    return {
        x: centerX + r * Math.cos(theta),
        y: centerY + Math.random() * heightVar,
        z: centerZ + r * Math.sin(theta),
    };
}
/**
 * Returns a random point in disk of given radius, y=[0, heightVar], centered at (0,0,0)
 */
export function randomPointInDisk_PositiveY(radius, heightVar) {
    return randomPointInDisk(0, 0, 0, radius, heightVar);
}
/**
 * Returns random point in cluster: xz at radius, y a bit above center
 */
export function randomPointInCluster_PositiveY(center, radius) {
    return randomPointInDisk(center.x, center.y, center.z, radius, 15);
}
/**
 * Returns a random cluster color (int)
 * @returns {number}
 */
export function randomClusterColor() {
    const colors = [
        0x3366ff, 0x33ccff, 0xff6633, 0xffcc33, 0x33ff66, 0xcc33ff, 0xff3366,
        0x66ff33, 0xffffff, 0x99ccff, 0xff99cc, 0xffff99,
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}
//# sourceMappingURL=galaxy-utils.js.map