export function createStrategicOverview(parent) {
    const root = document.createElement('section');
    root.className = 'online-overview';
    root.innerHTML = `<h2>System overview</h2><p>Ships here includes all visible ships, not only yours.</p>
    <p class="online-detail"></p><div class="online-overview-scroll"><table><thead><tr><th>System</th><th>Ships here</th><th>Moving</th><th></th></tr></thead>
    <tbody></tbody></table></div><p class="online-overview-page"></p>
    <button type="button" data-overview="previous">Previous systems</button><button type="button" data-overview="next">Next systems</button>`;
    parent.prepend(root);
    let systems = [];
    let hosted = new Set();
    const rows = new Map();
    let navigate = () => { };
    function render(snapshot) {
        const values = new Map(snapshot?.systems.map(value => [value.scope.systemId, value]));
        for (const [id, cells] of rows) {
            const counts = snapshot?.status === 'view' && values.get(id)?.counts;
            cells.count.textContent = counts ? String(counts.presentShips) : hosted.has(id) ? 'Unavailable' : 'Unavailable on this connection';
            cells.moving.textContent = counts ? String(counts.movingShips) : '—';
        }
    }
    return {
        previous: root.querySelector('[data-overview="previous"]'),
        next: root.querySelector('[data-overview="next"]'),
        onView(callback) { navigate = callback; },
        page(topology, current, offset) {
            systems = topology.systems.slice(offset, offset + 32);
            hosted = new Set(topology.hostedSystemIds);
            rows.clear();
            root.querySelector('.online-detail').textContent = `Detailed view: ${topology.systems.find(value => value.id === current)?.name ?? current}`;
            const body = root.querySelector('tbody');
            body.replaceChildren();
            for (const system of systems) {
                const row = body.insertRow();
                row.dataset.systemId = system.id;
                row.insertCell().textContent = system.name;
                rows.set(system.id, { count: row.insertCell(), moving: row.insertCell() });
                const cell = row.insertCell();
                if (hosted.has(system.id)) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = 'View';
                    button.addEventListener('click', () => navigate(system.id));
                    cell.append(button);
                }
            }
            root.querySelector('.online-overview-page').textContent = `${offset + 1}–${offset + systems.length} of ${topology.systems.length} systems`;
            root.querySelector('[data-overview="previous"]').disabled = offset === 0;
            root.querySelector('[data-overview="next"]').disabled = offset + 32 >= topology.systems.length;
            render();
            return systems.filter(value => hosted.has(value.id)).map(value => value.id);
        },
        render, clear() {
            rows.clear();
            root.querySelector('tbody').replaceChildren();
            root.querySelector('.online-detail').textContent = 'Detailed view unavailable';
            root.querySelector('.online-overview-page').textContent = '';
            root.querySelector('[data-overview="previous"]').disabled = true;
            root.querySelector('[data-overview="next"]').disabled = true;
        },
    };
}
//# sourceMappingURL=strategic-overview.js.map