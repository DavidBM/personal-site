import { ShipTotals, shipCount } from './ship-totals.js';
import { FLEET_RELATIONSHIPS, fleetRelationship } from '../../../contracts/fleet-relationship.js';
const EMPTY = Object.freeze({ fleets: 0, transit: 0, inbound: 0 });
const EMPTY_SYSTEM = Object.freeze({ fleets: 0, inbound: 0, outbound: 0 });
/** Event-maintained strategic counts, independent of duplicate departure visuals. */
export class ClusterFleetTotals {
    constructor() {
        this.ships = new ShipTotals();
        this.localJumps = new Map();
        this.localJumpRevision = 0;
        this.roster = new Map();
        this.visuals = new Map();
        this.clusterMembers = new Map();
        this.members = new Map();
        this.totals = new Map();
        this.systems = new Map();
        this.clusterRelationships = new Map();
        this.systemRelationships = new Map();
        this.outbound = new Map();
    }
    hasCluster(id) { return this.clusterRelationships.has(id); }
    hasSystem(id) { return this.systemRelationships.has(id); }
    getOutbound(id) { return this.outbound.get(id) ?? 0; }
    getRelationships(id, system = false) {
        return (system ? this.systemRelationships : this.clusterRelationships).get(id) ?? EMPTY_RELATIONSHIPS;
    }
    getSystem(id) { return this.systems.get(id) ?? EMPTY_SYSTEM; }
    get(id) { return this.totals.get(id) ?? EMPTY; }
    set(id, state, relation, counts, persistentId) {
        this.delete(id);
        if (!persistentId && relation === 'own' && state.state === 'jumping') {
            this.localJumps.set(id, state);
            this.localJumpRevision++;
        }
        const visual = { state, relation, counts, persistentId };
        this.visuals.set(id, visual);
        this.publishVisual(id, visual);
    }
    publishVisual(id, v) {
        if (!v.persistentId || !this.roster.has(v.persistentId))
            this.insert(id, v.state, v.relation, v.counts);
    }
    /** Owned roster facts survive scene eviction; detail incarnations never count twice. */
    setRoster(rows) {
        for (const id of this.roster.keys())
            this.remove(`roster:${id}`);
        for (const id of this.visuals.keys())
            this.remove(id);
        this.roster.clear();
        for (const row of rows) {
            this.roster.set(row.id, row);
            const state = row.source ? { state: 'jumping', startNode: row.source, endNode: row.node, startTime: 0, durationMs: 1 }
                : { state: 'awaiting', node: row.node };
            const counts = row.ships === undefined ? undefined : { red: row.ships, green: 0, blue: 0 };
            this.insert(`roster:${row.id}`, state, 'own', counts);
        }
        for (const [id, visual] of this.visuals)
            this.publishVisual(id, visual);
    }
    rosterRow(id) { return id.startsWith('roster:') ? this.roster.get(id.slice(7)) : undefined; }
    clearVisuals() { this.localJumps.clear(); this.localJumpRevision++; for (const id of this.visuals.keys())
        this.remove(id); this.visuals.clear(); }
    insert(id, state, relation, counts) {
        this.remove(id);
        if (emptyFleet(counts))
            return;
        const member = membership(id, state, relation, counts);
        const { cluster, kind, system, source, sourceCluster } = member;
        this.members.set(id, member);
        this.indexMember(cluster, id, true);
        if (sourceCluster !== null)
            this.indexMember(sourceCluster, id, true);
        this.adjustRelationships(member, 1);
        this.adjustShips(member, 1);
        this.adjustSystem(system, source !== null ? 'inbound' : 'fleets', 1);
        if (source !== null)
            this.adjustSystem(source, 'outbound', 1);
        let total = this.totals.get(cluster);
        if (!total) {
            total = { fleets: 0, transit: 0, inbound: 0 };
            this.totals.set(cluster, total);
        }
        total[kind]++;
    }
    delete(id) {
        if (this.localJumps.delete(id))
            this.localJumpRevision++;
        this.visuals.delete(id);
        this.remove(id);
    }
    remove(id) {
        const member = this.members.get(id);
        if (!member)
            return;
        this.adjustRelationships(member, -1);
        this.adjustShips(member, -1);
        this.adjustSystem(member.system, member.source === null ? 'fleets' : 'inbound', -1);
        if (member.source !== null)
            this.adjustSystem(member.source, 'outbound', -1);
        const total = this.totals.get(member.cluster);
        total[member.kind]--;
        if (total.fleets + total.transit + total.inbound === 0)
            this.totals.delete(member.cluster);
        this.members.delete(id);
        this.indexMember(member.cluster, id, false);
        if (member.sourceCluster !== null)
            this.indexMember(member.sourceCluster, id, false);
    }
    /** Visit one indexed cluster only; return at most 64 identities on explicit UI requests. */
    page(cluster, section, offset, limit, systemId, owned = false) {
        const result = [];
        let skip = Math.max(0, offset | 0);
        const count = Math.max(1, Math.min(64, limit | 0));
        for (const id of this.clusterMembers.get(cluster) ?? []) {
            const member = this.members.get(id);
            if (owned ? !matchesOwned(member, cluster, section, systemId) : !matchesScope(member, cluster, section, systemId))
                continue;
            if (skip-- > 0)
                continue;
            result.push(id);
            if (result.length === count)
                break;
        }
        return result;
    }
    ownedCount(cluster, section, systemId) {
        let count = 0;
        for (const id of this.clusterMembers.get(cluster) ?? []) {
            const m = this.members.get(id);
            if (matchesOwned(m, cluster, section, systemId))
                count++;
        }
        return count;
    }
    adjustShips(m, delta) {
        if (m.kind !== 'inbound')
            this.ships.adjust(m.cluster, false, m.ships, m.relationship, delta);
        if (m.source === null)
            this.ships.adjust(m.system, true, m.ships, m.relationship, delta);
    }
    indexMember(cluster, id, add) {
        let ids = this.clusterMembers.get(cluster);
        if (add) {
            if (!ids) {
                ids = new Set();
                this.clusterMembers.set(cluster, ids);
            }
            ids.add(id);
        }
        else if (ids) {
            ids.delete(id);
            if (!ids.size)
                this.clusterMembers.delete(cluster);
        }
    }
    adjustSystem(id, kind, delta) {
        let total = this.systems.get(id);
        if (!total) {
            total = { fleets: 0, inbound: 0, outbound: 0 };
            this.systems.set(id, total);
        }
        total[kind] += delta;
        if (total.fleets + total.inbound + total.outbound === 0)
            this.systems.delete(id);
    }
    adjustRelationships(m, delta) {
        adjustMix(this.clusterRelationships, m.cluster, m.relationship, delta);
        adjustMix(this.systemRelationships, m.system, m.relationship, delta);
        if (m.source !== null && m.source !== m.system)
            adjustMix(this.systemRelationships, m.source, m.relationship, delta);
        if (m.sourceCluster !== null) {
            adjustMix(this.clusterRelationships, m.sourceCluster, m.relationship, delta);
            const count = (this.outbound.get(m.sourceCluster) ?? 0) + delta;
            if (count)
                this.outbound.set(m.sourceCluster, count);
            else
                this.outbound.delete(m.sourceCluster);
        }
    }
    clear() {
        this.localJumps.clear();
        this.localJumpRevision++;
        this.roster.clear();
        this.visuals.clear();
        this.ships.clear();
        this.members.clear();
        this.clusterMembers.clear();
        this.totals.clear();
        this.systems.clear();
        this.clusterRelationships.clear();
        this.systemRelationships.clear();
        this.outbound.clear();
    }
}
const EMPTY_RELATIONSHIPS = Object.freeze([0, 0, 0, 0]);
function adjustMix(map, id, relationship, delta) {
    let counts = map.get(id);
    if (!counts) {
        counts = [0, 0, 0, 0];
        map.set(id, counts);
    }
    counts[relationship] += delta;
    if (counts.every(count => count === 0))
        map.delete(id);
}
function membershipKind(state, cluster) {
    if (state.state !== 'jumping')
        return 'fleets';
    return state.startNode.clusterId === cluster ? 'transit' : 'inbound';
}
function matches(m, cluster, section) {
    if (section === 'outbound')
        return m.sourceCluster === cluster;
    if (m.cluster !== cluster)
        return false;
    return section === 'inbound' ? m.kind === 'inbound' : m.kind !== 'inbound';
}
function matchesScope(m, cluster, section, systemId) {
    if (systemId === undefined)
        return matches(m, cluster, section);
    if (section === 'outbound')
        return m.source === systemId;
    if (m.system !== systemId)
        return false;
    return section === 'inbound' ? m.source !== null : m.source === null;
}
function emptyFleet(counts) { return !!counts && counts.red + counts.blue + counts.green === 0; }
function membership(id, state, relation, counts) {
    const jumping = state.state === 'jumping';
    const cluster = jumping ? state.endNode.clusterId : state.node.clusterId;
    const kind = membershipKind(state, cluster);
    const system = jumping ? state.endNode.solarSystemId : state.node.solarSystemId;
    const source = jumping ? state.startNode.solarSystemId : null;
    const sourceCluster = jumping && state.startNode.clusterId !== cluster ? state.startNode.clusterId : null;
    const relationship = FLEET_RELATIONSHIPS.indexOf(fleetRelationship(relation));
    return { cluster, kind, system, source, sourceCluster, relationship, ships: shipCount(counts) };
}
function matchesOwned(m, cluster, section, system) {
    if (m.relationship !== 3)
        return false;
    if (section === 'fleets')
        return system === undefined ? (m.cluster === cluster || m.sourceCluster === cluster) : (m.system === system || m.source === system);
    return matchesScope(m, cluster, section, system);
}
//# sourceMappingURL=fleet-totals.js.map