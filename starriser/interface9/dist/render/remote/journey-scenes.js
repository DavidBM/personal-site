import { createJourneyVisuals } from './journey-visuals.js';
/** Sparse per-fleet ownership; selection changes only the camera/HUD consumer. */
export function createJourneyScenes(...args) {
    const rows = new Map();
    function remove(id) { rows.get(id)?.clear(); rows.delete(id); }
    function clear() { for (const row of rows.values())
        row.clear(); rows.clear(); }
    function accept(value, id) {
        if (!value) {
            if (id)
                remove(id);
            else
                clear();
            return;
        }
        let row = rows.get(value.fleetId);
        if (!row) {
            if (rows.size >= 512)
                throw new Error('Journey visual capacity reached');
            row = createJourneyVisuals(...args);
            rows.set(value.fleetId, row);
        }
        const result = row.accept(value);
        if (['completed', 'cancelled', 'failed'].includes(value.phase))
            rows.delete(value.fleetId);
        return result;
    }
    return { accept, clear, handoff: (id, visual) => rows.get(id)?.handoff(id, visual) ?? false,
        restore: (id) => rows.get(id)?.restore(id), visual: (id) => rows.get(id)?.visual(id),
        entries: () => [...rows.values()].flatMap(row => row.entries()) };
}
//# sourceMappingURL=journey-scenes.js.map