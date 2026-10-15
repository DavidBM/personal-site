import { requestDevelopment } from '../lib/development-content/client.js';
import { presentJourney } from '../features/fleets/journey/presentation.js';
/** Owner roster is independent of the currently inspected solar system. */
export function createOnlineSelection(ports) {
    let id, row, ticket = 0, journey;
    let greeting, epoch = 0n;
    let status, statusKey = '', statusAt = 0, statusPending, battle;
    let journeyAt = 0;
    let reconnectSelection;
    function timed(card) {
        const now = performance.now(), timers = [];
        const clock = greeting?.clock;
        const deadline = (label, end, base, at) => { const endsAt = base !== undefined ? (at ?? now) + Number(end - base) : clock ? clock.timeOriginMs + clock.monotonicMs + Number(end - clock.serverMs) - performance.timeOrigin : now; if (end > 0n)
            timers.push({ label, endsAt }); };
        const phase = journey?.phase;
        if (journey && !terminal(journey) && phase?.phase === 'transit')
            deadline('Jump arrival', phase.arrivalMs, journey.serverNowMs, journeyAt);
        else {
            const end = row?.location.kind === 'resident' ? row.location.arrivalMs : row?.location.arrivalMs;
            if (end)
                deadline('Movement', BigInt(end));
        }
        if (phase?.phase === 'ready' && journey)
            deadline('Next jump', phase.readyMs, journey.serverNowMs, journeyAt);
        else if (status && Number(BigInt(status.readyMs) - BigInt(status.serverNowMs)) > now - statusAt)
            deadline('Drive cooldown', BigInt(status.readyMs), BigInt(status.serverNowMs), statusAt);
        if (battle && battle.fleetId === id && battle.deadlineMs !== null && battle.deadlineMs !== undefined)
            deadline('Battle turn', battle.deadlineMs);
        return { ...card, counts: status?.counts ?? undefined, timers };
    }
    async function readStatus(value) {
        if (!greeting || epoch < 1n)
            return;
        const system = value.location.kind === 'resident' ? value.location.systemId : value.location.sourceSystemId;
        const key = `${value.id}:${value.revision}:${system}:${epoch}`;
        if (key === statusKey)
            return;
        statusPending?.abort();
        const owner = new AbortController();
        statusPending = owner;
        statusKey = key;
        try {
            const result = await requestDevelopment({ worldId: greeting.worldId, visibilityEpoch: String(epoch), systemId: system }, value.id, { action: 'fleet' }, owner.signal);
            if (statusPending !== owner || id !== value.id || result.kind !== 'fleet')
                return;
            status = result;
            statusAt = performance.now();
            if (row)
                showRow(row);
        }
        catch {
            if (statusPending === owner)
                statusKey = '';
        }
    }
    let observed, observedSystem;
    function current(generation, selected) { return generation === ticket && id === selected; }
    function showRow(value) {
        const card = timed(present(value, ports.name));
        if (journey?.fleetId === value.id && !terminal(journey))
            ports.show({ ...card, canOrder: false, canFollow: card.canFollow && journey.phase.phase !== 'transit', activity: presentJourney(journey, journey.serverNowMs).label });
        else
            ports.show(card);
    }
    async function refresh() {
        if (!id)
            return;
        const selected = id, generation = ++ticket;
        try {
            const next = await ports.read(selected);
            if (!current(generation, selected))
                return;
            row = next;
            if (!next) {
                ports.show(observed ?? { id: selected, name: `Fleet ${selected.slice(-6)}`, ships: 0, location: 'Fleet unavailable', activity: 'Waiting for current fleet information', canOrder: false, canGo: false });
                return;
            }
            showRow(next);
            void readStatus(next);
            ports.selected(systemOf(next), selected);
            return next;
        }
        catch {
            if (current(generation, selected))
                ports.show({ id: selected, name: `Fleet ${selected.slice(-6)}`, ships: row?.memberCount ?? 0, location: 'Reconnecting fleet information', activity: 'Orders temporarily unavailable', canOrder: false, canGo: false });
        }
    }
    function clear() { reconnectSelection = undefined; statusPending?.abort(); statusPending = undefined; status = undefined; statusKey = ''; battle = undefined; ticket++; id = undefined; row = undefined; journey = undefined; observed = undefined; observedSystem = undefined; ports.show(undefined); }
    return { refresh, clear, battle(value) { battle = value; if (row)
            showRow(row); }, journey(value) { journey = value; journeyAt = performance.now(); if (row)
            showRow(row); }, value: () => row, id: () => id, system: () => row ? systemOf(row) : observedSystem,
        select(system, value, fallback) { if (id !== value) {
            statusPending?.abort();
            status = undefined;
            statusKey = '';
            journey = undefined;
            battle = undefined;
        } id = value; row = undefined; observedSystem = system; observed = fallback?.id === value && !fallback.canOrder ? { ...fallback, location: ports.name(system) } : undefined; ports.show({ id: value, name: `Fleet ${value.slice(-6)}`, ships: 0, location: ports.name(system), activity: 'Loading fleet information', canOrder: false, canGo: false }); ports.selected(system, value); void refresh(); },
        event(value) {
            if (value.type === 'welcome') {
                const retained = greeting?.worldId === value.worldId && greeting?.playerId === value.playerId ? reconnectSelection : undefined;
                clear();
                reconnectSelection = retained;
                greeting = value;
                epoch = 0n;
                return;
            }
            if (value.type === 'viewBarrier') {
                if (epoch > 0n)
                    clear();
                epoch = value.epoch;
                return;
            }
            if (value.type === 'viewChanged' && value.status.displayed)
                epoch = value.status.displayed.epoch;
            if (value.type === 'viewChanged' && value.status.slot === 'owned' && value.status.state === 'ready') {
                if (reconnectSelection) {
                    id = reconnectSelection.id;
                    observedSystem = reconnectSelection.system;
                    reconnectSelection = undefined;
                }
                void refresh();
            }
            if (value.type === 'state' && value.state === 'closed') {
                const retained = id ? { id, system: row ? systemOf(row) : observedSystem ?? '' } : reconnectSelection;
                clear();
                reconnectSelection = retained;
            }
        }
    };
}
function systemOf(row) { return row.location.kind === 'resident' ? row.location.systemId : row.location.destinationSystemId; }
function present(row, name) {
    const resident = row.location.kind === 'resident', available = row.availability === 1;
    const activity = row.location.kind === 'transit' ? 'Jumping to destination' : row.location.moving ? 'Moving' : 'Ready for orders';
    return { id: row.id, name: `Fleet ${row.id.slice(-6)}`, ships: row.memberCount ?? 0, location: name(systemOf(row)), activity,
        canOrder: available && resident, canGo: available, canFollow: available && resident };
}
function terminal(journey) { return ['completed', 'cancelled', 'failed'].includes(journey.phase.phase); }
//# sourceMappingURL=online-selection.js.map