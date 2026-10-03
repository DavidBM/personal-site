/** Put the entire arena above intersecting orbital bands, not inside a planet.
 * This conservative event-time test reserves moving bodies' vertical envelope.
 * It is not a per-ship/per-tick obstacle solver. */
export function battleArena(target, radius, bodies) {
    const center = { x: target.x, y: target.y, z: target.z }, radial = Math.hypot(center.x, center.z);
    for (const b of bodies) {
        const clearance = radius + b.radius + .003;
        if (b.orbitRadius) {
            const tilt = Math.min(1, Math.hypot(b.uAxis?.[1] ?? 0, b.vAxis?.[1] ?? 0));
            const inner = b.orbitRadius * Math.sqrt(1 - tilt * tilt);
            if (radial < inner - clearance || radial > b.orbitRadius + clearance)
                continue;
            const vertical = b.orbitRadius * tilt;
            center.y = Math.max(center.y, vertical + clearance);
        }
        else {
            const d2 = (center.x - b.x) ** 2 + (center.z - b.z) ** 2;
            if (d2 < clearance ** 2)
                center.y = Math.max(center.y, b.y + Math.sqrt(clearance ** 2 - d2));
        }
    }
    return center;
}
//# sourceMappingURL=arena.js.map