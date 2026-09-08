import { createStrategicOverview } from './strategic-overview.js';
export function createOnlinePanel(parent) {
    const panel = document.createElement('section');
    panel.className = 'online-panel';
    panel.innerHTML = `
    <h1>Galaxy</h1><p class="online-caption">Persistent multiplayer</p>
    <form class="online-connect">
      <label>Server<input name="server" type="url" value="https://localhost:4433/session" required></label>
      <label>Fallback server<input name="fallback" type="url" value="ws://127.0.0.1:4435/session" required></label>
      <label>Access code<input name="credential" type="password" autocomplete="off" spellcheck="false" required></label>
      <button type="submit">Connect</button>
    </form>
    <p class="online-status" role="status" aria-live="polite">Starting the map…</p>
    <div class="online-orders" hidden>
      <label>Choose a system<select class="online-systems" aria-label="Viewing system"></select></label>
      <button type="button" data-action="view">View system</button>
      <label>Your ships<select class="online-ships" aria-label="Your ships"></select></label>
      <span class="online-page"></span><button type="button" data-action="first">First page</button><button type="button" data-action="more" hidden>Next page</button>
      <button type="button" data-action="focus">Follow selected ship</button>
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
    const ships = find('.online-ships');
    const systems = find('.online-systems');
    const destinations = find('.online-destinations');
    const status = find('.online-status');
    const preview = find('.online-preview');
    const input = (name) => find(`input[name="${name}"]`);
    const buttons = Array.from(panel.querySelectorAll('button'));
    const overview = createStrategicOverview(find('.online-orders'));
    const retained = find('.online-retained');
    let busy = false;
    let blocked = false;
    let orders = [];
    function updateButtons() {
        var _a;
        for (const button of buttons)
            button.disabled = busy;
        find('[data-action="move"]').disabled = busy || blocked;
        find('[data-action="transfer"]').disabled = busy || blocked || !destinations.options.length;
        updateRecoveryButtons();
        find('[data-action="route"]').disabled = busy || !destinations.options.length;
        for (const name of ['move', 'transfer', 'preview', 'route', 'focus']) {
            (_a = find(`[data-action="${name}"]`)).disabled || (_a.disabled = !ships.value);
        }
    }
    function updateRecoveryButtons() {
        const selected = orders.find(value => value.key === retained.value);
        find('[data-action="continue"]').disabled = busy || !selected?.expired || selected.continued;
        for (const name of ['resolve', 'retry'])
            find(`[data-action="${name}"]`).disabled = busy || !selected;
    }
    function updateRecovery() {
        const selected = orders.find(value => value.key === retained.value);
        const copy = selected?.expired
            ? 'This order’s submission window has expired. Its outcome is still unknown and it may still complete. Continuing allows a separate new order; it does not cancel or retry this one.'
            : 'This original order remains unresolved. Check or retry it before issuing another order.';
        find('.online-recovery-message').textContent = selected?.continued
            ? 'You chose to continue. This original order remains unresolved and may still complete. Keep this page open to check or retry it.' : copy;
        find('[data-action="continue"]').hidden = !selected?.expired || selected.continued;
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
        form, ships, systems, destinations, retained, overview,
        action(name) { return find(`[data-action="${name}"]`); },
        credentials: () => ({ server: input('server').value, fallback: input('fallback').value, credential: input('credential').value.trim() }),
        target: () => ({ x: coordinate('x'), z: coordinate('z') }),
        status(message) { status.textContent = message; },
        preview(message) { preview.textContent = message; },
        jumpLabel(name) { find('[data-action="transfer"]').textContent = name ? `Jump to ${name}` : 'Jump'; },
        onRouteChange(listener) {
            for (const element of [ships, destinations, input('x'), input('z')])
                element.addEventListener('change', listener);
        },
        connected(value) { find('.online-orders').hidden = !value; form.querySelector('button').textContent = value ? 'Reconnect' : 'Connect'; },
        busy(value) { busy = value; updateButtons(); },
        recovery(values, canIssue) {
            const selected = retained.value;
            orders = values;
            blocked = !canIssue;
            retained.replaceChildren(...values.map(value => {
                const option = document.createElement('option');
                option.value = value.key;
                option.textContent = `Ship ${value.shipId.slice(-6)} · order ${value.commandId.slice(-8)} · ${value.continued ? 'continued, unresolved' : 'unresolved'}`;
                return option;
            }));
            const blocking = values.find(value => !value.continued);
            retained.value = blocking?.key ?? values.find(value => value.key === selected)?.key ?? values[0]?.key ?? '';
            find('.online-recovery').hidden = !values.length;
            updateRecovery();
        },
        setTopology(topology, current) {
            const hosted = new Set(topology.hostedSystemIds);
            const permitted = new Set(topology.systems.filter(system => system.id !== current).map(system => system.id));
            for (const [select, accepted] of [[systems, hosted], [destinations, permitted]]) {
                select.replaceChildren(...topology.systems.filter(system => accepted.has(system.id)).map(system => {
                    const option = document.createElement('option');
                    option.value = system.id;
                    option.textContent = system.name;
                    return option;
                }));
            }
            systems.value = current;
            updateButtons();
        },
        setShips(values, offset, total, more) {
            find('.online-page').textContent = total ? `${offset + 1}–${offset + values.length} of ${total}` : 'No controllable ships in this system';
            find('[data-action="more"]').hidden = !more;
            const selected = ships.value;
            ships.replaceChildren(...values.map(value => {
                const option = document.createElement('option');
                option.value = value.id;
                option.textContent = `Ship ${value.id.slice(-6)}${value.moving ? ' · moving' : ''}`;
                return option;
            }));
            if (values.some(value => value.id === selected))
                ships.value = selected;
            updateButtons();
        },
        dispose: () => panel.remove(),
    };
}
//# sourceMappingURL=online-panel.js.map