const EMPTY = { count: 0, relationships: [0, 0, 0, 0] };
export const shipCount = (counts) => counts ? counts.red + counts.blue + counts.green : 0;
/** Ship-weighted relationship totals, updated on publication/removal, never by a frame-time fleet walk. */
export class ShipTotals {
    constructor() {
        this.clusters = new Map();
        this.systems = new Map();
    }
    get(id, system = false) { return (system ? this.systems : this.clusters).get(id) ?? EMPTY; }
    adjust(id, system, count, relationship, delta) {
        const map = system ? this.systems : this.clusters;
        let total = map.get(id);
        if (!total) {
            total = { count: 0, relationships: [0, 0, 0, 0] };
            map.set(id, total);
        }
        total.count += count * delta;
        total.relationships[relationship] += count * delta;
        if (total.count === 0)
            map.delete(id);
    }
    clear() { this.clusters.clear(); this.systems.clear(); }
}
/** Render placeholders are not ship facts. Preserve accepted totals. */
export function surveyFleetCounts(visual) {
    if (!visual.remote)
        return visual.counts;
    const appearance = visual.remote.appearance;
    if (!appearance || (appearance.placeholder && appearance.totalShips === 0))
        return;
    return { red: appearance.totalShips, green: 0, blue: 0, classes: appearance.hullCounts };
}
//# sourceMappingURL=ship-totals.js.map