import { surveyFleetCounts, shipCount } from '../gpu/map/survey/ship-totals.js';
import { fleetRelationship } from '../contracts/fleet-relationship.js';
/** Projection-local information only. Never fetch another system or expose a render-slot identity. */
export function clusterSurveyPage(state, remote, query) {
    const survey = state.view.survey, meta = survey.cluster(query.clusterId);
    if (!meta)
        return null;
    const rec = query.systemId === undefined ? undefined : survey.system(query.systemId);
    if (invalidSystemScope(query, rec?.clusterId))
        return null;
    const offset = Math.max(0, query.offset | 0), limit = Math.max(1, Math.min(64, query.limit | 0));
    const system = query.systemId, totals = survey.fleetTotals();
    const counts = scopeCounts(state, query);
    const rows = sectionRows(state, remote, query, offset, limit);
    return { alertsPartial: survey.signals.alertsPartial(), clusterId: query.clusterId, ...(system === undefined ? {} : { systemId: system }), section: query.section, owned: query.owned, name: (rec?.name ?? meta.name) + (query.owned ? ' · Yours' : ''),
        relationships: totals.ships.get(system ?? query.clusterId, system !== undefined).relationships,
        loaded: meta.systemIds.length > 0, offset, total: query.section === 'details' ? 0 : counts[query.section], ...counts, rows };
}
function scopeCounts(state, query) {
    const survey = state.view.survey, meta = survey.cluster(query.clusterId);
    const totals = survey.fleetTotals(), total = totals.get(query.clusterId), system = query.systemId;
    const scoped = system === undefined ? null : totals.getSystem(system), alerts = survey.signals.alerts(query.clusterId, system);
    const counts = { systems: system === undefined ? meta.systemIds.length : 1,
        fleets: scoped ? scoped.fleets : total.fleets + total.transit,
        inbound: scoped ? scoped.inbound : total.inbound, outbound: scoped ? scoped.outbound : totals.getOutbound(query.clusterId),
        planets: survey.signals.planetCount(query.clusterId, system), battles: alerts.own + alerts.ally };
    if (query.owned) {
        counts.planets = survey.mapLayers.ownedCount(query.clusterId, system);
        for (const key of ['fleets', 'inbound', 'outbound'])
            counts[key] = totals.ownedCount(query.clusterId, key, system);
    }
    return counts;
}
function sectionRows(state, remote, query, offset, limit) {
    const survey = state.view.survey;
    switch (query.section) {
        case 'systems': return systemRows(state, (query.systemId === undefined ? survey.cluster(query.clusterId).systemIds : [query.systemId]).slice(offset, offset + limit));
        case 'planets': return query.owned ? survey.mapLayers.planetRows(query.clusterId, query.systemId, offset, limit).map(row => survey.signals.planetRows({ ...query, systemId: row.systemId }, 0, 64).find(p => p.id === row.id) ?? row) : survey.signals.planetRows(query, offset, limit);
        case 'battles': return survey.signals.battleRows(query, offset, limit);
        case 'details': return [];
        default: return fleetRows(state, remote, survey.fleetTotals().page(query.clusterId, query.section, offset, limit, query.systemId, query.owned));
    }
}
function systemRows(state, ids) {
    return ids.flatMap(id => {
        const rec = state.view.survey.system(id);
        return rec ? [{ id: String(id), name: rec.name, systemId: id, clusterId: rec.clusterId }] : [];
    });
}
function fleetRows(state, remote, ids) {
    const identity = new Map(remote.map(ref => [ref.visual.id, ref.id]));
    return ids.flatMap((renderId) => {
        const row = state.view.survey.fleetTotals().rosterRow(renderId);
        if (row)
            return [{ id: row.id, name: `Fleet ${row.id.slice(0, 8)}`, systemId: row.node.solarSystemId, clusterId: row.node.clusterId,
                    onlineSystemId: row.onlineSystemId, relationship: 'own', ships: row.ships,
                    state: row.source ? 'jumping' : row.moving ? 'moving' : 'awaiting' }];
        const visual = state.view.getFleetVisual(renderId);
        if (!visual)
            return [];
        const id = identity.get(renderId) ?? renderId;
        const counts = surveyFleetCounts(visual);
        const node = visual.state.state === 'jumping' ? visual.state.endNode : visual.state.node;
        return [{ id, name: `Fleet ${id.slice(0, 8)}`, systemId: node.solarSystemId, clusterId: node.clusterId,
                relationship: fleetRelationship(visual.relationship), ships: counts ? shipCount(counts) : undefined,
                state: visual.state.state }];
    });
}
function invalidSystemScope(query, clusterId) {
    return query.systemId !== undefined && clusterId !== query.clusterId;
}
//# sourceMappingURL=cluster-survey.js.map