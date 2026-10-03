/** Small event packets, not a world snapshot. Flush at tick end and before a
 * removal so every transition keeps its order without another timer or tick. */
export const FLEET_STATE_BATCH_SIZE = 64;
export function createFleetStateBatch(events) {
    let pending = [];
    function flush() {
        if (!pending.length)
            return;
        const fleets = pending;
        pending = [];
        if (fleets.length > 1 && events.onFleetsStateBatch)
            events.onFleetsStateBatch({ fleets });
        else
            for (const fleet of fleets)
                events.onFleetState(fleet);
    }
    return {
        state(fleet) {
            pending.push({ id: fleet.id, state: fleet.state });
            if (pending.length === FLEET_STATE_BATCH_SIZE)
                flush();
        },
        removed(id) { flush(); events.onFleetRemoved({ id }); },
        flush,
    };
}
//# sourceMappingURL=state-batch.js.map