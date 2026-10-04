import { MAX_AUTHORED_SHIPS } from './contracts.js';
import { trySpawnParkedAt } from '../../lib/fleet-sim/domain/fleet-spawner.js';
import { fleetRelationship } from '../../contracts/fleet-relationship.js';
/** Validate the entire request before allocating an identity or publishing. */
export function createAuthoredFleet(world, request) {
    const c = request.classes, p = request.position, node = request.at;
    if (!node || !c || c.length !== 6 || !p)
        return null;
    if (!c.every(n => Number.isInteger(n) && n >= 0 && n <= MAX_AUTHORED_SHIPS))
        return null;
    const total = c.reduce((a, b) => a + b, 0);
    if (total < 1 || total > MAX_AUTHORED_SHIPS || ![p.x, p.y, p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 100))
        return null;
    const fleet = trySpawnParkedAt(world, node, () => .5);
    if (!fleet)
        return null;
    fleet.counts = { red: 0, blue: 0, green: total, classes: [...c] };
    fleet.relationship = fleetRelationship(request.relationship);
    fleet.state = { state: 'awaiting', node: { ...node }, position: { ...p }, localMove: { revision: 1, destination: { ...p } } };
    return fleet;
}
//# sourceMappingURL=create-fleet.js.map