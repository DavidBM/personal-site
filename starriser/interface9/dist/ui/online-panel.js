import { bindText, bindOptions, setText, setDisabled } from './dom-bindings.js';
import { createStrategicOverview } from './strategic-overview.js';
export function createOnlinePanel(parent) {
    const panel = document.createElement('section');
    panel.className = 'online-panel';
    panel.innerHTML = `
    <h1>Galaxy</h1><p class="online-caption">Persistent multiplayer</p>
    <form class="online-connect">
      <label>Server<input name="server" type="url" value="https://localhost:4433/session" required></label>
      <label>Fallback server<input name="fallback" type="url" value="ws://127.0.0.1:4435/session" required></label>
      <label>Server certificate SHA-256 (optional)<input name="pin" spellcheck="false" autocomplete="off"></label>
      <label>Access code<input name="credential" type="password" autocomplete="off" spellcheck="false" required></label>
      <button type="submit">Connect</button>
    </form>
    <p class="online-status" role="status" aria-live="polite">Starting the map…</p>
    <div class="online-orders" hidden>
      <label>Choose a system<select class="online-systems" aria-label="Viewing system"></select></label>
      <button type="button" data-action="view">View system</button>
      <button type="button" data-action="galaxy">Whole galaxy</button><button type="button" data-action="region">Selected system region</button>
      <label>Your fleets<select class="online-fleets" aria-label="Your fleets"></select></label>
      <span class="online-page"></span><button type="button" data-action="first">First page</button><button type="button" data-action="more" hidden>Next page</button>
      <button type="button" data-action="focus">Follow selected fleet</button>
      <div class="online-target"><label>Destination X<input name="x" type="number" step="0.001" value="0.025"></label>
        <label>Destination Z<input name="z" type="number" step="0.001" value="0.015"></label></div>
      <div class="online-buttons"><button type="button" data-action="preview">Preview</button><button type="button" data-action="move">Move</button></div>
      <label>Route destination<select class="online-destinations" aria-label="Jump destination"></select></label>
      <button type="button" data-action="route">Preview route</button>
      <button type="button" data-action="transfer">Jump</button>
      <p class="online-preview" role="status"></p>
      <div class="online-recovery" hidden>
        <label>Retained orders<select class="online-retained" aria-label="Retained orders"></select></label>
        <p class="online-recovery-message"></p>
        <button type="button" data-action="resolve">Check original order</button><button type="button" data-action="retry">Retry original order</button>
        <button type="button" data-action="continue">Continue with a new order</button></div>
    </div>`;
    parent.appendChild(panel);
    const find = (selector) => panel.querySelector(selector);
    const form = find('form');
    const fleets = find('.online-fleets');
    const systems = find('.online-systems');
    const destinations = find('.online-destinations');
    const status = bindText(find('.online-status'), { height: '4.5em', wrap: true }), preview = bindText(find('.online-preview'), { height: '4.5em', wrap: true });
    const inputs = new Map(Array.from(panel.querySelectorAll('input')).map(input => [input.name, input]));
    const input = (name) => inputs.get(name);
    const buttons = Array.from(panel.querySelectorAll('button'));
    const actions = new Map(buttons.filter(button => button.dataset.action).map(button => [button.dataset.action, button]));
    const action = (name) => actions.get(name);
    const orderPanel = find('.online-orders'), recoveryPanel = find('.online-recovery');
    const recoveryText = bindText(find('.online-recovery-message'), { height: '10em', wrap: true }), pageText = bindText(find('.online-page'));
    const connectText = bindText(form.querySelector('button'), { width: '12ch', height: '40px' }), jumpText = bindText(action('transfer'), { height: '40px' });
    const overview = createStrategicOverview(orderPanel);
    const retained = find('.online-retained');
    const fleetOptions = bindOptions(fleets), systemOptions = bindOptions(systems);
    const destinationOptions = bindOptions(destinations), retainedOptions = bindOptions(retained);
    let busy = false;
    let blocked = false;
    let orders = [];
    const needsFleet = new Set(['move', 'transfer', 'preview', 'route', 'focus']);
    function disabled(button) {
        const name = button.dataset.action ?? '';
        if (busy || (needsFleet.has(name) && !fleets.value))
            return true;
        if (['move', 'transfer'].includes(name) && blocked)
            return true;
        if (['transfer', 'route'].includes(name) && !destinations.options.length)
            return true;
        return false;
    }
    function updateButtons() {
        for (const button of buttons) {
            if (['continue', 'resolve', 'retry'].includes(button.dataset.action ?? ''))
                continue;
            setDisabled(button, disabled(button));
        }
        updateRecoveryButtons();
    }
    function updateRecoveryButtons() {
        const selected = orders.find(value => value.key === retained.value);
        setDisabled(action('continue'), busy || !selected?.expired || selected.continued);
        for (const name of ['resolve', 'retry'])
            setDisabled(action(name), busy || !selected);
    }
    function updateRecovery() {
        const selected = orders.find(value => value.key === retained.value);
        const copy = selected?.expired
            ? 'This order’s submission window has expired. Its outcome is still unknown and it may still complete. Continuing allows a separate new order; it does not cancel or retry this one.'
            : 'This original order remains unresolved. Check or retry it before issuing another order.';
        setText(recoveryText, selected?.continued
            ? 'You chose to continue. This original order remains unresolved and may still complete. Keep this page open to check or retry it.' : copy);
        action('continue').hidden = !selected?.expired || selected.continued;
        updateButtons();
    }
    retained.addEventListener('change', updateRecovery);
    function coordinate(name) {
        const text = input(name).value.trim();
        const value = Number(text);
        if (!text || !Number.isFinite(value))
            throw new Error('Enter a finite destination for both X and Z');
        return value;
    }
    return {
        form, fleets, systems, destinations, retained, overview,
        action, input, orderPanel,
        credentials: () => ({ server: input('server').value, fallback: input('fallback').value, credential: input('credential').value.trim(), pin: input('pin').value.trim() }),
        target: () => ({ x: coordinate('x'), z: coordinate('z') }),
        status(message) { setText(status, message); },
        preview(message) { setText(preview, message); },
        jumpLabel(name) { setText(jumpText, name ? `Jump to ${name}` : 'Jump'); },
        onRouteChange(listener) {
            for (const element of [fleets, destinations, input('x'), input('z')])
                element.addEventListener('change', listener);
        },
        connected(value) { orderPanel.hidden = !value; setText(connectText, value ? 'Reconnect' : 'Connect'); },
        busy(value) { busy = value; updateButtons(); },
        recovery(values, canIssue) {
            const selected = retained.value;
            orders = values;
            blocked = !canIssue;
            retainedOptions.update(values, value => value.key, value => `Fleet ${value.fleetId.slice(-6)} · order ${value.commandId.slice(-8)} · ${value.continued ? 'continued, unresolved' : 'unresolved'}`);
            const blocking = values.find(value => !value.continued);
            retained.value = blocking?.key ?? values.find(value => value.key === selected)?.key ?? values[0]?.key ?? '';
            recoveryPanel.hidden = !values.length;
            updateRecovery();
        },
        clearTopology() { systemOptions.clear(); destinationOptions.clear(); input('x').value = ''; input('z').value = ''; setText(preview, ''); updateButtons(); },
        setTopology(topology, current) {
            const hosted = new Set(topology.hostedSystemIds);
            const permitted = new Set(topology.systems.filter(system => system.id !== current).map(system => system.id));
            for (const [options, accepted] of [[systemOptions, hosted], [destinationOptions, permitted]]) {
                options.update(topology.systems.filter(system => accepted.has(system.id)), system => system.id, system => system.name);
            }
            systems.value = current;
            updateButtons();
        },
        setFleets(values, offset, total, more) {
            setText(pageText, total ? `${offset + 1}–${offset + values.length} of ${total}` : 'No controllable fleets in this system');
            action('more').hidden = !more;
            fleetOptions.update(values, value => value.id, value => `Fleet ${value.id.slice(-6)}${value.moving ? ' · moving' : ''}`);
            updateButtons();
        },
        dispose() {
            retained.removeEventListener('change', updateRecovery);
            overview.clear();
            fleetOptions.clear();
            systemOptions.clear();
            destinationOptions.clear();
            retainedOptions.clear();
            panel.remove();
        },
    };
}
//# sourceMappingURL=online-panel.js.map