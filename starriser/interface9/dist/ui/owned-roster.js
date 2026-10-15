import { bindText, setText } from './dom-bindings.js';
/** Own fleet locations are summaries; names come only from authorized topology. */
export function createOwnedRoster(parent, onView, onJourney) {
    const root = document.createElement('section');
    root.className = 'online-owned-roster';
    root.innerHTML = '<h2>Your fleets across the galaxy</h2><p class="roster-status" role="status">Fleet roster loading…</p><ul></ul><button type="button" class="roster-first">First page</button><button type="button" class="roster-next" hidden>Next page</button>';
    parent.append(root);
    const list = root.querySelector('ul'), status = bindText(root.querySelector('p'));
    const first = root.querySelector('.roster-first'), next = root.querySelector('.roster-next');
    const rows = new Map();
    function createRow(id) {
        const element = document.createElement('li');
        element.dataset.fleetId = id;
        const label = document.createElement('span'), button = document.createElement('button'), journey = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Select fleet';
        journey.type = 'button';
        journey.textContent = 'Journey';
        journey.hidden = !onJourney;
        journey.setAttribute('aria-label', `Journey for fleet ${id.slice(-6)}`);
        journey.addEventListener('click', () => onJourney?.(id));
        element.append(label, button, journey);
        const row = { element, label: bindText(label), button, action: bindText(button), system: '', canView: false, resident: false };
        // A named location is a navigation request, never a detail grant.
        button.addEventListener('click', () => { if (row.canView)
            onView(row.system, id); });
        return row;
    }
    function updateRow(row, fleet, names) {
        const location = fleet.location;
        row.resident = location.kind === 'resident';
        setText(row.action, 'Select fleet');
        row.system = location.kind === 'resident' ? location.systemId : location.destinationSystemId;
        // Own roster locations may be outside the current viewport. Navigation asks
        // the server for that region; a summary is never treated as a detail grant.
        row.canView = !!row.system;
        row.button.hidden = !row.canView;
        const name = names.get(row.system) ?? `system ${row.system.slice(-6)}`;
        const activity = location.kind === 'transit' ? 'in transit to ' : location.moving ? 'moving in ' : '';
        const members = fleet.memberCount === undefined ? '' : ` · ${fleet.memberCount.toLocaleString()} ships`;
        const label = `Fleet ${fleet.id.slice(-6)}${members} · ${activity}${name}`;
        setText(row.label, label);
        if (row.element.title !== label)
            row.element.title = label;
    }
    function render(page, names) {
        setText(status, page.total ? `${page.total} owned fleets` : 'No owned fleets');
        next.hidden = page.nextOffset === null;
        const live = new Set();
        let cursor = list.firstChild;
        for (const fleet of page.fleets) {
            live.add(fleet.id);
            let row = rows.get(fleet.id);
            if (!row) {
                row = createRow(fleet.id);
                rows.set(fleet.id, row);
            }
            updateRow(row, fleet, names);
            if (cursor !== row.element)
                list.insertBefore(row.element, cursor);
            cursor = row.element.nextSibling;
        }
        for (const [id, row] of rows)
            if (!live.has(id)) {
                row.element.remove();
                rows.delete(id);
            }
    }
    return { first, next, render,
        clear(message = 'Fleet roster unavailable') { rows.clear(); list.replaceChildren(); next.hidden = true; setText(status, message); },
        dispose() { rows.clear(); root.remove(); },
    };
}
//# sourceMappingURL=owned-roster.js.map