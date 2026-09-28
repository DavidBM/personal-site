import { KEPLER_SCALE } from './solar-system-lod.js';
import { compactBodySunLocal } from './system-scene/frame.js';
import { keplerOrbitLocalF32 } from './math/world-origin.js';
import { orbitPhaseAt, SOLAR_ORBIT_SPEED_SCALE } from './planet-lib/solar-bodies.js';
function keplerAxes(catalogId) {
    const u = keplerOrbitLocalF32(1, 1, 0, catalogId);
    const v = keplerOrbitLocalF32(1, 1, Math.PI * 0.5, catalogId);
    return { u: [u.x, u.y, u.z], v: [v.x, v.y, v.z] };
}
function keplerLocalPose(store, index, timeSec) {
    const local = compactBodySunLocal(store, index, timeSec);
    return { x: local?.x ?? 0, y: local?.y ?? 0, z: local?.z ?? 0 };
}
function keplerBodyRecord(store, index, timeSec) {
    const isSun = !!store.isSun[index];
    const period = store.orbitPeriod[index] || 1;
    const axes = keplerAxes(store.catalogIds[index]);
    const pose = keplerLocalPose(store, index, timeSec);
    if (isSun) {
        return { ...pose, radius: store.radius[index] ?? 0, isSun, orbitRadius: 0, rate: 0, phase: 0, uAxis: axes.u, vAxis: axes.v };
    }
    return {
        ...pose,
        radius: store.radius[index] ?? 0,
        isSun,
        orbitRadius: (store.orbitRadius[index] || 0) * KEPLER_SCALE,
        rate: (SOLAR_ORBIT_SPEED_SCALE / Math.max(1e-6, period)) * Math.PI * 2,
        phase: orbitPhaseAt(store.phase0[index], period, timeSec),
        uAxis: axes.u,
        vAxis: axes.v,
    };
}
export function keplerBodiesForStore(store, timeSec) {
    const n = Math.min(store.currentCount, 16);
    const bodies = [];
    for (let i = 0; i < n; i++)
        bodies.push(keplerBodyRecord(store, i, timeSec));
    return bodies;
}
//# sourceMappingURL=compact-ephemeris.js.map