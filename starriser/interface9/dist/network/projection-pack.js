import { opaqueIdAt } from '../contracts/opaque-id.js';
function allocate(count, removed) {
    const buffer = new ArrayBuffer(count * 73 + removed.length * 16);
    return {
        ids: new Uint8Array(buffer, 0, count * 16), revisions: new BigUint64Array(buffer, count * 16, count),
        positions: new Float64Array(buffer, count * 24, count * 2), targets: new Float64Array(buffer, count * 40, count * 2),
        times: new BigUint64Array(buffer, count * 56, count * 2), moving: new Uint8Array(buffer, count * 72, count),
        removedIds: new Uint8Array(buffer, count * 73, removed.length * 16),
    };
}
function packRows(fleets, removed) {
    const columns = allocate(fleets.length, removed);
    for (let i = 0; i < fleets.length; i++) {
        const fleet = fleets[i];
        const from = fleet.movement?.from ?? fleet.position;
        const target = fleet.movement?.to ?? fleet.position;
        columns.ids.set(fleet.fleetId, i * 16);
        columns.revisions[i] = fleet.revision;
        columns.positions.set([from.x, from.z], i * 2);
        columns.targets.set([target.x, target.z], i * 2);
        if (fleet.movement) {
            columns.times[i * 2] = fleet.movement.departureServerMs;
            columns.times[i * 2 + 1] = fleet.movement.arrivalServerMs;
            columns.moving[i] = 1;
        }
    }
    for (let i = 0; i < removed.length; i++)
        columns.removedIds.set(removed[i], i * 16);
    return columns;
}
function metadata(scope, cursor) {
    return {
        layoutVersion: 1,
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