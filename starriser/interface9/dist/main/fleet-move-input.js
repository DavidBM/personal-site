import { renderPointerRay } from './render-picking.js';
/** UI availability only. The fleet authority validates every submitted order again. */
export function canMoveSceneFleet(snapshot, state) {
    const node = snapshot?.sceneNode;
    return snapshot?.systemId != null && node != null && state != null && state.state !== 'jumping'
        && state.node.clusterId === node.clusterId && state.node.solarSystemId === node.solarSystemId;
}
/** Intersect the sun's XZ plane using the input snapshot, then convert once to sun-local doubles. */
export function sceneMoveDestination(snapshot, x, y) {
    const sun = snapshot.bodies.find(body => body.isSun);
    if (!sun || snapshot.systemId == null || !Number.isFinite(x) || !Number.isFinite(y))
        return null;
    const ray = renderPointerRay(snapshot.camera, x, y);
    if (Math.abs(ray.direction.y) < 1e-10)
        return null;
    const t = (sun.y - ray.origin.y) / ray.direction.y;
    if (!Number.isFinite(t) || t < 0)
        return null;
    // Subtract the galaxy anchor before adding the ray displacement to preserve small local distances.
    const destination = { x: ray.origin.x - sun.x + t * ray.direction.x, y: 0,
        z: ray.origin.z - sun.z + t * ray.direction.z };
    return Number.isFinite(destination.x) && Number.isFinite(destination.z) ? destination : null;
}
export function matchesFleetMoveScene(snapshot, move) {
    return snapshot?.systemId === move.systemId && snapshot.sceneNode?.clusterId === move.node.clusterId
        && snapshot.sceneNode.solarSystemId === move.node.solarSystemId;
}
export function fleetMoveRejection(move, state) {
    if (!validFleetMoveDestination(move.destination))
        return 'Choose empty space closer to the sun';
    if (!move.append)
        return null;
    if (!state || state.state !== 'awaiting')
        return null;
    const prior = state.localMove;
    if (!prior)
        return null;
    if (prior.closed)
        return 'Patrol is closed · RMB starts a new path';
    if (move.close)
        return null;
    if (prior.waypoints && prior.waypoints.length >= 32)
        return 'Path limit: 32 waypoints · RMB starts a new path';
    return null;
}
export function fleetMoveNotice(move) {
    return move.close ? 'Looping patrol requested' : move.append ? 'Waypoint requested' : 'Move order requested';
}
function validFleetMoveDestination(point) {
    return point != null && [point.x, point.y, point.z].every(v => Number.isFinite(v) && Math.abs(v) <= 100);
}
//# sourceMappingURL=fleet-move-input.js.map