import { copyRow, copyObservation } from './copy.js';
import { opaqueIdAt } from '../../contracts/opaque-id.js';
export function emptyRows() { return { tables: new Map(), unavailable: [], unavailableSummaries: 0 }; }
function key(row) {
    if ('fleetId' in row)
        return opaqueIdAt(row.fleetId);
    if ('systemId' in row)
        return opaqueIdAt(row.systemId);
    if ('clusterId' in row)
        return opaqueIdAt(row.clusterId);
    return [opaqueIdAt(row.systemA), opaqueIdAt(row.systemB)].sort().join(':');
}
function apply(state, name, upserts, removals, baseline, limit) {
    let table = state.tables.get(name);
    if (!table) {
        table = new Map();
        state.tables.set(name, table);
    }
    validateChanges(table, upserts, removals, baseline);
    const unavailable = (row) => row?.$typeName === 'galaxy.v1.OverviewSystem' && row.observation?.availability !== 1 ? 1 : 0;
    for (const k of removals) {
        if (name === 'summaries')
            state.unavailableSummaries -= unavailable(table.get(k));
        table.delete(k);
    }
    for (const row of upserts) {
        const k = key(row);
        if (name === 'summaries')
            state.unavailableSummaries += unavailable(row) - unavailable(table.get(k));
        table.set(k, copyRow(row));
    }
    if (table.size > limit)
        throw new Error('View retained row budget');
}
function validateChanges(table, upserts, removals, baseline) {
    const seen = new Set(removals);
    if (seen.size !== removals.length || (baseline && removals.length))
        throw new Error('Invalid view removals');
    for (const row of upserts) {
        const k = key(row);
        if (seen.has(k) || (baseline && table.has(k)))
            throw new Error('Duplicate view row');
        seen.add(k);
    }
}
export function applyRows(state, rows, baseline) {
    switch (rows.case) {
        case 'overview':
            applyOverview(state, rows.value, baseline);
            break;
        case 'owned':
            applyOwned(state, rows.value, baseline);
            break;
        case 'detail':
            applyDetail(state, rows.value, baseline);
            break;
    }
}
function applyOverview(state, rows, baseline) {
    apply(state, 'clusters', rows.clusters, rows.removedClusterIds.map(id => opaqueIdAt(id)), baseline, 256);
    apply(state, 'systems', rows.systems, rows.removedSystemIds.map(id => opaqueIdAt(id)), baseline, 4096);
    apply(state, 'connections', rows.connections, rows.removedConnections.map(key), baseline, 16384);
    apply(state, 'summaries', rows.summaries, rows.removedSystemIds.map(id => opaqueIdAt(id)), baseline, 4096);
    removeEdges(state, rows.removedSystemIds);
}
function applyOwned(state, rows, baseline) {
    apply(state, 'fleets', rows.upserts, rows.removedFleetIds.map(id => opaqueIdAt(id)), baseline, 16384);
    const unavailable = rows.unavailableSourceIds.map(id => opaqueIdAt(id)).sort();
    if (baseline && state.ownedCut !== undefined && unavailable.join() !== state.ownedCut)
        throw new Error('Snapshot availability changed');
    if (baseline)
        state.ownedCut = unavailable.join();
    state.unavailable = unavailable;
}
function applyDetail(state, rows, baseline) {
    if (baseline && state.observation && observationKey(state.observation) !== observationKey(rows.observation))
        throw new Error('Detail snapshot cut changed');
    apply(state, 'fleets', rows.upserts, rows.removedFleetIds.map(id => opaqueIdAt(id)), baseline, 16384);
    state.observation = copyObservation(rows.observation);
}
function removeEdges(state, ids) {
    if (!ids.length)
        return;
    const removed = new Set(ids.map(id => opaqueIdAt(id)));
    const edges = state.tables.get('connections');
    for (const edge of edges?.keys() ?? [])
        if (edge.split(':').some(id => removed.has(id)))
            edges.delete(edge);
}
function observationKey(o) {
    if (!o?.scope)
        throw new Error('Missing detail observation');
    const s = o.scope;
    return [opaqueIdAt(s.worldId), opaqueIdAt(s.shardId), opaqueIdAt(s.systemId), s.ownerEpoch, s.recoveryGeneration, o.revision, o.committedServerMs, o.availability].join(':');
}
/** Constant-time current availability; sparse summary updates maintain the count. */
export function rowsComplete(state, slot) {
    if (slot === 1)
        return state.unavailableSummaries === 0;
    if (slot === 2)
        return state.unavailable.length === 0;
    return state.observation?.availability === 1;
}
//# sourceMappingURL=rows.js.map