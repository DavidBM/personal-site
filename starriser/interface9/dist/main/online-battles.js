import { watchGameplay } from '../features/http-worker/client.js';
import { requestCompleteBattle } from '../lib/battle-content/complete.js';
import { BattleRequestError } from '../lib/battle-content/client.js';
import { createBattleTactical, battleRoles as roles, battleStatuses as statuses } from './battle-tactical.js';
import { createBattleHistory, createBattleLog } from './battle-log.js';
import { requestBattleHistory } from '../lib/battle-content/history.js';
import { bindText, setText } from '../ui/dom-bindings.js';
/** Retained tactical overview: accepted aggregate counts, no per-ship simulation. */
export function createOnlineBattles(parent, options = {}) {
    const panel = document.createElement('section'), title = document.createElement('h3');
    title.textContent = 'Fleet battle';
    const help = document.createElement('p');
    help.textContent = 'Select an owned fleet to view its battle. Orders apply to the next accepted turn. Retreat remains exposed to opposing fire.';
    const note = document.createElement('p');
    note.textContent = 'Select your fleet and right-click another fleet to schedule an engagement.';
    const role = document.createElement('select');
    role.setAttribute('aria-label', 'Ship role strategy');
    roles.forEach((name, index) => role.append(option(name, index + 1)));
    const strategy = document.createElement('select');
    strategy.setAttribute('aria-label', 'Next turn strategy');
    ['Balanced', 'Aggressive', 'Guard', ...roles.map(name => `Focus ${name}`)].forEach((name, index) => strategy.append(option(name, index)));
    const send = button('Set next strategy'), retreat = button('Begin retreat'), refresh = button('Refresh battle'), retry = button('Retry same order');
    const output = document.createElement('output'), outputText = bindText(output, { height: '4.2em', wrap: true });
    setText(outputText, 'Select an owned fleet.');
    output.setAttribute('aria-live', 'polite');
    Object.assign(output.style, { display: 'block', maxWidth: '44em' });
    panel.style.cssText = 'width:100%;max-width:44em;min-width:0';
    const tactical = document.createElement('div');
    tactical.setAttribute('aria-label', 'Battle forces and losses');
    tactical.style.cssText = 'display:grid;gap:6px;max-width:44em';
    panel.append(title, help, note, role, strategy, send, retreat, refresh, retry, output, tactical);
    parent.append(panel);
    const depiction = createBattleTactical(tactical), history = createBattleHistory(createBattleLog(panel));
    let welcome, scope, fleet;
    let detailSystem = '';
    let detailRequest = 0n;
    let epoch = 0n, closed = false, pending, projection;
    let countdown, receivedAt = 0;
    let dirty = false;
    const unwatch = watchGameplay(2, () => { if (pending)
        dirty = true;
    else if (scope && fleet)
        void perform({ action: 'read' }); });
    const uncertain = new Map();
    function key() { return `${scope?.worldId ?? welcome?.worldId}/${fleet?.systemId}/${fleet?.fleetId}`; }
    function blocked() { return !scope || !fleet || fleet.systemId !== detailSystem || !!pending; }
    function controls() {
        const order = uncertain.get(key());
        send.disabled = blocked() || !active() || !!order || uncertain.size >= 16;
        retreat.disabled = send.disabled || projection?.fleets[projection.selectedSlot][2] !== 0;
        refresh.disabled = blocked();
        retry.disabled = blocked() || !order;
        role.disabled = strategy.disabled = send.disabled;
    }
    function active() {
        if (!projection || projection.finished)
            return false;
        const status = projection.fleets[projection.selectedSlot][2];
        return status === 0 || status === 1;
    }
    function abort() { clearInterval(countdown); countdown = undefined; dirty = false; pending?.abort(); pending = undefined; }
    function clearView(preserveVisual = false) { abort(); projection = undefined; if (!preserveVisual)
        options.onProjection?.(undefined); depiction.clear(); history.clear(); controls(); }
    function installed(next, systemId) { return next === epoch && !!scope && systemId === detailSystem; }
    function install(next, systemId) {
        if (!welcome || next < 1n || next < epoch)
            return;
        if (installed(next, systemId))
            return;
        clearView(next === epoch && systemId === detailSystem);
        detailSystem = systemId;
        epoch = next;
        scope = { worldId: welcome.worldId, visibilityEpoch: next.toString() };
        controls();
        if (fleet)
            void perform({ action: 'read' });
    }
    function current(owner) { return !closed && !owner.signal.aborted && pending === owner; }
    async function perform(operation) {
        if (closed || blocked())
            return;
        if (!scope || !fleet)
            return;
        abort();
        const owner = new AbortController(), acceptedScope = scope, selected = fleet, acceptedKey = key();
        pending = owner;
        if (operation.action !== 'read')
            uncertain.set(acceptedKey, structuredClone(operation));
        controls();
        setText(outputText, operation.action === 'read' ? 'Reading current battle…' : 'Order pending server acceptance…');
        try {
            const value = await requestCompleteBattle(acceptedScope, selected, operation, owner.signal, options.call);
            acknowledge(operation, value, acceptedKey);
            if (current(owner))
                show(value);
        }
        catch (error) {
            if (current(owner))
                failure(error, operation, acceptedKey);
        }
        finally {
            release(owner);
        }
    }
    function release(owner) { if (pending === owner) {
        pending = undefined;
        controls();
        if (dirty) {
            dirty = false;
            void perform({ action: 'read' });
        }
    } }
    function acknowledge(operation, value, acceptedKey) {
        if (operation.action !== 'read' && value.receipt?.commandId === operation.commandId)
            uncertain.delete(acceptedKey);
    }
    function failure(error, operation, acceptedKey) {
        // Domain rejection is definitive; unavailable/transport errors retain the exact command.
        if (operation.action !== 'read' && error instanceof BattleRequestError && [400, 404, 409].includes(error.status))
            uncertain.delete(acceptedKey);
        readFailure(error);
        setText(outputText, error instanceof Error ? error.message : 'Battle outcome unconfirmed. Retry the same order.');
        if (error instanceof BattleRequestError && [401, 403, 412].includes(error.status)) {
            scope = undefined;
            projection = undefined;
            options.onProjection?.(undefined);
            depiction.clear();
            history.clear();
        }
    }
    function readFailure(error) {
        if (error instanceof BattleRequestError && error.status === 404) {
            projection = undefined;
            options.onProjection?.(undefined);
            depiction.clear();
            history.clear();
        }
    }
    function show(value) {
        projection = value;
        receivedAt = performance.now();
        options.onProjection?.(value);
        updateText(value);
        if (!value.finished)
            countdown = setInterval(() => { if (!pending && projection === value)
                updateText(value); }, 1000);
        strategy.value = String(value.strategies[Number(role.value || 1) - 1]);
        depiction.show(value);
        const accepted = scope, selected = fleet;
        if (accepted && selected)
            history.sync(value, (battleId, after, signal) => requestBattleHistory(accepted, selected, battleId, after, signal, options.call));
    }
    function updateText(value) {
        const selected = value.fleets[value.selectedSlot];
        const accepted = value.receipt ? ` Order accepted for turn ${value.receipt.effectiveTurn}.` : '';
        const remaining = value.deadlineMs === null ? '' : ` Next turn in ${Math.max(0, (Number(value.deadlineMs - value.serverNowMs) - (performance.now() - receivedAt)) / 1000).toFixed(1)} s.`;
        setText(outputText, `${value.finished ? 'Battle finished · ' : ''}${statuses[selected[2]]}. Turn ${value.nextTurn - 1n} resolved.${remaining}${accepted}`);
    }
    function order(action) {
        if (!projection || blocked() || uncertain.has(key()))
            return;
        const value = { action, battleId: projection.battleId, commandId: crypto.randomUUID().replace(/-/g, ''), nextTurn: projection.nextTurn.toString(), planRevision: projection.planRevision.toString(), ...(action === 'strategy' ? { role: Number(role.value || 1), strategy: Number(strategy.value || 0) } : {}) };
        void perform(value);
    }
    send.addEventListener('click', () => order('strategy'));
    retreat.addEventListener('click', () => order('retreat'));
    refresh.addEventListener('click', () => { void perform({ action: 'read' }); });
    retry.addEventListener('click', () => { const value = uncertain.get(key()); if (value)
        void perform(value); });
    role.addEventListener('change', () => { if (projection)
        strategy.value = String(projection.strategies[Number(role.value) - 1]); });
    function wrongGeneration(value) { return !!welcome && 'generation' in value && value.generation !== welcome.generation; }
    function event(value) {
        if (closed || wrongGeneration(value))
            return;
        switch (value.type) {
            case 'welcome':
                welcome = value;
                scope = undefined;
                detailSystem = '';
                detailRequest = 0n;
                epoch = 0n;
                clearView();
                return;
            case 'viewBarrier':
                barrier(value.epoch);
                return;
            case 'viewChanged':
                detail(value.status);
                return;
            case 'state':
                connection(value.state);
                return;
        }
    }
    function detail(status) {
        if (status.slot !== 'detail' || status.requestedGeneration < detailRequest)
            return;
        if (status.state === 'ready' && !status.stale) {
            const accepted = readyDetail(status, welcome?.generation, epoch);
            if (!accepted)
                return;
            detailRequest = status.requestedGeneration;
            install(accepted.epoch, accepted.systemId);
            return;
        }
        detailRequest = status.requestedGeneration;
        const refreshing = (status.state === 'loading' || status.recovering === true) && status.requested?.kind === 'detail' && status.requested.systemId === detailSystem;
        clearView(refreshing);
        scope = undefined;
        if (!refreshing)
            detailSystem = '';
        setText(outputText, 'Battle controls await current system detail.');
        controls();
    }
    function barrier(next) { if (next > epoch) {
        clearView();
        scope = undefined;
        epoch = next;
        setText(outputText, 'Battle controls await current visibility.');
        controls();
    } }
    function connection(state) { if (state === 'closed') {
        clearView();
        scope = undefined;
        setText(outputText, 'Battle connection closed.');
        controls();
    } }
    controls();
    return { reconnect() { clearView(); welcome = undefined; scope = undefined; detailSystem = ''; detailRequest = epoch = 0n; }, event, refresh() { void perform({ action: 'read' }); }, setFleet(value) {
            // Roster removal can mean destruction; retain the last authenticated result.
            if (closed || !value)
                return;
            if (fleet && fleet.systemId === value.systemId && fleet.fleetId === value.fleetId)
                return;
            clearView();
            fleet = { ...value };
            setText(outputText, 'Loading this fleet’s battle…');
            controls();
            if (scope)
                void perform({ action: 'read' });
        }, clearSelection() { clearView(); fleet = undefined; setText(outputText, 'Select an owned fleet.'); controls(); }, dispose() { if (closed)
            return; closed = true; unwatch(); clearView(); scope = undefined; uncertain.clear(); panel.remove(); }, inspect: () => ({ projection, epoch, pending: !!pending, uncertain: uncertain.size }) };
}
function readyDetail(status, generation, epoch) {
    const token = status.displayed, selected = status.requested;
    if (!token || token.connection !== generation || token.request !== status.requestedGeneration
        || token.epoch < epoch || token.epoch < 1n || selected?.kind !== 'detail')
        return;
    return { systemId: selected.systemId, epoch: token.epoch };
}
function option(label, value) { const item = document.createElement('option'); item.textContent = label; item.value = String(value); return item; }
function button(label) { const item = document.createElement('button'); item.type = 'button'; item.textContent = label; return item; }
//# sourceMappingURL=online-battles.js.map