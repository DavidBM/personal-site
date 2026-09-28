import { bindText, setText } from './dom-bindings.js';
export function createStrategicOverview(parent) {
    const root = document.createElement('section');
    root.className = 'online-overview';
    root.innerHTML = `<h2>System overview</h2><p>Fleets here includes all visible fleets, not only yours.</p>
    <p class="online-detail"></p><div class="online-overview-scroll"><table><thead><tr><th>System</th><th>Fleets here</th><th>Moving</th><th></th></tr></thead>
    <tbody></tbody></table></div><p class="online-overview-page"></p>
    <button type="button" data-overview="previous">Previous systems</button><button type="button" data-overview="next">Next systems</button>`;
    parent.prepend(root);
    const body = root.querySelector('tbody'), detail = bindText(root.querySelector('.online-detail'));
    const pageText = bindText(root.querySelector('.online-overview-page'));
    const previous = root.querySelector('[data-overview="previous"]');
    const next = root.querySelector('[data-overview="next"]');
    let hosted = new Set();
    const rows = new Map();
    let navigate = () => { };
    function cellText(row) {
        const label = document.createElement('span');
        row.insertCell().append(label);
        return bindText(label);
    }
    function createRow(id) {
        const element = document.createElement('tr');
        element.dataset.systemId = id;
        const name = cellText(element), count = cellText(element), moving = cellText(element);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'View';
        button.addEventListener('click', () => { if (hosted.has(id))
            navigate(id); });
        element.insertCell().append(button);
        return { element, name, count, moving, button };
    }
    function render(snapshot) {
        const values = new Map(snapshot?.systems.map(value => [value.scope.systemId, value]));
        for (const [id, cells] of rows) {
            const counts = snapshot?.status === 'view' && values.get(id)?.counts;
            const count = counts ? String(counts.presentFleets) : hosted.has(id) ? 'Unavailable' : 'Unavailable on this connection';
            setText(cells.count, count);
            if (cells.element.title !== count)
                cells.element.title = count;
            setText(cells.moving, counts ? String(counts.movingFleets) : '—');
        }
    }
    function syncRows(systems) {
        const live = new Set();
        let cursor = body.firstChild;
        for (const system of systems) {
            live.add(system.id);
            let row = rows.get(system.id);
            if (!row) {
                row = createRow(system.id);
                rows.set(system.id, row);
            }
            setText(row.name, system.name);
            row.button.hidden = !hosted.has(system.id);
            if (cursor !== row.element)
                body.insertBefore(row.element, cursor);
            cursor = row.element.nextSibling;
        }
        for (const [id, row] of rows)
            if (!live.has(id)) {
                row.element.remove();
                rows.delete(id);
            }
    }
    return {
        previous, next,
        onView(callback) { navigate = callback; },
        page(topology, current, offset) {
            const systems = topology.systems.slice(offset, offset + 32);
            hosted = new Set(topology.hostedSystemIds);
            setText(detail, `Detailed view: ${topology.systems.find(value => value.id === current)?.name ?? current}`);
            syncRows(systems);
            setText(pageText, `${systems.length ? offset + 1 : 0}–${offset + systems.length} of ${topology.systems.length} systems`);
            previous.disabled = offset === 0;
            next.disabled = offset + 32 >= topology.systems.length;
            render();
            return systems.filter(value => hosted.has(value.id)).map(value => value.id);
        },
        render, clear() {
            rows.clear();
            hosted.clear();
            body.replaceChildren();
            setText(detail, 'Detailed view unavailable');
            setText(pageText, '');
            previous.disabled = true;
            next.disabled = true;
        },
    };
}
//# sourceMappingURL=strategic-overview.js.map