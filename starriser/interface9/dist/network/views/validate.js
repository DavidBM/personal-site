import { check, id, present, scope, fleet } from '../validate-fields.js';
import { opaqueIdAt } from '../../contracts/opaque-id.js';
export function counter(v, nonzero = true) { check(typeof v === 'bigint' && v >= (nonzero ? 1n : 0n) && v <= 0xffffffffffffffffn, 'view counter'); }
function ids(v, max) { check(v.length <= max, 'view ID budget'); const found = new Set(); for (const x of v) {
    id(x);
    const k = opaqueIdAt(x);
    check(!found.has(k), 'duplicate view ID');
    found.add(k);
} }
export function validateSelector(s, slot) {
    const k = s.kind;
    if (k.case === 'owned') {
        check(slot === 2, 'view slot');
        return;
    }
    if (k.case === 'detail') {
        check(slot === 3, 'view slot');
        id(k.value.systemId);
        return;
    }
    check(k.case === 'overview' && slot === 1, 'view selector');
    const v = k.value;
    ids(v.systemIds, 4096);
    ids(v.clusterIds, 256);
    check(Number(v.wholeKnownGalaxy) + Number(v.systemIds.length > 0) + Number(v.clusterIds.length > 0) === 1, 'overview selector');
}
export function validateViewRequest(v) {
    id(v.worldId);
    counter(v.requestGeneration);
    check(v.slot >= 1 && v.slot <= 3, 'view slot');
    switch (v.operation.case) {
        case 'replace':
            validateSelector(v.operation.value, v.slot);
            return;
        case 'resume':
            counter(v.operation.value.baselineGeneration);
            id(v.operation.value.baselineId);
            counter(v.operation.value.visibilityEpoch);
            counter(v.operation.value.afterSequence, false);
            return;
        case 'close': return;
        default: throw new Error('Missing view operation');
    }
}
function observation(v, world) {
    const o = present(v, 'view observation');
    scope(o.scope);
    check(opaqueIdAt(o.scope.worldId) === opaqueIdAt(world), 'view world');
    check(o.availability >= 1 && o.availability <= 4, 'view availability');
    counter(o.revision, false);
    counter(o.committedServerMs, false);
    return o;
}
function point(p) { check(p && Number.isFinite(p.x) && Number.isFinite(p.z), 'view point'); }
function overview(v, world) {
    ids(v.removedSystemIds, 256);
    ids(v.removedClusterIds, 256);
    for (const c of v.clusters) {
        id(c.clusterId);
        point(c.position);
        check(new TextEncoder().encode(c.name).length <= 64 && Number.isFinite(c.radius) && c.radius > 0, 'view cluster');
    }
    for (const s of v.systems) {
        id(s.systemId);
        id(s.clusterId);
        point(s.position);
        check(new TextEncoder().encode(s.name).length <= 64, 'view name');
    }
    for (const c of [...v.connections, ...v.removedConnections]) {
        id(c.systemA);
        id(c.systemB);
        check(opaqueIdAt(c.systemA) !== opaqueIdAt(c.systemB), 'view edge');
    }
    for (const s of v.summaries)
        summary(s, world);
    check(v.clusters.length + v.systems.length + v.connections.length + v.summaries.length + v.removedSystemIds.length + v.removedClusterIds.length + v.removedConnections.length <= 256, 'view rows');
}
function summary(s, world) {
    id(s.systemId);
    const o = observation(s.observation, world);
    check(opaqueIdAt(o.scope.systemId) === opaqueIdAt(s.systemId), 'summary system');
    if (o.availability === 1)
        check(s.presentFleets !== undefined && s.movingFleets !== undefined && s.movingFleets <= s.presentFleets, 'view counts');
    else
        check(s.presentFleets === undefined && s.movingFleets === undefined, 'hidden counts');
}
function owned(v, world) {
    ids(v.removedFleetIds, 256);
    ids(v.unavailableSourceIds, 4096);
    for (const f of v.upserts) {
        id(f.fleetId);
        observation(f.source, world);
        counter(f.fleetRevision, false);
        check(f.state >= 1 && f.state <= 3, 'owned state');
        if (f.state === 3) {
            check(!f.systemId.length && f.arrivalServerMs !== undefined, 'transit fields');
            id(f.destinationSystemId);
            id(f.departureSystemId);
            id(f.transferId);
        }
        else {
            id(f.systemId);
            check(!f.destinationSystemId.length && !f.departureSystemId.length && !f.transferId.length, 'resident fields');
        }
    }
    check(v.upserts.length + v.removedFleetIds.length <= 256, 'owned rows');
}
export function validateRows(rows, slot, world) {
    check(rows.case === ['', 'overview', 'owned', 'detail'][slot], 'rows slot');
    if (rows.case === 'overview')
        overview(rows.value, world);
    else if (rows.case === 'owned')
        owned(rows.value, world);
    else if (rows.case === 'detail') {
        observation(rows.value.observation, world);
        ids(rows.value.removedFleetIds, 256);
        for (const f of rows.value.upserts)
            fleet(f);
        check(rows.value.upserts.length + rows.value.removedFleetIds.length <= 256, 'detail rows');
    }
}
export function validateViewEvent(v) {
    id(v.worldId);
    counter(v.requestGeneration);
    counter(v.visibilityEpoch);
    check(v.slot >= 1 && v.slot <= 3, 'view slot');
    const r = v.result;
    switch (r.case) {
        case 'begin':
            check(v.slot === 1 ? r.value.topologyRevision > 0n : r.value.topologyRevision === 0n, 'view topology revision');
            counter(r.value.baselineGeneration);
            id(r.value.baselineId);
            id(r.value.projectionOwnerId);
            counter(r.value.ownerEpoch);
            counter(r.value.recoveryGeneration);
            validateSelector(present(r.value.selector, 'view selector'), v.slot);
            return;
        case 'chunk':
            counter(r.value.baselineGeneration);
            id(r.value.baselineId);
            check(r.value.chunkIndex < 128, 'view chunk');
            validateRows(r.value.rows, v.slot, v.worldId);
            return;
        case 'ready':
            readyFields(r.value);
            return;
        case 'delta':
            counter(r.value.baselineGeneration);
            id(r.value.baselineId);
            counter(r.value.baseSequence, false);
            counter(r.value.sequence);
            check(r.value.sequence === r.value.baseSequence + 1n, 'view sequence');
            validateRows(r.value.rows, v.slot, v.worldId);
            return;
        case 'invalidated':
            invalidatedFields(r.value);
            return;
        case 'rejected':
            rejectedFields(r.value);
            return;
        case 'closed': return;
        default: throw new Error('Missing view result');
    }
}
function readyFields(v) { counter(v.baselineGeneration); id(v.baselineId); check(v.chunkCount <= 128 && v.sequence === 0n, 'view ready'); }
function rejectedFields(v) { check(v.reason >= 1 && v.reason <= 5 && v.retryAfterMs <= 30000, 'view rejection'); }
function invalidatedFields(v) {
    check(v.reason >= 1 && v.reason <= 4, 'view invalidation');
    if (v.reason !== 1)
        counter(v.baselineGeneration);
}
//# sourceMappingURL=validate.js.map