import { MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_ENTITIES } from '../render/remote/contracts.js';
import { opaqueIdAt } from '../contracts/opaque-id.js';
export function scopeKey(scope) {
    return [opaqueIdAt(scope.worldId), opaqueIdAt(scope.shardId), opaqueIdAt(scope.systemId), scope.ownerEpoch, scope.recoveryGeneration].join(':');
}
/** Receive-order validation only. This is neither a render application watermark
 * nor a replay store; the authoritative server supplies replay or a new snapshot. */
export function createSystemStream(subscription, requestSnapshot) {
    let baseline;
    let snapshot;
    let resyncPending = false;
    function scoped(scope, cursor) {
        if (opaqueIdAt(cursor.subscriptionId) !== subscription.subscriptionId)
            return false;
        if (opaqueIdAt(scope.worldId) !== subscription.worldId || opaqueIdAt(scope.systemId) !== subscription.systemId)
            throw new Error('Server projection is outside the subscribed system');
        return true;
    }
    function resync(cursor) {
        if (resyncPending)
            return;
        resyncPending = true;
        requestSnapshot(cursor);
    }
    function begin(chunk) {
        if (chunk.chunkCount > 64)
            throw new Error('Snapshot chunk budget exceeded');
        return { scope: scopeKey(chunk.scope), generation: chunk.cursor.generation, sequence: chunk.cursor.sequence,
            revision: chunk.systemRevision, id: opaqueIdAt(chunk.snapshotId), count: chunk.chunkCount,
            next: 0, bytes: 0, entities: 0, ids: new Set() };
    }
    function checkSnapshot(chunk, current, encodedBytes) {
        if (scopeKey(chunk.scope) !== current.scope || chunk.cursor.sequence !== current.sequence || chunk.systemRevision !== current.revision
            || opaqueIdAt(chunk.snapshotId) !== current.id || chunk.chunkCount !== current.count)
            throw new Error('Snapshot metadata changed between chunks');
        current.bytes += encodedBytes;
        current.entities += chunk.ships.length;
        if (current.bytes > MAX_SNAPSHOT_BYTES || current.entities > MAX_SNAPSHOT_ENTITIES)
            throw new Error('Snapshot aggregate budget exceeded');
        for (const ship of chunk.ships) {
            const id = opaqueIdAt(ship.shipId);
            if (current.ids.has(id))
                throw new Error('Duplicate ship in snapshot');
            current.ids.add(id);
        }
    }
    function snapshotFor(chunk) {
        const generation = chunk.cursor.generation;
        const latest = snapshot ?? baseline;
        if (latest && generation < latest.generation)
            return undefined;
        if (!snapshot && baseline && generation === baseline.generation)
            return undefined;
        if (snapshot && generation === snapshot.generation)
            return snapshot;
        if (chunk.chunkIndex !== 0) {
            resync();
            return undefined;
        }
        snapshot = begin(chunk);
        return snapshot;
    }
    function deltaBaseline(delta) {
        const latest = snapshot ?? baseline;
        if (latest && delta.cursor.generation < latest.generation)
            return undefined;
        if (snapshot || !baseline) {
            resync();
            return undefined;
        }
        if (delta.cursor.generation !== baseline.generation || scopeKey(delta.scope) !== baseline.scope) {
            resync();
            return undefined;
        }
        return baseline;
    }
    return {
        snapshot(chunk, encodedBytes) {
            const cursor = chunk.cursor;
            if (!scoped(chunk.scope, cursor))
                return false;
            const current = snapshotFor(chunk);
            if (!current || chunk.chunkIndex < current.next)
                return false;
            if (chunk.chunkIndex !== current.next) {
                resync();
                return false;
            }
            checkSnapshot(chunk, current, encodedBytes);
            current.next++;
            if (current.next === current.count) {
                baseline = { scope: current.scope, generation: current.generation, sequence: current.sequence, revision: current.revision };
                snapshot = undefined;
                resyncPending = false;
            }
            return true;
        },
        delta(delta) {
            const cursor = delta.cursor;
            if (!scoped(delta.scope, cursor))
                return false;
            const current = deltaBaseline(delta);
            if (!current || cursor.sequence <= current.sequence)
                return false;
            if (cursor.sequence !== current.sequence + 1n || delta.baseSystemRevision !== current.revision) {
                resync({ ...cursor, sequence: current.sequence });
                return false;
            }
            baseline = { scope: current.scope, generation: cursor.generation, sequence: cursor.sequence, revision: delta.systemRevision };
            resyncPending = false;
            return true;
        },
        inspect: () => ({ baseline, snapshotPending: !!snapshot, resyncPending }),
    };
}
//# sourceMappingURL=system-stream.js.map