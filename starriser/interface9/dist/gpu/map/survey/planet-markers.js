import { FLEET_PIN_SYMBOL } from './fleet-pin.js';
import { incomingScreen } from './incoming-markers.js';
const GREEN = [.25, .95, .5], YELLOW = [1, .82, .2], RED = [1, .22, .25], BLUE = [.25, .6, 1], BLACK = [0, 0, 0], CYAN = [.35, .88, 1], HOVER = [.9, .98, 1];
function inside(x, y, left, top, width, height) { return x >= left && x <= left + width && y >= top && y <= top + height; }
/** Only settled, explicitly assigned fleets can merge with a planet label. */
export function markerOrbitBody(fleet) {
    if (fleet.remote)
        return fleet.remote.moving ? undefined : fleet.remote.orbit?.bodyIndex;
    const state = fleet.state;
    if (!state || state.state !== 'awaiting' || state.localMove || state.position)
        return;
    return state.orbit?.bodyIndex ?? fleet.bodyIndex;
}
/** Sparse planet labels; cached text and fleet chips, bounded by scene fleet admission. */
export class PlanetMarkers {
    constructor() {
        this.catalogs = new Map();
        this.rows = [];
        this.key = '';
        this.dirty = true;
        this.byBody = new Map();
        this.chips = new Map();
        this.visible = [];
        /** Only actually drawn chips suppress the ordinary GPU fleet badges. */
        this.mergedFleetIds = new Set();
    }
    set(system, value) { this.current = system !== undefined && value ? { system, value } : undefined; this.dirty = true; }
    catalog(value) { if (!value)
        this.catalogs.clear();
    else {
        if (this.catalogs.size >= 512)
            this.catalogs.delete(this.catalogs.keys().next().value);
        this.catalogs.set(value.systemId, value);
    } this.dirty = true; }
    sync(system, ids, mock) {
        const key = system + ':' + mock;
        if (!this.dirty && this.key === key)
            return;
        this.key = key;
        this.dirty = false;
        const value = this.current?.system === system ? this.current.value : undefined, catalog = this.catalogs.get(system);
        this.byBody.clear();
        this.rows = ids.flatMap((id, index) => {
            if (index === 0)
                return [];
            const body = catalog?.bodies.find(b => b.catalogId === id), owner = body && value?.owners.find(o => o[0] === body.id);
            const ships = value?.direct ? value.stationed.find(s => s[0] === index) : undefined;
            const name = owner ? owner[2] : mock ? 'Unclaimed' : body && value ? 'Unclaimed' : 'Owner unknown';
            const color = owner?.[3] === 'own' ? GREEN : owner?.[3] === 'enemy' ? RED : YELLOW;
            const own = ships?.[1] ? ships[1].toLocaleString('en-US') : '', neutral = ships?.[2] ? ships[2].toLocaleString('en-US') : '';
            const width = Math.max(100, Math.min(32, name.length) * 6 + 32, (own.length + neutral.length) * 6 + (own && neutral ? 64 : 32));
            const row = { index, catalogId: id, left: 0, top: 0, height: 0, name: name.slice(0, 32).toUpperCase(), color, own, neutral, x: 0, y: 0, depth: 0, width, nameWidth: width, chips: [] };
            this.byBody.set(index, row);
            return [row];
        });
    }
    canShowFleets(system, mock) { return mock || this.current?.system === system && this.current.value.direct; }
    assignFleets(system, mock, fleets, show) {
        for (const row of this.rows)
            row.chips.length = 0;
        for (const chip of this.chips.values())
            chip.seen = false;
        const allowed = show && this.canShowFleets(system, mock);
        if (allowed)
            for (const fleet of fleets)
                this.assignFleet(system, fleet);
        for (const [id, chip] of this.chips)
            if (!chip.seen)
                this.chips.delete(id);
    }
    assignFleet(system, fleet) {
        if (!fleet.id || fleet.systemId !== system || fleet.shipCount <= 0)
            return;
        const body = markerOrbitBody(fleet), row = body === undefined ? undefined : this.byBody.get(body);
        if (!row)
            return;
        let chip = this.chips.get(fleet.id);
        if (!chip) {
            chip = { id: fleet.id, count: -1, text: '', color: YELLOW, left: 0, top: 0, width: 0, seen: true };
            this.chips.set(fleet.id, chip);
        }
        const count = fleet.domainShipCount ?? fleet.shipCount;
        if (chip.count !== count) {
            chip.count = count;
            chip.text = chip.count.toLocaleString('en-US');
            chip.width = chip.text.length * 6 + 42;
        }
        chip.color = fleet.marker ?? BLUE;
        chip.seen = true;
        row.chips.push(chip);
    }
    clearHits() { this.visible.length = 0; this.mergedFleetIds.clear(); }
    pick(x, y) {
        for (let i = this.visible.length - 1; i >= 0; i--) {
            const r = this.visible[i];
            for (const c of r.chips)
                if (inside(x, y, c.left, c.top, c.width, 24))
                    return { kind: 'fleet', id: c.id };
            if (inside(x, y, r.left, r.top, r.width, 26))
                return { kind: 'body', index: r.index, catalogId: r.catalogId };
        }
        return null;
    }
    drawLabel(row, width, ink, showAll, selected, hovered) {
        const chips = row.chips;
        let cellWidth = 64;
        for (const chip of chips)
            cellWidth = Math.max(cellWidth, chip.width + 4);
        const columns = Math.max(1, Math.min(3, Math.floor((width - 8) / cellWidth)));
        const ships = showAll && (row.own || row.neutral);
        row.width = Math.max(row.nameWidth, Math.min(columns, chips.length) * cellWidth);
        row.height = 26 + (chips.length ? Math.ceil(chips.length / columns) * 28 : ships ? 20 : 0);
        const x = Math.max(4, Math.min(width - row.width - 4, row.x - row.width / 2)), y = Math.max(4, row.y - row.height - 20);
        row.left = x;
        row.top = y;
        ink.plate(x, y, row.width, 26, row.color);
        ink.icon(x + 13, y + 13, 9, row.color, 1, 8);
        ink.text(row.name, x + 26, y + 5, row.color, 1);
        this.drawChips(row, columns, cellWidth, ink, selected, hovered);
        if (!chips.length && ships)
            this.drawSummary(row, x, y, ink);
    }
    drawChips(row, columns, cellWidth, ink, selected, hovered) {
        for (let i = 0; i < row.chips.length; i++) {
            const chip = row.chips[i];
            chip.left = row.left + (i % columns) * cellWidth;
            chip.top = row.top + 28 + Math.floor(i / columns) * 28;
            const chosen = chip.id === selected?.renderId, color = chip.id === hovered ? HOVER : chosen ? CYAN : chip.color;
            ink.plate(chip.left + 11, chip.top + 2, chip.width - 11, 20, color);
            ink.icon(chip.left + 12, chip.top + 12, chosen ? 12 : 10, color, 1, chosen ? FLEET_PIN_SYMBOL[selected.state] : 2);
            ink.text(chip.text, chip.left + 29, chip.top + 4, color, 1);
            this.mergedFleetIds.add(chip.id);
        }
    }
    drawSummary(row, x, y, ink) {
        let dx = x + 13;
        if (row.own) {
            ink.icon(dx, y + 36, 8, BLUE, 1, 2);
            ink.text(row.own, dx + 13, y + 28, BLUE, 1);
            dx += row.own.length * 6 + 34;
        }
        if (row.neutral) {
            ink.icon(dx, y + 36, 8, YELLOW, 1, 2);
            ink.text(row.neutral, dx + 13, y + 28, YELLOW, 1);
        }
    }
    showLabel(row, all, own) { return all || own && row.color === GREEN; }
    draw(system, ids, mock, matrix, position, width, height, ink, showAll, showOwn, fleets = [], selected, hovered = null) {
        this.sync(system, ids, mock);
        this.assignFleets(system, mock, fleets, showAll);
        this.clearHits();
        const visible = this.visible;
        for (const row of this.rows) {
            if (!this.showLabel(row, showAll, showOwn))
                continue;
            const p = position(row.index);
            if (!p || !incomingScreen(matrix, p, width, height, row))
                continue;
            row.depth = matrix[3] * p[0] + matrix[7] * p[1] + matrix[11] * p[2] + matrix[15];
            visible.push(row);
        }
        visible.sort((a, b) => b.depth - a.depth);
        for (const row of visible) {
            ink.edge(row.x, row.y, row.x, row.y - 32, BLACK, 1, 4);
            ink.edge(row.x, row.y, row.x, row.y - 32, row.color, 1, 1.5);
            ink.dot(row.x, row.y, 2.5, row.color, 1, 1.5);
        }
        for (const row of visible)
            this.drawLabel(row, width, ink, showAll, selected, hovered);
    }
}
//# sourceMappingURL=planet-markers.js.map