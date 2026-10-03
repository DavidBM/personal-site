import { createFleetCard } from './fleet-card.js';
/** One observer per scroll pane. Fixed-size outer rows own selection/scrolling;
 * text nodes are created once, on first reveal, then retained. Offscreen rows
 * only retain their latest data. No synchronous geometry reads. */
export function createVisibleFleetCards(root) {
    const rows = new Map();
    function paint(element, row) {
        if (!row.visible || !row.latest)
            return;
        row.card ?? (row.card = createFleetCard(element));
        row.card.update(row.latest);
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
        for (const entry of entries) {
            const row = rows.get(entry.target);
            if (!row)
                continue;
            row.visible = entry.isIntersecting;
            paint(entry.target, row);
        }
    }, { root, rootMargin: '200px 0px' });
    return {
        add(element) {
            const row = { visible: observer === null };
            rows.set(element, row);
            observer?.observe(element);
            return {
                update(fleet) {
                    row.latest = fleet;
                    paint(element, row);
                },
                destroy() {
                    observer?.unobserve(element);
                    rows.delete(element);
                    row.latest = undefined;
                },
            };
        },
        dispose() { observer?.disconnect(); rows.clear(); },
    };
}
//# sourceMappingURL=visible-fleet-cards.js.map