import { serverTimeForPresentation, validateServerClock } from '../../contracts/server-clock.js';
/** Named wire-to-visual boundary. Subtract bigint epochs before f64 conversion;
 * offsets remain sun-local and never pass through galaxy-scale Float32 storage. */
export function remotePresentationPath(fleet, node, anchor, reference) {
    validateServerClock(anchor);
    const map = (time) => serverTimeForPresentation(time, anchor, reference.monotonicEpochMs, reference.wallMs) - reference.frameEpochMs;
    return { node, x: fleet.x, z: fleet.z, targetX: fleet.targetX, targetZ: fleet.targetZ, moving: fleet.moving,
        departureGpuMs: fleet.moving ? map(fleet.departureMs) : 0,
        arrivalGpuMs: fleet.moving ? map(fleet.arrivalMs) : 1 };
}
//# sourceMappingURL=presentation-clock.js.map