import { SurveyPlanetTotals } from './planet-totals.js';
import { buildCompactKepler, MAX_COMPACT_PLANETS } from '../../compact-kepler.js';
import { PLANET_CATALOG } from '../../planet-lib/planet-catalog.js';
import { catalogIdFromSystemId } from '../../solar-catalog-id.js';
const NONE = { own: 0, ally: 0 };
const LOCAL_PLANETS = Math.min(MAX_COMPACT_PLANETS, PLANET_CATALOG.length);
/** Authorized catalog scope and accepted battle events, separate from visual topology seeds. */
export class SurveySignals {
    constructor(topology) {
        this.planets = new SurveyPlanetTotals();
        this.battles = new Map();
        this.revisions = new Map();
        this.clusters = new Map();
        this.systems = new Map();
        this.alertPartial = false;
        this.topology = topology;
    }
    setAlerts(rows, partial) {
        const ids = new Set(rows.map(row => row.id));
        for (const id of this.battles.keys())
            if (id.startsWith('online:') && !ids.has(id))
                this.removeBattle(id);
        for (const row of rows)
            this.setBattle(row);
        this.alertPartial = partial;
    }
    alertsPartial() { return this.alertPartial; }
    setPlanets(value) { this.planets.set(value); }
    setBattle(value) {
        const revision = BigInt(value.revision);
        if ((this.revisions.get(value.id) ?? -1n) >= revision)
            return;
        this.removeBattle(value.id, false);
        this.revisions.set(value.id, revision);
        if (this.revisions.size > 256)
            this.revisions.delete(this.revisions.keys().next().value);
        if (!value.active || this.battles.size >= 64)
            return;
        this.battles.set(value.id, value);
        this.adjust(value, 1);
    }
    removeBattle(id, forgetRevision = true) {
        if (forgetRevision)
            this.revisions.delete(id);
        const old = this.battles.get(id);
        if (old) {
            this.adjust(old, -1);
            this.battles.delete(id);
        }
    }
    alerts(clusterId, systemId) {
        return (systemId === undefined ? this.clusters.get(clusterId) : this.systems.get(systemId)) ?? NONE;
    }
    planetCount(clusterId, systemId) {
        const cluster = this.topology.clusterLodMeta.get(clusterId);
        if (!cluster)
            return 0;
        if (!cluster.publicAtlas)
            return (systemId === undefined ? cluster.systemIds.length : 1) * LOCAL_PLANETS;
        return this.planets.count(clusterId, systemId);
    }
    planetRows(scope, offset, limit) {
        const cluster = this.topology.clusterLodMeta.get(scope.clusterId);
        if (!cluster)
            return [];
        if (cluster.publicAtlas)
            return this.planets.rows(scope, offset, limit);
        const ids = scope.systemId === undefined ? cluster.systemIds : [scope.systemId];
        const rows = [];
        // Only materialize the explicitly requested bounded page, never the whole cluster catalog.
        for (let n = offset; n < Math.min(offset + limit, ids.length * LOCAL_PLANETS);) {
            const systemId = ids[Math.floor(n / LOCAL_PLANETS)], rec = this.topology.sceneSystems.get(systemId);
            if (!rec)
                break;
            const bodies = buildCompactKepler(rec.catalogId ?? catalogIdFromSystemId(systemId)).planets;
            for (let i = n % LOCAL_PLANETS; i < bodies.length && rows.length < limit; i++, n++) {
                const body = bodies[i];
                rows.push({ id: body.id, name: body.name, kind: body.kind, catalogId: body.id, systemId, clusterId: scope.clusterId });
            }
        }
        return rows;
    }
    battleRows(scope, offset, limit) {
        return [...this.battles.values()].filter(b => b.clusterId === scope.clusterId && (scope.systemId === undefined || b.systemId === scope.systemId))
            .slice(offset, offset + limit).map(b => ({ id: b.id, name: b.involvement === 'own' ? 'Your forces in battle' : 'Allied forces in battle',
            kind: 'battle', systemId: b.systemId, clusterId: b.clusterId }));
    }
    adjust(b, delta) {
        adjust(this.clusters, b.clusterId, b.involvement, delta);
        adjust(this.systems, b.systemId, b.involvement, delta);
    }
    clear() { this.alertPartial = false; this.planets.set(undefined); this.battles.clear(); this.revisions.clear(); this.clusters.clear(); this.systems.clear(); }
}
function adjust(map, id, kind, delta) {
    let count = map.get(id);
    if (!count) {
        count = { own: 0, ally: 0 };
        map.set(id, count);
    }
    count[kind] += delta;
    if (count.own + count.ally === 0)
        map.delete(id);
}
//# sourceMappingURL=signals.js.map