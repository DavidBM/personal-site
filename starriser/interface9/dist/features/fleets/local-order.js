/** Shared authority guard: orders replace the itinerary, never a live jump or battle. */
export function localOrderFleet(world, id, node) {
    const fleet = world.fleets.get(id);
    if (!fleet || fleet.state.state === 'jumping')
        return null;
    if (fleet.state.state === 'awaiting' && fleet.state.battle)
        return null;
    if (!node || node.clusterId !== fleet.currentNode.clusterId || node.solarSystemId !== fleet.currentNode.solarSystemId)
        return null;
    return fleet;
}
export function nextLocalOrderRevision(fleet) {
    if (fleet.state.state !== 'awaiting')
        return 1;
    return (fleet.state.localMove?.revision ?? fleet.state.orbit?.revision ?? 0) + 1;
}
export function holdLocalItinerary(fleet) {
    fleet.destination = { ...fleet.currentNode };
    fleet.pendingEdges = [];
    fleet.intraPath = null;
    fleet.intraIndex = 0;
}
//# sourceMappingURL=local-order.js.map