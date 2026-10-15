import { serverTimeForPresentation } from '../../contracts/server-clock.js';
function changed(a, b) {
    return !!a && (a.fleetId !== b.fleetId || a.journeyId !== b.journeyId);
}
function ended(a, b) {
    return (a != null && b.completedLegs > a.completedLegs) || ['completed', 'cancelled', 'failed'].includes(b.phase);
}
function confirmedArrival(a, b) {
    return b.phase === 'completed' || (a != null && b.completedLegs > a.completedLegs);
}
function jumpState(value, departure, anchor, reference) {
    if (!value.source || !value.destination)
        return;
    if (!value.arrivalPosition || value.departureMs == null || value.arrivalMs == null
        || value.arrivalMs <= value.departureMs || !value.arrivalPosition.every(Number.isFinite))
        throw new Error('Incomplete accepted jump');
    return { state: 'jumping', startTime: serverTimeForPresentation(value.departureMs, anchor, reference.monotonicEpochMs, reference.wallMs),
        durationMs: Number(value.arrivalMs - value.departureMs), startNode: value.source, endNode: value.destination, startPosition: value.sourcePosition, endPosition: value.destinationPosition,
        acceptedDeparture: departure, acceptedArrival: { x: value.arrivalPosition[0], y: value.arrivalPosition[1], z: value.arrivalPosition[2] } };
}
export function createJourneyVisuals(state, clock, existing, release) {
    let signal, held;
    let departure, started;
    function clear() {
        if (held)
            release(held);
        held = undefined;
        signal = undefined;
        departure = undefined;
        started = undefined;
    }
    function applyWarp() {
        const value = signal, anchor = clock();
        if (!held || !departure || !anchor || value?.phase !== 'transit' || started === value.departureMs)
            return;
        const next = jumpState(value, departure, anchor, state.view.remoteClockReference());
        if (!next)
            return;
        held.remote = undefined;
        held.pendingMove = undefined;
        state.view.updateFleetState(held.id, next);
        started = value.departureMs;
    }
    function accept(value) {
        if (!value) {
            clear();
            return;
        }
        if (changed(signal, value))
            clear();
        if (signal && value.revision < signal.revision)
            return;
        if (ended(signal, value)) {
            const focus = confirmedArrival(signal, value) ? arrivalFocus() : undefined;
            clear();
            if (!['completed', 'cancelled', 'failed'].includes(value.phase))
                signal = value;
            return focus;
        }
        signal = value;
        applyWarp();
    }
    function arrivalFocus() {
        if (state.focusedFleetId !== signal?.fleetId || (!state.camera.isFollowing() && !state.camera.isOrbiting() && !state.travel?.framing(signal?.fleetId ?? '')) || !held || !signal?.destinationSystem)
            return;
        return { fleetId: signal.fleetId, systemId: signal.destinationSystem, mode: state.camera.isFollowing() ? 'follow' : 'focus' };
    }
    function handoff(id, visual) {
        if (signal?.fleetId !== id || held || visual.remote?.relationship !== 'own')
            return false;
        const p = visual.remote;
        departure = { x: p.targetX, y: p.targetY, z: p.targetZ };
        visual.persistentId = p.persistentId;
        held = visual;
        applyWarp();
        return true;
    }
    /** A source refresh can still contain this fleet. Return its allocation to the
     * adapter instead of showing two copies; a later export can take it again. */
    function restore(id) {
        if (signal?.fleetId !== id || !held)
            return;
        const visual = held;
        held = undefined;
        departure = undefined;
        started = undefined;
        return visual;
    }
    return { accept, handoff, restore, clear, visual: (id) => signal?.fleetId === id ? held : undefined,
        entries: () => signal && held ? [[signal.fleetId, held]] : [] };
}
//# sourceMappingURL=journey-visuals.js.map