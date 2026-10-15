/** Superseded queries cannot republish a fleet after selection or permission changes. */
export function createOnlineFleetComposition(show) {
    let generation = 0, disposed = false;
    function clear() { generation++; show(undefined); }
    async function read(query, fleetId) {
        if (disposed)
            return;
        const ticket = ++generation;
        show(undefined);
        if (!fleetId)
            return;
        try {
            const page = await query({ fleetId });
            if (!disposed && ticket === generation)
                show(page.fleets.find(fleet => fleet.id === fleetId));
        }
        catch {
            if (!disposed && ticket === generation)
                show(undefined);
        }
    }
    return { read, clear, dispose() { if (disposed)
            return; clear(); disposed = true; } };
}
//# sourceMappingURL=online-fleet-composition.js.map