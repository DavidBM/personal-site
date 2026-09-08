import { serverTimeForPresentation, validateServerClock } from '../../contracts/server-clock.js';
/** Named wire-to-visual boundary. Subtract bigint epochs before f64 conversion;
 * offsets remain sun-local and never pass through galaxy-scale Float32 storage. */
export function remotePresentationPath(ship, node, anchor, reference) {
    validateServerClock(anchor);
    const map = (time) => serverTimeForPresentation(time, anchor, reference.monotonicEpochMs, reference.wallMs) - reference.frameEpochMs;
    return { node, x: ship.x, z: ship.z, targetX: ship.targetX, targetZ: ship.targetZ, moving: ship.moving,
        departureGpuMs: ship.moving ? map(ship.departureMs) : 0,
        arrivalGpuMs: ship.moving ? map(ship.arrivalMs) : 1 };
}
//# sourceMappingURL=presentation-clock.js.map