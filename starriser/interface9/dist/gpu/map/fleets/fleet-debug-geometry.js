import { SCENE_LAB_SCALE as SCALE } from './directed-present.wgsl.js';
/** Actual measured pose/velocity and shared-shader evaluated steering cues. */
export function fleetDebugGeometry(slot, ships, center, travel) {
    const rows = [];
    const line = (a, b, color) => rows.push({ slot, points: [a, b], color, destination: b, status: 'debug' });
    if (center)
        cross(center, .0007, [1, 1, 1], line);
    // Shared route frame was copied with these ship samples. The independently
    // refreshed physical mean is a separate marker, never a dispersion baseline.
    const reference = travel?.count ? travel.center.map(v => v / SCALE) : null;
    for (const ship of ships) {
        const p = ship.position.map(v => v / SCALE);
        if (reference)
            line(p, reference, [.5, .5, .6]);
        const speed = Math.hypot(...ship.navigation);
        if (speed > 1e-8)
            line(p, p.map((v, i) => v + ship.navigation[i] / speed * ship.reach / SCALE), [1, .8, .2]);
        line(p, p.map((v, i) => v + ship.velocity[i] / SCALE * 2), [.2, 1, .55]);
        line(p, p.map((v, i) => v + ship.formation[i] / SCALE * 2), [.3, .75, 1]);
        line(p, p.map((v, i) => v + ship.avoidance[i] / SCALE), [1, .3, .35]);
        circle(p, ship.repelRadius / SCALE, [.55, .85, 1], line);
    }
    if (reference)
        cross(reference, .0009, [1, .3, 1], line);
    return rows;
}
function cross(p, r, color, line) {
    for (let axis = 0; axis < 3; axis++) {
        const a = [...p], b = [...p];
        a[axis] -= r;
        b[axis] += r;
        line(a, b, color);
    }
}
function circle(p, r, color, line) {
    for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2, b = (i + 1) / 24 * Math.PI * 2;
        line([p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r], [p[0] + Math.cos(b) * r, p[1], p[2] + Math.sin(b) * r], color);
    }
}
//# sourceMappingURL=fleet-debug-geometry.js.map