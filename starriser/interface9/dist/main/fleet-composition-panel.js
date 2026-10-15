import { hullClass } from '../contracts/hull-appearance.js';
import { bindText, setHidden, setText } from '../ui/dom-bindings.js';
const ROLES = ['Unknown', 'Interceptor', 'Fighter', 'Bomber', 'Frigate', 'Battleship', 'Colossus'];
const COLUMNS = ['Role', 'Ships', 'Hull model', 'Hull points', 'Shield', 'Attack', 'Cargo', 'Carried damage'];
const WIDTHS = ['100px', '70px', '160px', '90px', '70px', '70px', '70px', '110px'];
function groupRow(parent) {
    const row = document.createElement('tr');
    row.className = 'fleet-composition-row';
    row.hidden = true;
    const cells = COLUMNS.map((_, index) => {
        const cell = document.createElement('td'), label = document.createElement('span');
        cell.style.cssText = 'padding:5px 8px 5px 0;vertical-align:top';
        row.append(cell);
        cell.append(label);
        return bindText(label, { width: WIDTHS[index], height: '42px', lineHeight: '20px', wrap: true });
    });
    parent.append(row);
    return { row, cells };
}
function groupText(group) {
    const design = group.design;
    return [ROLES[design.role] ?? 'Unknown', String(group.count), design.hull.assetKey,
        String(design.hullPoints), String(design.shieldPoints), String(design.attackPoints), String(design.cargoUnits), String(group.damagePoints ?? 0)];
}
function updateGroup(row, group) {
    setHidden(row.row, !group);
    const values = group ? groupText(group) : [];
    for (let column = 0; column < row.cells.length; column++)
        setText(row.cells[column], values[column] ?? '');
}
function fleetStatus(fleet, groups) {
    if (!fleet)
        return 'Select one of your fleets to inspect its ships.';
    const members = groups ? groups.reduce((count, group) => count + group.count, 0) : fleet.memberCount;
    const prefix = members === undefined ? '' : `${members} ships · `;
    return groups ? `${prefix}${groups.length} ship ${groups.length === 1 ? 'group' : 'groups'}` : `${prefix}Composition unavailable.`;
}
/** A selected-fleet read projection. No grouping, counts or hulls are invented for legacy fleets. */
export function createFleetCompositionPanel(parent) {
    const root = document.createElement('details');
    root.className = 'online-fleet-composition';
    root.style.cssText = 'width:100%;contain:layout style paint;border-top:1px solid #3b586b;padding:10px 0';
    const summary = document.createElement('summary');
    summary.textContent = 'Fleet composition';
    root.append(summary);
    const status = document.createElement('p');
    status.className = 'fleet-composition-status';
    root.append(status);
    const statusText = bindText(status, { height: '42px', lineHeight: '20px', wrap: true });
    const viewport = document.createElement('div');
    viewport.style.cssText = 'max-height:280px;overflow:auto;contain:layout paint';
    root.append(viewport);
    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;table-layout:fixed;width:796px;font-variant-numeric:tabular-nums';
    table.setAttribute('aria-label', 'Selected fleet ship groups and per-ship attributes');
    viewport.append(table);
    const head = document.createElement('thead'), heading = document.createElement('tr');
    table.append(head);
    head.append(heading);
    for (let i = 0; i < COLUMNS.length; i++) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = COLUMNS[i];
        cell.style.cssText = `width:${WIDTHS[i]};text-align:left;padding:4px 8px 4px 0`;
        heading.append(cell);
    }
    const body = document.createElement('tbody');
    table.append(body);
    const rows = Array.from({ length: 16 }, () => groupRow(body));
    const note = document.createElement('p');
    root.append(note);
    const noteText = bindText(note, { height: '82px', lineHeight: '20px', wrap: true });
    parent.append(root);
    let disposed = false;
    function show(fleet) {
        if (disposed)
            return;
        const candidate = fleet?.composition, groups = candidate?.length && candidate.length <= rows.length ? candidate : undefined;
        setText(statusText, fleetStatus(fleet, groups));
        setHidden(viewport, !groups);
        setHidden(note, !groups);
        const placeholder = groups?.some(group => hullClass(group.design.hull.assetKey, group.design.hull.version) === undefined);
        setText(noteText, 'Carried damage affects one surviving ship per group; other stats are per ship.' + (placeholder ? ' A hull model is unavailable in this client; the fleet uses a placeholder appearance.' : ''));
        for (let i = 0; i < rows.length; i++)
            updateGroup(rows[i], groups?.[i]);
    }
    show(undefined);
    return { show, clear() { show(undefined); }, dispose() { if (disposed)
            return; show(undefined); disposed = true; root.remove(); } };
}
//# sourceMappingURL=fleet-composition-panel.js.map