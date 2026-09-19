/** Adapts the detail view to the existing packed renderer and owned rule seed.
 * OwnedFleetSummary never enters this adapter: its locations are not rule state. */
import { copyObservation } from './copy.js';
import { create } from '@bufbuild/protobuf';
import { SystemSnapshotChunkSchema, SystemDeltaSchema } from '../generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdAt, opaqueIdBytes } from '../../contracts/opaque-id.js';
import { createOwnedProjection } from '../owned-projection.js';
import { packSnapshot, packDelta } from '../projection-pack.js';
import { watermark } from '../../render/remote/projection-state.js';
export function createDetailProjection(connection, player, subscriptionId) {
    let current;
    let nextGeneration = 0n;
    let owned = createOwnedProjection(connection, player);
    function invalidate() { current = undefined; owned.dispose(); owned = createOwnedProjection(connection, player); }
    function* snapshot(value) {
        validateBaseline(value);
        invalidate();
        if (nextGeneration === 2n ** 64n - 1n)
            throw new Error('Render generation exhausted');
        const observation = copyObservation(value.rows.observation);
        const state = { id: value.id, baseline: value.baselineGeneration, request: value.requestGeneration, epoch: value.visibilityEpoch,
            wireSequence: value.sequence, revision: observation.revision, observation, generation: ++nextGeneration, sequence: 0n };
        current = state;
        const rows = value.rows.tables.get('fleets');
        const count = Math.max(1, Math.ceil((rows?.size ?? 0) / 256));
        const iterator = rows?.values();
        for (let index = 0; index < count; index++) {
            if (current !== state)
                return;
            const fleets = takeFleets(iterator);
            const chunk = create(SystemSnapshotChunkSchema, { scope: observation.scope, cursor: { subscriptionId: opaqueIdBytes(subscriptionId), generation: state.generation, sequence: 0n },
                snapshotId: opaqueIdBytes(value.id), chunkIndex: index, chunkCount: count, systemRevision: observation.revision, committedTimeMs: observation.committedServerMs, fleets });
            const batch = packSnapshot(chunk);
            owned.snapshot(chunk, watermark(batch));
            yield batch;
        }
    }
    function delta(value, request, epoch) {
        const state = current;
        if (!state || state.id !== opaqueIdAt(value.baselineId) || state.baseline !== value.baselineGeneration || state.request !== request || state.epoch !== epoch)
            return;
        if (value.sequence <= state.wireSequence)
            return;
        if (value.baseSequence !== state.wireSequence || value.rows.case !== 'detail')
            throw new Error('Detail delta baseline gap');
        const rows = value.rows.value;
        const observation = rows.observation;
        validateAdvance(observation, state);
        const wire = create(SystemDeltaSchema, { scope: observation.scope, cursor: { subscriptionId: opaqueIdBytes(subscriptionId), generation: state.generation, sequence: state.sequence + 1n }, baseSystemRevision: state.revision, systemRevision: observation.revision, committedTimeMs: observation.committedServerMs, upserts: rows.upserts, removedFleetIds: rows.removedFleetIds });
        const batch = packDelta(wire);
        owned.delta(wire, watermark(batch));
        state.sequence++;
        state.wireSequence = value.sequence;
        state.revision = observation.revision;
        state.observation = copyObservation(observation);
        return batch;
    }
    return { snapshot, delta, invalidate, dispose: invalidate, page: (query, serverNow) => owned.page(query, serverNow),
        current: () => current && { request: current.request, generation: current.generation, sequence: current.sequence, scope: current.observation.scope } };
}
function validateBaseline(value) {
    if (value.selector.kind.case !== 'detail' || !value.rows.observation?.scope || !value.complete)
        throw new Error('Complete detail baseline required');
}
function takeFleets(iterator) {
    const fleets = [];
    for (let i = 0; i < 256; i++) {
        const next = iterator?.next();
        if (!next || next.done)
            break;
        if (next.value.$typeName !== 'galaxy.v1.FleetProjection')
            throw new Error('Invalid detail row');
        fleets.push(next.value);
    }
    return fleets;
}
function validateAdvance(observation, state) {
    if (!observation?.scope || opaqueIdAt(observation.scope.systemId) !== opaqueIdAt(state.observation.scope.systemId) || observation.revision <= state.revision)
        throw new Error('Detail source did not advance');
}
//# sourceMappingURL=detail-projection.js.map