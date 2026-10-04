/** The encounter reference is a contact location, not an empty sphere reserved
 * above every orbital band. Shared flight corridors own swept-path clearance. */
export function battleArena(target, padding, bodies) {
    const center = { ...target };
    for (let pass = 0; pass < 3; pass++)
        for (const b of bodies) {
            const dx = center.x - b.x, dy = center.y - b.y, dz = center.z - b.z, d = Math.hypot(dx, dy, dz), r = b.radius + padding;
            if (d >= r)
                continue;
            const k = r / Math.max(d, 1e-12);
            if (d < 1e-12)
                center.x = b.x + r;
            else {
                center.x = b.x + dx * k;
                center.y = b.y + dy * k;
                center.z = b.z + dz * k;
            }
        }
    return center;
}
//# sourceMappingURL=arena.js.map