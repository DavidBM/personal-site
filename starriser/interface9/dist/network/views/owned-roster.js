import { opaqueIdAt } from '../../contracts/opaque-id.js';
export function viewToken(connection, baseline) {
    return { connection, request: baseline.requestGeneration, baseline: baseline.baselineGeneration, epoch: baseline.visibilityEpoch, sequence: baseline.sequence };
}
function sameToken(a, b) {
    return a.connection === b.connection && a.request === b.request && a.baseline === b.baseline && a.epoch === b.epoch && a.sequence === b.sequence;
}
function productRow(row) {
    if (row.$typeName !== 'galaxy.v1.OwnedFleetRow' || !row.source)
        throw new Error('Invalid owned roster row');
    const location = row.state === 3 ? { kind: 'transit', sourceSystemId: opaqueIdAt(row.departureSystemId), destinationSystemId: opaqueIdAt(row.destinationSystemId), arrivalMs: row.arrivalServerMs }
        : { kind: 'resident', systemId: opaqueIdAt(row.systemId), moving: row.state === 2, ...(row.arrivalServerMs === undefined ? {} : { arrivalMs: row.arrivalServerMs }) };
    return { id: opaqueIdAt(row.fleetId), revision: row.fleetRevision, location, sourceRevision: row.source.revision, committedMs: row.source.committedServerMs, availability: row.source.availability };
}
function validateQuery(baseline, query, token, total) {
    if (!baseline.complete || baseline.selector.kind.case !== 'owned')
        throw new Error('Complete owned roster required');
    if (query.required && !sameToken(query.required, token))
        throw new Error('Owned roster page belongs to another view revision');
    const window = { offset: query.offset ?? 0, limit: query.limit ?? 64 };
    validateWindow(window, total);
    if (window.offset > 0 && !query.required)
        throw new Error('Owned roster page bounds');
    return window;
}
function validateWindow({ offset, limit }, total) {
    if (!Number.isInteger(offset) || offset < 0 || offset > total || !Number.isInteger(limit) || limit < 1 || limit > 256)
        throw new Error('Owned roster page bounds');
}
function projectPage(rows, { offset, limit }) {
    const fleets = [];
    let seen = 0;
    for (const row of rows) {
        if (seen++ < offset)
            continue;
        fleets.push(productRow(row));
        if (fleets.length === limit)
            break;
    }
    return fleets;
}
/** Operates on the worker-owned baseline without copying its whole row table.
 * A direct fleet query is one indexed lookup; only returned product rows escape. */
export function ownedRosterPage(connection, baseline, query) {
    const token = viewToken(connection, baseline);
    const rows = baseline.rows.tables.get('fleets'), total = rows?.size ?? 0;
    const window = validateQuery(baseline, query, token, total);
    const common = { token, unavailableSourceIds: [...baseline.rows.unavailable], total };
    if (query.fleetId) {
        const row = rows?.get(query.fleetId);
        return { ...common, fleets: row ? [productRow(row)] : [], nextOffset: null };
    }
    const fleets = projectPage(rows?.values() ?? [], window);
    const next = window.offset + fleets.length;
    return { ...common, fleets, nextOffset: next < total ? next : null };
}
//# sourceMappingURL=owned-roster.js.map