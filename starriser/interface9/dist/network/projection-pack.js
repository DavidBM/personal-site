import { packFleetOrbits } from '../contracts/fleet-orbit.js';
import { packFleetAppearance } from './fleet-appearance.js';
import { opaqueIdAt } from '../contracts/opaque-id.js';
function allocate(count, removed) {
    const buffer = new ArrayBuffer(count * 117 + removed.length * 16);
    return {
        ids: new Uint8Array(buffer, 0, count * 16), revisions: new BigUint64Array(buffer, count * 16, count),
        positions: new Float64Array(buffer, count * 24, count * 3), targets: new Float64Array(buffer, count * 48, count * 3),
        times: new BigUint64Array(buffer, count * 72, count * 2), appearance: new Uint32Array(buffer, count * 88, count * 7), moving: new Uint8Array(buffer, count * 116, count),
        removedIds: new Uint8Array(buffer, count * 117, removed.length * 16),
    };
}
function packRows(fleets, removed) {
    const pathOffsets = new Uint32Array(fleets.length + 1);
    for (let i = 0; i < fleets.length; i++) {
        const n = fleets[i].movement?.via?.length ?? 0;
        if (n > 14)
            throw new Error('Authoritative route exceeds vertex bound');
        pathOffsets[i + 1] = pathOffsets[i] + n;
    }
    const pathPoints = new Float64Array(pathOffsets[fleets.length] * 3);
    const columns = { ...allocate(fleets.length, removed), pathOffsets, pathPoints, ...packFleetOrbits(fleets.map(f => f.orbit)) };
    for (let i = 0; i < fleets.length; i++) {
        const fleet = fleets[i];
        columns.moving[i] = fleet.controllable ? 2 : 0;
        packFleetAppearance(columns.appearance, i * 7, fleet.composition, fleet.appearance);
        const from = fleet.movement?.from ?? fleet.position;
        const target = fleet.movement?.to ?? fleet.position;
        columns.ids.set(fleet.fleetId, i * 16);
        columns.revisions[i] = fleet.revision;
        columns.positions.set([from.x, from.y, from.z], i * 3);
        columns.targets.set([target.x, target.y, target.z], i * 3);
        if (fleet.movement) {
            columns.times[i * 2] = fleet.movement.departureServerMs;
            columns.times[i * 2 + 1] = fleet.movement.arrivalServerMs;
            columns.moving[i] |= 1;
            fleet.movement.via?.forEach((point, j) => pathPoints.set([point.x, point.y, point.z], (pathOffsets[i] + j) * 3));
        }
    }
    for (let i = 0; i < removed.length; i++)
        columns.removedIds.set(removed[i], i * 16);
    return columns;
}
function metadata(scope, cursor) {
    return {
        layoutVersion: 6,
        scope: { worldId: opaqueIdAt(scope.worldId), shardId: opaqueIdAt(scope.shardId), systemId: opaqueIdAt(scope.systemId), ownerEpoch: scope.ownerEpoch, recoveryGeneration: scope.recoveryGeneration },
        subscriptionId: opaqueIdAt(cursor.subscriptionId), streamGeneration: cursor.generation, sequence: cursor.sequence,
    };
}
export function packSnapshot(chunk) {
    return { ...metadata(chunk.scope, chunk.cursor), ...packRows(chunk.fleets, []),
        baseSystemRevision: chunk.systemRevision, systemRevision: chunk.systemRevision,
        snapshot: { id: opaqueIdAt(chunk.snapshotId), index: chunk.chunkIndex, count: chunk.chunkCount } };
}
export function packDelta(delta) {
    return { ...metadata(delta.scope, delta.cursor), ...packRows(delta.upserts, delta.removedFleetIds),
        baseSystemRevision: delta.baseSystemRevision, systemRevision: delta.systemRevision };
}
//# sourceMappingURL=projection-pack.js.map