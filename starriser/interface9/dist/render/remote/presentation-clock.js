import { serverTimeForPresentation, validateServerClock } from '../../contracts/server-clock.js';
/** Named wire-to-visual boundary. Subtract bigint epochs before f64 conversion;
 * offsets remain sun-local and never pass through galaxy-scale Float32 storage. */
export function remotePresentationPath(fleet, node, anchor, reference) {
    validateServerClock(anchor);
    const map = (time) => serverTimeForPresentation(time, anchor, reference.monotonicEpochMs, reference.wallMs) - reference.frameEpochMs;
    return { node, orbit: presentationOrbit(fleet.orbit, anchor.serverMs, map), persistentId: fleet.id, revision: fleet.revision, via: fleet.via, appearance: fleet.appearance, relationship: fleet.relationship, x: fleet.x, y: fleet.y, z: fleet.z, targetX: fleet.targetX, targetY: fleet.targetY, targetZ: fleet.targetZ, moving: fleet.moving,
        departureGpuMs: fleet.moving ? map(fleet.departureMs) : 0,
        arrivalGpuMs: fleet.moving ? map(fleet.arrivalMs) : 1 };
}
function presentationOrbit(orbit, now, map) {
    if (!orbit)
        return;
    // Rebase once on admission/update. A Unix-sized epoch in a GPU f32 freezes
    // orbital time for minutes; the body and fleet ring need independent phases.
    const epoch = now > orbit.epochMs ? now : orbit.epochMs, elapsed = epoch - orbit.epochMs;
    const body = orbit.body.slice(), tau = Math.PI * 2, wrap = (a) => (a % tau + tau) % tau;
    const ringPhase = wrap((orbit.phase ?? body[3]) + Number(elapsed % orbit.periodMs) / Number(orbit.periodMs) * tau);
    body[3] = wrap(body[3] + (Number(elapsed) / 1000 % body[2]) / body[2] * tau);
    return { bodyIndex: orbit.bodyIndex, epochGpuMs: map(epoch), periodMs: Number(orbit.periodMs), radius: orbit.radius, body, ringPhase };
}
//# sourceMappingURL=presentation-clock.js.map