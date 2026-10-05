import { localOrderFleet, nextLocalOrderRevision, holdLocalItinerary } from './local-order.js';
export function acceptPlanetOrbit(world, payload, now) {
    const fleet = localOrderFleet(world, payload?.id, payload?.node);
    if (!fleet || !validPlanet(payload) || !Number.isFinite(now))
        return null;
    const previous = fleet.state.state === 'awaiting' ? fleet.state.orbit : undefined;
    // Repeating the same order must not restart its route/capture or deadline.
    if (previous?.bodyIndex === payload.bodyIndex && previous.catalogId === payload.catalogId)
        return null;
    const orbit = { bodyIndex: payload.bodyIndex, catalogId: payload.catalogId,
        revision: nextLocalOrderRevision(fleet), startTime: now };
    fleet.state = { state: 'awaiting', node: { ...fleet.currentNode }, orbit };
    holdLocalItinerary(fleet);
    return fleet;
}
function validPlanet(payload) {
    return Number.isInteger(payload.bodyIndex) && payload.bodyIndex > 0 && payload.bodyIndex < 16
        && typeof payload.catalogId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(payload.catalogId)
        && payload.catalogId !== 'sol';
}
//# sourceMappingURL=orbit-planet.js.map