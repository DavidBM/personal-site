export const MAX_FLEET_WAYPOINTS = 32;
function validDestination(point) {
    return Boolean(point && [point.x, point.y, point.z].every(value => Number.isFinite(value) && Math.abs(value) <= 100));
}
function nextRevision(fleet) {
    return (fleet.state.state === 'awaiting' ? fleet.state.localMove?.revision ?? 0 : 0) + 1;
}
function moveIntent(fleet, payload) {
    const previous = fleet.state.state === 'awaiting' ? fleet.state.localMove : undefined;
    const revision = nextRevision(fleet);
    if (!payload.append || !previous) {
        if (payload.close)
            return null;
        return { revision, orderId: revision, destination: { ...payload.destination }, waypoints: [{ ...payload.destination }], closed: false };
    }
    const points = previous.waypoints ?? [previous.destination];
    if (!canExtend(previous.closed, points.length, payload.close))
        return null;
    return { revision, orderId: previous.orderId ?? previous.revision, destination: { ...payload.destination },
        waypoints: payload.close ? points.map(p => ({ ...p })) : [...points.map(p => ({ ...p })), { ...payload.destination }], closed: Boolean(payload.close) };
}
function canExtend(closed, count, close) {
    return !closed && (close ? count >= 3 : count < MAX_FLEET_WAYPOINTS);
}
/** Offline authority accepts intent; the renderer plans visual travel asynchronously. */
export function acceptLocalMove(world, payload) {
    const fleet = world.fleets.get(payload?.id);
    if (!fleet || fleet.state.state === "jumping")
        return null;
    if (fleet.state.state === "awaiting" && fleet.state.battle)
        return null;
    const { node, destination } = payload;
    if (!node || node.clusterId !== fleet.currentNode.clusterId || node.solarSystemId !== fleet.currentNode.solarSystemId)
        return null;
    if (!validDestination(destination))
        return null;
    const localMove = moveIntent(fleet, payload);
    if (!localMove)
        return null;
    fleet.state = { state: "awaiting", node: { ...fleet.currentNode }, localMove };
    // The player's local order replaces the automatic inter-system itinerary.
    fleet.destination = { ...fleet.currentNode };
    fleet.pendingEdges = [];
    fleet.intraPath = null;
    fleet.intraIndex = 0;
    return fleet;
}
//# sourceMappingURL=local-move.js.map