import { SURVEY_PLANET_SYSTEM_LIMIT } from '../../../contracts/survey-signals.js';
/** Accepted catalogs survive detail selection. Aggregate updates happen on messages, never per frame. */
export class SurveyPlanetTotals {
    constructor() {
        this.systems = new Map();
        this.clusters = new Map();
    }
    set(value) {
        if (!value) {
            this.systems.clear();
            this.clusters.clear();
            return;
        }
        this.remove(value.systemId);
        if (!value.bodies.length)
            return;
        if (this.systems.size >= SURVEY_PLANET_SYSTEM_LIMIT)
            this.remove(this.systems.keys().next().value);
        this.systems.set(value.systemId, value);
        this.clusters.set(value.clusterId, (this.clusters.get(value.clusterId) ?? 0) + value.bodies.length);
    }
    remove(systemId) {
        const old = this.systems.get(systemId);
        if (!old)
            return;
        const total = this.clusters.get(old.clusterId) - old.bodies.length;
        if (total)
            this.clusters.set(old.clusterId, total);
        else
            this.clusters.delete(old.clusterId);
        this.systems.delete(systemId);
    }
    count(clusterId, systemId) {
        if (systemId === undefined)
            return this.clusters.get(clusterId) ?? 0;
        const system = this.systems.get(systemId);
        return system?.clusterId === clusterId ? system.bodies.length : 0;
    }
    rows(scope, offset, limit) {
        const result = [];
        for (const system of this.systems.values()) {
            if (system.clusterId !== scope.clusterId || (scope.systemId !== undefined && system.systemId !== scope.systemId))
                continue;
            for (const body of system.bodies) {
                if (offset-- > 0)
                    continue;
                if (result.length >= limit)
                    return result;
                result.push({ ...body, systemId: system.systemId, clusterId: system.clusterId, onlineSystemId: system.onlineSystemId });
            }
        }
        return result;
    }
}
//# sourceMappingURL=planet-totals.js.map