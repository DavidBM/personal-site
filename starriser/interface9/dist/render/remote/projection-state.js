import { isOpaqueId, opaqueIdAt } from "../../contracts/opaque-id.js";
import { bufferBytes, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_ENTITIES, projectionBuffers } from "./contracts.js";
export function copyWatermark(value) {
    return { ...value, scope: { ...value.scope } };
}
function u64(value, allowZero = false) {
    return typeof value === "bigint" && value >= (allowZero ? 0n : 1n) && value <= 0xffffffffffffffffn;
}
export function validateProjectionHeader(batch, expected) {
    const scope = batch.scope;
    if (!scope || scope.worldId !== expected.worldId || scope.systemId !== expected.systemId
        || batch.subscriptionId !== expected.subscriptionId || !isOpaqueId(scope.shardId))
        throw new Error("Projection identity mismatch");
    if (![scope.ownerEpoch, scope.recoveryGeneration, batch.streamGeneration, batch.systemRevision].every(value => u64(value))
        || !u64(batch.sequence, true) || !u64(batch.baseSystemRevision, true))
        throw new Error("Invalid projection watermark");
}
export function watermark(batch) {
    return { scope: { ...batch.scope }, subscriptionId: batch.subscriptionId,
        streamGeneration: batch.streamGeneration, sequence: batch.sequence, systemRevision: batch.systemRevision };
}
export function sameScope(a, b) {
    return a.worldId === b.worldId && a.shardId === b.shardId && a.systemId === b.systemId
        && a.ownerEpoch === b.ownerEpoch && a.recoveryGeneration === b.recoveryGeneration;
}
export function readProjectionChanges(batch) {
    projectionBuffers(batch);
    const seen = new Set();
    const upserts = [];
    const removed = [];
    for (let i = 0; i < batch.revisions.length; i++) {
        const ship = readShip(batch, i);
        if (seen.has(ship.id))
            throw new Error("Duplicate projection identity");
        seen.add(ship.id);
        upserts.push(ship);
    }
    for (let offset = 0; offset < batch.removedIds.length; offset += 16) {
        const id = opaqueIdAt(batch.removedIds, offset);
        if (seen.has(id))
            throw new Error("Duplicate projection identity");
        seen.add(id);
        removed.push(id);
    }
    return { upserts, removed };
}
function readShip(batch, i) {
    const row = { id: opaqueIdAt(batch.ids, i * 16), revision: batch.revisions[i],
        x: batch.positions[i * 2], z: batch.positions[i * 2 + 1],
        targetX: batch.targets[i * 2], targetZ: batch.targets[i * 2 + 1],
        departureMs: batch.times[i * 2], arrivalMs: batch.times[i * 2 + 1], moving: batch.moving[i] === 1 };
    if (!u64(row.revision) || batch.moving[i] > 1
        || ![row.x, row.z, row.targetX, row.targetZ].every(Number.isFinite))
        throw new Error("Invalid projection ship");
    if (row.moving && row.arrivalMs <= row.departureMs)
        throw new Error("Invalid projection movement interval");
    return row;
}
export function appendSnapshot(current, batch) {
    const chunk = batch.snapshot;
    validateSnapshotChunk(batch);
    const assembly = current ?? startSnapshot(batch);
    if (!matchesSnapshot(assembly, batch) || assembly.next !== chunk.index)
        throw new Error("Snapshot chunk does not follow its watermark");
    const change = readProjectionChanges(batch);
    const bytes = bufferBytes(projectionBuffers(batch));
    if (change.removed.length || assembly.ships.size + change.upserts.length > MAX_SNAPSHOT_ENTITIES
        || assembly.bytes + bytes > MAX_SNAPSHOT_BYTES)
        throw new Error("Snapshot assembly capacity exceeded");
    for (const ship of change.upserts) {
        if (assembly.ships.has(ship.id))
            throw new Error("Duplicate snapshot identity");
        assembly.ships.set(ship.id, ship);
    }
    assembly.bytes += bytes;
    assembly.next++;
    return assembly;
}
function validateSnapshotChunk(batch) {
    const chunk = batch.snapshot;
    if (!isOpaqueId(chunk.id) || !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > 4096
        || !Number.isInteger(chunk.index) || chunk.index < 0 || chunk.index >= chunk.count)
        throw new Error("Invalid snapshot chunk");
}
export function matchesSnapshot(assembly, batch) {
    return assembly.id === batch.snapshot.id && assembly.count === batch.snapshot.count
        && assembly.watermark.sequence === batch.sequence && assembly.watermark.systemRevision === batch.systemRevision
        && assembly.watermark.streamGeneration === batch.streamGeneration && sameScope(assembly.watermark.scope, batch.scope);
}
function startSnapshot(batch) {
    if (batch.snapshot.index !== 0)
        throw new Error("Snapshot must start at chunk zero");
    return { id: batch.snapshot.id, count: batch.snapshot.count, next: 0, bytes: 0,
        watermark: watermark(batch), ships: new Map() };
}
//# sourceMappingURL=projection-state.js.map