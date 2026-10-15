import { requestTesterFleet, requestFleetOwners } from '../features/http-worker/tester-fleet.js';
import { FeatureError } from '../features/http-worker/client.js';
import { bindText, setText } from '../ui/dom-bindings.js';
import { markTester } from '../ui/tester-badge.js';
export function createOnlineTesterFleets(parent, enabled) {
    const panel = document.createElement('section'), label = document.createElement('div'), output = document.createElement('output'), retry = document.createElement('button');
    label.textContent = 'Fleet authoring';
    markTester(label);
    const text = bindText(output, { height: '3.5em', wrap: true });
    retry.textContent = 'Retry creation';
    retry.type = 'button';
    markTester(retry);
    retry.disabled = true;
    panel.hidden = !enabled;
    panel.append(label, output, retry);
    parent.append(panel);
    setText(text, 'Deselect your fleet, then right-click open space to create one.');
    let greeting, scope, system = '', request = 0n, epoch = 0n, closed = false;
    let pending, command;
    function clear() { pending?.abort(); pending = undefined; scope = undefined; system = ''; retry.disabled = true; }
    function accepted(s) {
        const t = s.displayed;
        return s.state === 'ready' && !s.stale && !!t && t.connection === greeting?.generation && t.request === request && t.epoch >= epoch && s.requested?.kind === 'detail';
    }
    function unchanged(s) {
        return accepted(s) && !!scope && s.displayed?.epoch === epoch && s.requested?.kind === 'detail' && s.requested.systemId === system;
    }
    function failure(e, owner) {
        if (pending !== owner)
            return;
        setText(text, e instanceof Error ? e.message : 'Creation unconfirmed');
        if (e instanceof FeatureError && [400, 401, 403, 409, 412].includes(e.status ?? 0))
            command = undefined;
    }
    function greet(value) {
        clear();
        if (greeting?.worldId !== value.worldId)
            command = undefined;
        greeting = value;
        epoch = request = 0n;
    }
    function detail(value) {
        const s = value.status;
        if (s.slot !== 'detail' || s.requestedGeneration < request)
            return;
        request = s.requestedGeneration;
        const valid = accepted(s);
        if (unchanged(s))
            return;
        clear();
        if (!valid || s.requested?.kind !== 'detail')
            return;
        epoch = s.displayed.epoch;
        system = s.requested.systemId;
        if (greeting)
            scope = { worldId: greeting.worldId, visibilityEpoch: epoch.toString() };
        retry.disabled = !command || command.systemId !== system;
    }
    async function perform() {
        if (closed || pending || !scope || !command || command.systemId !== system)
            return;
        const owner = new AbortController();
        pending = owner;
        retry.disabled = true;
        try {
            const r = await requestTesterFleet(scope, command, owner.signal);
            if (pending !== owner)
                return;
            command = undefined;
            setText(text, `Fleet ${r.fleetId.slice(-8)} created. It will appear with the next accepted projection.`);
        }
        catch (e) {
            failure(e, owner);
        }
        finally {
            if (pending === owner) {
                pending = undefined;
                retry.disabled = !command;
            }
        }
    }
    retry.onclick = () => { void perform(); };
    return { reconnect(allowed) { clear(); enabled = allowed; panel.hidden = !enabled; epoch = request = 0n; }, event(value) {
            if (value.type === 'welcome') {
                greet(value);
                return;
            }
            if ('generation' in value && value.generation !== greeting?.generation)
                return;
            if (value.type === 'viewChanged')
                detail(value);
            if (value.type === 'viewBarrier' && value.epoch > epoch) {
                clear();
                epoch = value.epoch;
            }
            if (value.type === 'state' && value.state === 'closed')
                clear();
        }, async owners(systemId, after, signal) {
            if (!enabled || !scope || systemId !== system)
                throw new Error('Tester permission and current system detail are required');
            const accepted = scope;
            const result = await requestFleetOwners(accepted, systemId, after, signal);
            if (scope !== accepted || system !== systemId)
                throw new Error('Creation permission changed');
            return result;
        }, async create(systemId, counts, position, ownerId) {
            if (!enabled || !scope || systemId !== system)
                throw new Error('Tester permission and current system detail are required');
            if (command)
                throw new Error('Retry the previous creation first');
            command = { systemId, ownerId, commandId: crypto.randomUUID().replace(/-/g, ''), counts, position: [position.x, position.y, position.z] };
            setText(text, 'Creating fleet…');
            await perform();
        }, dispose() { closed = true; clear(); command = undefined; panel.remove(); } };
}
//# sourceMappingURL=online-tester-fleets.js.map