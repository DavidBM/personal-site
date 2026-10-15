import { watchGameplay } from '../features/http-worker/client.js';
import { requestEncounter } from '../lib/encounter-content/client.js';
import { FeatureError } from '../features/http-worker/client.js';
import { bindText, setText } from '../ui/dom-bindings.js';
/** One retained engagement control, fenced to the current authorized detail. */
export function createOnlineEncounters(parent, onEngaged) {
    const panel = document.createElement('section'), output = document.createElement('output'), retry = document.createElement('button');
    panel.className = 'online-engagement';
    panel.setAttribute('aria-label', 'Fleet engagement');
    output.setAttribute('role', 'status');
    const text = bindText(output, { height: '3.5em', wrap: true });
    setText(text, 'Select your fleet, then right-click another fleet to approach and fight.');
    retry.type = 'button';
    retry.textContent = 'Retry engagement';
    retry.disabled = true;
    panel.append(output, retry);
    parent.insertBefore(panel, parent.firstChild);
    let welcome, scope, systemId = '', request = 0n, epoch = 0n;
    let pending, dirty = false, closed = false;
    let inFlight;
    let countdown;
    let order;
    const unwatch = watchGameplay(4, () => { if (pending)
        dirty = true;
    else
        resumeReceipt(); });
    function clear() { clearInterval(countdown); countdown = undefined; pending?.abort(); pending = undefined; dirty = false; retry.disabled = true; }
    function perform(command) {
        if (pending)
            return inFlight ?? Promise.resolve(undefined);
        return inFlight = send(command);
    }
    async function send(command) {
        if (closed || !scope || systemId !== command.systemId)
            return;
        clear();
        const owner = new AbortController(), accepted = scope;
        pending = owner;
        retry.disabled = true;
        try {
            const value = await requestEncounter(accepted, command, owner.signal);
            if (pending !== owner || owner.signal.aborted)
                return;
            show(value, command);
            return value;
        }
        catch (error) {
            failure(error, owner);
        }
        finally {
            if (pending === owner) {
                pending = undefined;
                retry.disabled = !order || !scope;
                if (dirty) {
                    dirty = false;
                    resumeReceipt();
                }
            }
        }
    }
    function show(value, command) {
        if (value.status === 'scheduled') {
            const acceptedAt = performance.now();
            const update = () => {
                const now = value.serverNowMs + BigInt(Math.max(0, Math.floor(performance.now() - acceptedAt)));
                if (value.arrivalMs !== undefined && now < value.arrivalMs)
                    setText(text, `Approaching target · ${Math.ceil(Number(value.arrivalMs - now) / 1000)}s to arrival. Combat countdown starts on arrival.`);
                else
                    setText(text, `Engagement scheduled · ${Math.max(0, Math.ceil(Number(value.dueMs - now) / 1000))}s. Combat starts automatically if the target stays in range.`);
            };
            update();
            countdown = setInterval(update, 1000);
            order = { ...command, action: 'read' };
            return;
        }
        setText(text, value.status === 'engaged' ? 'Engagement started. Battle controls are ready.' : 'Engagement cancelled: another move/orbit order replaced the attack, or the target became unavailable or left range. Choose Fight to try again.');
        order = undefined;
        if (value.status === 'engaged')
            onEngaged(command.systemId, command.fleetId);
    }
    function failure(error, owner) {
        if (pending !== owner || owner.signal.aborted)
            return;
        setText(text, error instanceof Error ? error.message : 'Engagement outcome unconfirmed');
        if (error instanceof FeatureError && [400, 401, 403, 404, 409, 412].includes(error.status ?? 0))
            order = undefined;
        if (error instanceof FeatureError && error.status === 401)
            scope = undefined;
    }
    function accepted(s) {
        const t = s.displayed;
        return s.state === 'ready' && !s.stale && !!t && t.connection === welcome?.generation && t.request === request && t.epoch >= epoch && s.requested?.kind === 'detail';
    }
    function unchanged(s) {
        return accepted(s) && !!scope && s.displayed?.epoch === epoch && s.requested?.kind === 'detail' && s.requested.systemId === systemId;
    }
    function detail(value) {
        const s = value.status;
        if (s.slot !== 'detail' || s.requestedGeneration < request)
            return;
        request = s.requestedGeneration;
        const t = s.displayed;
        if (unchanged(s))
            return;
        clear();
        scope = undefined;
        systemId = '';
        if (!accepted(s))
            return;
        epoch = t.epoch;
        systemId = s.requested.systemId;
        if (welcome)
            scope = { worldId: welcome.worldId, visibilityEpoch: epoch.toString() };
        retry.disabled = !order || order.systemId !== systemId;
        resumeReceipt();
    }
    function resumeReceipt() {
        // Combat admission can replace detail while this receipt is being read.
        // Resume reads only after fresh authorization; never mint/resubmit an order.
        const retained = order;
        if (scope && retained?.systemId === systemId && retained.action === 'read')
            void perform(retained);
    }
    function greet(value) { clear(); if (welcome?.worldId !== value.worldId)
        order = undefined; welcome = value; scope = undefined; systemId = ''; request = epoch = 0n; }
    async function reconcile(system, fleet, target) {
        // A confirmed order belongs to its fleet, not to a global command lock.
        // The panel observes the latest attack; earlier accepted attacks keep running.
        if (order?.action === 'read' && order.fleetId !== fleet) {
            clear();
            order = undefined;
            return true;
        }
        if (pending && (await inFlight)?.status === 'engaged')
            return false;
        const retained = order;
        if (!retained)
            return true;
        validateRetry(retained, system, fleet, target);
        // Explicit Fight also repairs a missed cancellation notice. Unconfirmed
        // submissions retry their exact identity; accepted ones only read a receipt.
        const result = await perform(retained);
        if (order)
            throw new Error('This attack is still pending. Let the fleet approach and finish the countdown, or issue a move to cancel it.');
        return result?.status === 'cancelled';
    }
    retry.addEventListener('click', () => { if (order)
        void perform(order); });
    return {
        reconnect() { clear(); scope = undefined; systemId = ''; request = epoch = 0n; },
        event(value) {
            if (value.type === 'welcome') {
                greet(value);
                return;
            }
            if ('generation' in value && value.generation !== welcome?.generation)
                return;
            if (value.type === 'viewChanged')
                detail(value);
            if (value.type === 'viewBarrier' && value.epoch > epoch) {
                clear();
                scope = undefined;
                epoch = value.epoch;
            }
            if (value.type === 'state' && value.state === 'closed') {
                clear();
                scope = undefined;
            }
        },
        async attack(system, fleetId, targetId, revision) {
            if (closed || !scope || system !== systemId)
                throw new Error('Current system detail is required');
            const accepted = scope;
            if ((order || pending) && !await reconcile(system, fleetId, targetId))
                return;
            if (closed || scope !== accepted || system !== systemId)
                throw new Error('Current system detail is required');
            order = { action: 'schedule', systemId: system, fleetId, targetId, commandId: crypto.randomUUID().replace(/-/g, ''), expectedRevision: revision.toString() };
            setText(text, 'Planning approach…');
            await perform(order);
        },
        dispose() { closed = true; unwatch(); clear(); scope = undefined; order = undefined; panel.remove(); },
    };
}
function validateRetry(command, system, fleet, target) {
    if (command.systemId !== system)
        throw new Error('Resolve the unconfirmed engagement in its original system first.');
    if (command.action === 'schedule' && (command.fleetId !== fleet || command.targetId !== target))
        throw new Error('Retry the unconfirmed engagement before issuing a different attack.');
}
//# sourceMappingURL=online-encounters.js.map