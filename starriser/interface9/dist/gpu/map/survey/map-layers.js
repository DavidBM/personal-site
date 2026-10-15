import { mapLayers } from '../../../contracts/map-layers.js';
const OWN = [.25, .6, 1], GREEN = [.25, .95, .5], RED = [1, .22, .25], DARK_RED = [.65, .07, .12];
const BLACK = [0, 0, 0];
/** Ownership changes rebuild indexes once; drawing visits visible anchors only. */
export class MapLayerSignals {
    constructor() {
        this.options = mapLayers(null);
        this.clusters = new Map();
        this.systems = new Map();
        this.seen = new Set();
        this.rows = new Map();
        this.pins = [];
    }
    set(rows, reset = true) {
        if (reset) {
            this.clusters.clear();
            this.systems.clear();
            this.seen.clear();
            this.rows.clear();
        }
        const seen = this.seen;
        for (const row of rows) {
            if (seen.has(row.body))
                continue;
            seen.add(row.body);
            if (row.relationship === 'own') {
                let list = this.rows.get(row.node.clusterId);
                if (!list) {
                    list = [];
                    this.rows.set(row.node.clusterId, list);
                }
                list.push(row);
            }
            for (const [map, key] of [[this.clusters, row.node.clusterId], [this.systems, row.node.solarSystemId]]) {
                let count = map.get(key);
                if (!count) {
                    count = { own: 0, enemy: 0 };
                    map.set(key, count);
                }
                count[row.relationship]++;
            }
        }
    }
    count() { return this.seen.size; }
    ownedCount(cluster, system) { return (system === undefined ? this.clusters : this.systems).get(system ?? cluster)?.own ?? 0; }
    planetRows(cluster, system, offset, limit) {
        const rows = [];
        let skip = offset;
        for (const row of this.rows.get(cluster) ?? []) {
            if (system !== undefined && row.node.solarSystemId !== system)
                continue;
            if (skip-- > 0)
                continue;
            rows.push({ id: row.body, name: 'Your planet ' + row.body.slice(0, 8), systemId: row.node.solarSystemId, clusterId: row.node.clusterId, onlineSystemId: row.system, kind: 'owned planet' });
            if (rows.length >= limit)
                break;
        }
        return rows;
    }
    color(a, totals) {
        if (!this.options[a.systemId === undefined ? 'galaxy' : 'cluster'].systemColors)
            return;
        const colonies = (a.systemId === undefined ? this.clusters : this.systems).get(a.systemId ?? a.meta.clusterId);
        if (colonies?.enemy)
            return DARK_RED;
        if (totals.getRelationships(a.systemId ?? a.meta.clusterId, a.systemId !== undefined)[0])
            return RED;
        if (colonies?.own)
            return GREEN;
    }
    /** Sort only visible owned pins; keep layout admission order and reusable anchors intact. */
    drawVisible(anchors, totals, ink, detail, width, dockedId) {
        const pins = this.pins;
        pins.length = 0;
        for (const a of anchors) {
            if (dockedId !== undefined && a.systemId === dockedId)
                continue;
            if (this.flags(a, totals))
                pins.push(a);
        }
        pins.sort(farFirst);
        // A stalk must never cut through a readable panel, even when its anchor is
        // nearer. Heads retain camera-depth ordering and matching hit priority.
        for (const a of pins)
            this.draw(a, totals, ink, detail, width, 'stem');
        for (const a of pins)
            this.draw(a, totals, ink, detail, width, 'head');
    }
    flags(a, totals) {
        const id = a.systemId ?? a.meta.clusterId;
        const owned = totals.getRelationships(id, a.systemId !== undefined)[3];
        const colonies = (a.systemId === undefined ? this.clusters : this.systems).get(id);
        const options = this.options[a.systemId === undefined ? 'galaxy' : 'cluster'];
        const fleet = options.ownFleets && owned > 0, planet = options.ownPlanets && (colonies?.own ?? 0) > 0;
        return (fleet ? 1 : 0) | (planet ? 2 : 0);
    }
    draw(a, totals, ink, detail, width = Infinity, part = 'all') {
        const flags = this.flags(a, totals);
        if (!flags)
            return;
        this.pin(a, ink, detail, width, !!(flags & 1), !!(flags & 2), part);
    }
    pin(a, ink, detail, width, fleet, planet, part) {
        // Screen-facing heads retain their size. Stems land on the projected map point;
        // the icon rises above this location's ribbons, including at tilted camera angles.
        const radius = a.label ? Math.max(22, a.radius) : a.radius;
        // Leave the central 32px selected-fleet pin and its count ribbon unobstructed.
        const lift = Math.max(64, 32 + radius * (a.label ? 1.7320508 : 0.8660254) * detail);
        const spread = fleet && planet ? 14 : 0, x = Math.max(16 + spread, Math.min(width - 16 - spread, a.x));
        const y = a.y - lift >= 16 ? a.y - lift : a.y + lift;
        if (part !== 'head')
            this.stem(a, ink, x, y, fleet, planet);
        if (part === 'stem')
            return;
        if (fleet)
            this.cell(a, ink, x + spread, y, OWN, 2, 'fleets');
        if (planet)
            this.cell(a, ink, x - spread, y, GREEN, 8, 'planets');
    }
    stem(a, ink, x, y, fleet, planet) {
        const end = y + (y < a.y ? 14 : -14), offset = fleet && planet ? 1.25 : 0, color = fleet ? OWN : GREEN;
        // One straight stalk with parallel relationship rails, above the map ink.
        // Only screen-edge clamping needs a horizontal join.
        ink.edge(a.x, a.y, a.x, end, BLACK, .9, offset ? 5.5 : 3.5);
        if (planet)
            ink.edge(a.x - offset, a.y, a.x - offset, end, GREEN, .95, 1.5);
        if (fleet)
            ink.edge(a.x + offset, a.y, a.x + offset, end, OWN, .95, 1.5);
        if (x !== a.x) {
            ink.edge(a.x, end, x, end, BLACK, .9, 3.5);
            ink.edge(a.x, end, x, end, color, .95, 1.5);
        }
        ink.dot(a.x, a.y, 2.5, color, 1, 1.5);
    }
    cell(a, ink, x, y, color, symbol, section) {
        // Adjacent full rectangles form one panel. side=2 belongs to hex hit geometry;
        // using it as a ribbon would incorrectly clip half the background.
        ink.ribbon(x - 14, y - 14, 28, 28, 0, 0, 0, color, 1, a.meta.clusterId, section, a.systemId, true);
        ink.icon(x, y, 10, color, 1, symbol);
    }
}
function farFirst(a, b) { return b.depth - a.depth; }
//# sourceMappingURL=map-layers.js.map