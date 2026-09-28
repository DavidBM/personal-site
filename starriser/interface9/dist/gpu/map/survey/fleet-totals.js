import { FLEET_RELATIONSHIPS, fleetRelationship } from '../../../contracts/fleet-relationship.js';
const EMPTY = Object.freeze({ fleets: 0, transit: 0, inbound: 0 });
const EMPTY_SYSTEM = Object.freeze({ fleets: 0, inbound: 0, outbound: 0 });
/** Event-maintained strategic counts, independent of duplicate departure visuals. */
export class ClusterFleetTotals {
    constructor() {
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
    set(id, state, relation) {
        this.delete(id);
        const jumping = state.state === 'jumping';
        const cluster = jumping ? state.endNode.clusterId : state.node.clusterId;
        const kind = membershipKind(state, cluster);
        const system = jumping ? state.endNode.solarSystemId : state.node.solarSystemId;
        const source = jumping ? state.startNode.solarSystemId : null;
        const sourceCluster = jumping && state.startNode.clusterId !== cluster ? state.startNode.clusterId : null;
        const relationship = FLEET_RELATIONSHIPS.indexOf(fleetRelationship(relation));
        const member = { cluster, kind, system, source, sourceCluster, relationship };
        this.members.set(id, member);
        this.adjustRelationships(member, 1);
        this.adjustSystem(system, jumping ? 'inbound' : 'fleets', 1);
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
        const member = this.members.get(id);
        if (!member)
            return;
        this.adjustRelationships(member, -1);
        this.adjustSystem(member.system, member.source === null ? 'fleets' : 'inbound', -1);
        if (member.source !== null)
            this.adjustSystem(member.source, 'outbound', -1);
        const total = this.totals.get(member.cluster);
        total[member.kind]--;
        if (total.fleets + total.transit + total.inbound === 0)
            this.totals.delete(member.cluster);
        this.members.delete(id);
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
        this.members.clear();
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
//# sourceMappingURL=fleet-totals.js.map