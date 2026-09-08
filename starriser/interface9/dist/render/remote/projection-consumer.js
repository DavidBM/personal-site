import { isOpaqueId } from "../../contracts/opaque-id.js";
import { MAX_SNAPSHOT_ENTITIES } from "./contracts.js";
import { createProjectionBarriers } from "./projection-barriers.js";
import { appendSnapshot, copyWatermark, matchesSnapshot, readProjectionChanges, sameScope, validateProjectionHeader, watermark } from "./projection-state.js";
/** One subscription owns persistent IDs. The sink resolves after actual CPU/GPU
 * packing; returning transfer credit and reporting applied progress then agree. */
export function createProjectionConsumer(expected, options) {
    if (![expected.worldId, expected.systemId, expected.subscriptionId].every(isOpaqueId))
        throw new Error("Invalid projection subscription");
    let ships = new Map();
    let received = null;
    let applied = null;
    let assembly = null;
    let consuming = false;
    let closed = false;
    let needsSnapshot = true;
    const lifetime = new AbortController();
    const barriers = createProjectionBarriers();
    function publish(value) {
        applied = value;
        barriers.advance(value);
        options.onApplied?.({ ...value, scope: { ...value.scope } });
    }
    function classify(batch) {
        if (received && batch.streamGeneration < received.streamGeneration)
            return "old";
        validateProjectionHeader(batch, expected);
        if (batch.snapshot)
            return "snapshot";
        requireDeltaBaseline(batch);
        if (batch.sequence <= applied.sequence)
            return "old";
        if (batch.sequence !== applied.sequence + 1n || batch.baseSystemRevision !== applied.systemRevision
            || batch.systemRevision <= batch.baseSystemRevision)
            throw new Error("Projection delta has a baseline gap");
        return "delta";
    }
    function requireDeltaBaseline(batch) {
        if (!applied || assembly || batch.streamGeneration !== applied.streamGeneration
            || !sameScope(batch.scope, applied.scope) || needsSnapshot)
            throw new Error("Projection needs a complete snapshot");
    }
    function duplicateSnapshot(batch) {
        if (assembly && matchesSnapshot(assembly, batch) && batch.snapshot.index < assembly.next)
            return true;
        if (received && batch.streamGeneration === received.streamGeneration && !assembly) {
            if (batch.sequence <= received.sequence)
                return true;
            throw new Error("Replacement snapshot requires a new stream generation");
        }
        return false;
    }
    async function applySnapshot(batch, signal) {
        if (duplicateSnapshot(batch))
            return;
        if (received && batch.streamGeneration > received.streamGeneration) {
            assembly = null;
            barriers.replace(watermark(batch));
        }
        assembly = appendSnapshot(assembly, batch);
        received = watermark(batch);
        if (assembly.next !== assembly.count)
            return;
        const replacement = assembly;
        await options.replace(replacement.ships, signal);
        signal.throwIfAborted();
        ships = replacement.ships;
        assembly = null;
        needsSnapshot = false;
        publish(replacement.watermark);
    }
    async function apply(change, signal) {
        signal.throwIfAborted();
        if (closed)
            throw new Error("Projection consumer is disposed");
        await options.apply(change, signal);
        signal.throwIfAborted();
    }
    async function applyDelta(batch, signal) {
        const change = readProjectionChanges(batch);
        let count = ships.size;
        for (const id of change.removed)
            if (ships.has(id))
                count--;
        for (const ship of change.upserts) {
            const before = ships.get(ship.id);
            if (before && ship.revision <= before.revision)
                throw new Error("Projection ship revision did not advance");
            if (!before)
                count++;
        }
        if (count > MAX_SNAPSHOT_ENTITIES)
            throw new Error("Projection entity capacity exceeded");
        received = watermark(batch);
        await apply(change, signal);
        for (const id of change.removed)
            ships.delete(id);
        for (const ship of change.upserts)
            ships.set(ship.id, ship);
        publish(watermark(batch));
    }
    return {
        async consume(batch, signal) {
            if (closed || consuming)
                throw new Error("Projection consumer requires serial delivery while alive");
            consuming = true;
            const activeSignal = AbortSignal.any([signal, lifetime.signal]);
            try {
                activeSignal.throwIfAborted();
                const action = classify(batch);
                if (action === "snapshot")
                    await applySnapshot(batch, activeSignal);
                if (action === "delta")
                    await applyDelta(batch, activeSignal);
            }
            catch (error) {
                assembly = null;
                needsSnapshot = true;
                barriers.invalidate("Projection application requires resynchronization");
                throw error;
            }
            finally {
                consuming = false;
            }
        },
        waitFor: barriers.wait,
        inspect: () => ({ received: received && copyWatermark(received), applied: applied && copyWatermark(applied), entities: ships.size, snapshotEntities: assembly?.ships.size ?? 0 }),
        ship: (id) => ships.get(id),
        dispose() {
            closed = true;
            lifetime.abort();
            received = applied = null;
            assembly = null;
            ships.clear();
            barriers.dispose();
        },
    };
}
//# sourceMappingURL=projection-consumer.js.map