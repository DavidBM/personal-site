/** Own fleet locations are summaries; names come only from authorized topology. */
export function createOwnedRoster(parent, onView) {
    const root = document.createElement('section');
    root.className = 'online-owned-roster';
    root.innerHTML = '<h2>Your fleets across the galaxy</h2><p class="roster-status" role="status">Fleet roster loading…</p><ul></ul><button type="button" class="roster-first">First page</button><button type="button" class="roster-next" hidden>Next page</button>';
    parent.append(root);
    const list = root.querySelector('ul'), status = root.querySelector('p');
    const first = root.querySelector('.roster-first'), next = root.querySelector('.roster-next');
    function render(page, names) {
        status.textContent = page.total ? `${page.total} owned fleets` : 'No owned fleets';
        next.hidden = page.nextOffset === null;
        list.replaceChildren(...page.fleets.map(fleet => {
            const row = document.createElement('li');
            row.dataset.fleetId = fleet.id;
            const location = fleet.location, system = location.kind === 'resident' ? location.systemId : location.destinationSystemId;
            const name = names.get(system) ?? `system ${system.slice(-6)}`;
            row.textContent = `Fleet ${fleet.id.slice(-6)} · ${location.kind === 'transit' ? 'in transit to ' : location.moving ? 'moving in ' : ''}${name}`;
            // Even a named location is only a navigation request, never a detail grant.
            if (names.has(system)) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = 'View system';
                button.onclick = () => onView(system);
                row.append(' ', button);
            }
            return row;
        }));
    }
    return { first, next, render, clear(message = 'Fleet roster unavailable') { list.replaceChildren(); next.hidden = true; status.textContent = message; }, dispose() { root.remove(); } };
}
//# sourceMappingURL=owned-roster.js.map