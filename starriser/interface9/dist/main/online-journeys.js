import { watchGameplay } from '../features/http-worker/client.js';
import { requestJourneyPath } from '../lib/journey-content/path.js';
import { requestRoute } from '../lib/journey-content/navigation.js';
import { requestJourney, JourneyRequestError } from '../lib/journey-content/client.js';
import { validateOperation } from '../lib/journey-content/contracts.js';
import { presentJourney } from '../features/fleets/journey/presentation.js';
const SELECT_ROUTE = 'Select a fleet and destination, then preview its route.';
const MAX_UNCONFIRMED = 16;
/** Session-local unknown commands retain identity; the server recovers routes after reload. */
export function createOnlineJourneys(parent, options = {}) {
    const panel = document.createElement('section'), title = document.createElement('h3');
    title.textContent = 'Fleet journey';
    const route = document.createElement('p'), routeText = document.createTextNode(SELECT_ROUTE);
    route.append(routeText);
    const help = document.createElement('p');
    help.textContent = 'Continue through the previewed systems automatically. Fleets approach a safe departure gate during cooldown; each jump waits until both are ready. Cancel stops future jumps. Select an owned fleet to recover its journey.';
    const send = button('Start journey'), refresh = button('Refresh'), retry = button('Retry same request'), cancel = button('Cancel journey');
    const output = document.createElement('output');
    output.setAttribute('aria-live', 'polite');
    output.style.cssText = 'display:block;min-height:3em;max-width:42em;overflow-wrap:anywhere';
    const outputText = document.createTextNode('');
    output.append(outputText);
    panel.append(title, route, help, send, refresh, retry, cancel, output);
    parent.append(panel);
    let welcome, scope, draft;
    let pending, projection, fleet;
    const uncertain = new Map();
    let completion;
    let pathOwner, pathId;
    function clearPath() { pathOwner?.abort(); pathOwner = undefined; pathId = undefined; options.onPath?.(undefined, welcome?.generation ?? 0); }
    async function loadPath(value) {
        if (!options.onPath || !scope || pathId === value.journeyId)
            return;
        clearPath();
        const owner = new AbortController(), accepted = scope;
        pathOwner = owner;
        pathId = value.journeyId;
        try {
            let offset = 0;
            while (offset !== null) {
                const page = await requestJourneyPath(accepted, { journeyId: value.journeyId, sourceSystem: value.sourceSystem, offset }, owner.signal, options.call);
                if (owner.signal.aborted || scope !== accepted || fleet !== page.fleetId)
                    return;
                options.onPath?.(page, welcome?.generation ?? 0);
                offset = page.nextOffset;
            }
        }
        catch {
            if (pathOwner === owner && !owner.signal.aborted)
                pathId = undefined;
        }
    }
    let epoch = 0n, closed = false, checked = false, dirty = false;
    const unwatch = watchGameplay(1, ids => { if (ids.length && (!fleet || !ids.includes(fleet)))
        return; if (pending)
        dirty = true;
    else if (scope && fleet && !last())
        void perform({ action: 'lookup', fleetId: fleet }); });
    function active() { return !!projection && !['completed', 'cancelled', 'failed'].includes(projection.phase.phase); }
    function canCancel() { return !!projection && presentJourney(projection, projection.serverNowMs).canCancel; }
    function last() { return fleet ? uncertain.get(fleet) : undefined; }
    function controls() {
        const unavailable = !scope || !!pending;
        send.disabled = unavailable || !canStart();
        refresh.disabled = unavailable || !fleet;
        retry.disabled = unavailable || !last();
        cancel.disabled = unavailable || !canCancel() || !!last();
    }
    function canStart() { return !!draft && checked && !last() && !active() && uncertain.size < MAX_UNCONFIRMED; }
    function resetRequest() { dirty = false; pending?.abort(); pending = undefined; projection = undefined; checked = false; }
    function clear() {
        options.onProjection?.(undefined, welcome?.generation ?? 0);
        clearPath();
        resetRequest();
        scope = undefined;
        draft = undefined;
        routeText.data = SELECT_ROUTE;
        outputText.data = 'Journey controls await current permission.';
        controls();
    }
    function install(next) {
        if (!welcome || next < 1n || next < epoch || (next === epoch && scope))
            return;
        clear();
        epoch = next;
        scope = { worldId: welcome.worldId, visibilityEpoch: next.toString() };
        controls();
        recover();
    }
    function locator(action) {
        if (!projection)
            throw new Error('Journey confirmation unavailable');
        return { action, journeyId: projection.journeyId, sourceSystem: projection.sourceSystem };
    }
    function show(value, selected) {
        if (value.fleetId !== selected)
            throw new Error('Journey fleet changed; refresh the selected fleet.');
        checked = true;
        uncertain.delete(selected);
        if ('kind' in value) {
            clearPath();
            options.onProjection?.(undefined, welcome?.generation ?? 0);
            projection = undefined;
            outputText.data = decisionText(value);
            return;
        }
        projection = value;
        void loadPath(value);
        options.onProjection?.(value, welcome?.generation ?? 0);
        const view = presentJourney(value, value.serverNowMs);
        outputText.data = `${view.label} · ${value.completedLegs}/${value.totalLegs} jumps confirmed.`;
        if (active()) {
            draft = undefined;
        }
    }
    function current(owner) { return !closed && !owner.signal.aborted && pending === owner; }
    function failure(error, operation, selected) {
        if ((operation.action === 'accept' || operation.action === 'navigate') && error instanceof JourneyRequestError && error.status === 400) {
            uncertain.delete(selected);
            draft = undefined;
            outputText.data = 'The route request was invalid. Refresh the fleet and preview a new route.';
            return;
        }
        outputText.data = error instanceof Error ? error.message : 'Outcome unconfirmed; retry this journey identity.';
    }
    function unavailable() { return closed || !!pending; }
    function perform(operation) { return completion = performOwned(operation); }
    async function performOwned(operation) {
        if (unavailable() || !scope || !fleet)
            return;
        dirty = false;
        const owner = new AbortController(), acceptedScope = scope, selected = fleet;
        pending = owner;
        if (['accept', 'navigate', 'cancel'].includes(operation.action))
            uncertain.set(selected, structuredClone(operation));
        controls();
        outputText.data = 'Waiting for server confirmation…';
        try {
            const value = await requestJourney(acceptedScope, operation, owner.signal, options.call);
            if (current(owner))
                show(value, selected);
        }
        catch (error) {
            if (current(owner))
                failure(error, operation, selected);
        }
        finally {
            if (pending === owner) {
                pending = undefined;
                controls();
                if (dirty) {
                    dirty = false;
                    if (!last() && fleet)
                        void perform({ action: 'lookup', fleetId: fleet });
                }
            }
        }
    }
    function recover() {
        if (!fleet)
            return;
        const operation = last() ?? (projection ? locator('read') : { action: 'lookup', fleetId: fleet });
        void perform(operation);
    }
    function setFleet(value) {
        if (closed || fleet === value?.id)
            return;
        clearPath();
        options.onProjection?.(undefined, welcome?.generation ?? 0);
        resetRequest();
        fleet = value?.id;
        draft = undefined;
        routeText.data = SELECT_ROUTE;
        outputText.data = fleet ? 'Recovering this fleet’s journey…' : SELECT_ROUTE;
        controls();
        recover();
    }
    function command(value) {
        if (value.destinationSystem) {
            const result = { action: 'navigate', journeyId: crypto.randomUUID().replace(/-/g, ''), sourceSystem: value.sourceSystem,
                fleetId: value.fleetId, fleetRevision: value.fleetRevision.toString(), destinationSystem: value.destinationSystem, position: value.position ?? [0, 0, 0], arrival: value.arrival };
            validateOperation(result);
            return result;
        }
        const result = { action: 'accept', journeyId: crypto.randomUUID().replace(/-/g, ''), sourceSystem: value.sourceSystem,
            fleetId: value.fleetId, fleetRevision: value.fleetRevision.toString(), legs: value.legs };
        validateOperation(result);
        return result;
    }
    async function startRoute(value) {
        setFleet({ id: value.fleetId });
        await completion;
        if (closed || fleet !== value.fleetId || !scope)
            throw new Error('Fleet selection changed before the journey was submitted.');
        draft = value;
        if (!canStart())
            throw new Error('Resolve or cancel this fleet’s current journey before starting another.');
        const request = command(value);
        draft = undefined;
        await perform(request);
    }
    send.addEventListener('click', () => {
        if (!draft || !canStart())
            return;
        try {
            const request = command(draft);
            draft = undefined;
            void perform(request);
        }
        catch (error) {
            outputText.data = error instanceof Error ? error.message : 'Invalid route';
        }
    });
    refresh.addEventListener('click', recover);
    retry.addEventListener('click', recover);
    cancel.addEventListener('click', () => { if (canCancel())
        void perform(locator('cancel')); });
    function event(value) {
        if (closed || !sameConnection(value))
            return;
        switch (value.type) {
            case 'welcome':
                welcome = value;
                return;
            case 'viewBarrier':
                if (value.epoch > epoch) {
                    clear();
                    epoch = value.epoch;
                }
                return;
            case 'topology':
                if (value.viewToken)
                    install(value.viewToken.epoch);
                return;
            case 'state':
                if (value.state === 'closed')
                    clear();
                return;
        }
    }
    function sameConnection(value) { return !welcome || !('generation' in value) || value.generation === welcome.generation; }
    controls();
    async function previewRoute(query) {
        if (!scope)
            throw new Error('Journey controls await current permission.');
        const accepted = scope, result = await requestRoute(accepted, query, AbortSignal.timeout(15000), options.call);
        if (closed || scope !== accepted)
            throw new Error('Route permission changed. Preview again.');
        return result;
    }
    return { reconnect() { clear(); welcome = undefined; epoch = 0n; }, event, setFleet, startRoute, previewRoute, reveal() { panel.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); },
        setRoute(value) {
            if (closed)
                return;
            if (value)
                setFleet({ id: value.fleetId });
            if (last() || active())
                return;
            draft = value && structuredClone(value);
            routeText.data = value ? `${value.names.join(' → ')} · ${value.totalLegs ?? value.legs.length} jumps` : SELECT_ROUTE;
            controls();
        },
        dispose() { if (closed)
            return; closed = true; unwatch(); clear(); uncertain.clear(); panel.remove(); },
        inspect: () => ({ pending: !!pending, last: last(), projection, epoch, fleet, checked }), };
}
function decisionText(value) {
    if (value.kind === 'none')
        return 'This fleet has no recorded journey. Preview a route to begin.';
    const reasons = { invalid: 'The route was invalid.', fleetUnavailable: 'The fleet was unavailable.', stale: 'The fleet changed before departure.', busy: 'The fleet already had an active journey.', capacity: 'Journey storage is at capacity.', route: 'The route is not connected.' };
    return `${reasons[value.reason]} This request is durably rejected. Refresh the fleet and preview a new route.`;
}
function button(label) { const value = document.createElement('button'); value.type = 'button'; value.textContent = label; return value; }
//# sourceMappingURL=online-journeys.js.map