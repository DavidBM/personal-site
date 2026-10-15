import { onlineShellMarkup, bindOnlineShell } from './online-shell.js';
import { bindText, bindOptions, setText, setDisabled } from './dom-bindings.js';
import { createStrategicOverview } from './strategic-overview.js';
export function createOnlinePanel(parent) {
    const panel = document.createElement('section');
    panel.className = 'online-game';
    panel.innerHTML = onlineShellMarkup();
    parent.appendChild(panel);
    const shell = bindOnlineShell(panel);
    const find = (selector) => panel.querySelector(selector);
    const form = find('form');
    const fleets = find('.online-fleets');
    const systems = find('.online-systems');
    const destinations = find('.online-destinations');
    const status = bindText(find('.online-status'), { height: '2.8em', wrap: true }), preview = bindText(find('.online-preview'), { height: '4.5em', wrap: true });
    const inputs = new Map(Array.from(panel.querySelectorAll('input')).map(input => [input.name, input]));
    const input = (name) => inputs.get(name);
    const buttons = Array.from(panel.querySelectorAll('[data-action], form button[type=submit]'));
    const actions = new Map(buttons.filter(button => button.dataset.action).map(button => [button.dataset.action, button]));
    const action = (name) => actions.get(name);
    const orderPanel = find('.online-orders'), recoveryPanel = find('.online-recovery');
    const recoveryText = bindText(find('.online-recovery-message'), { height: '10em', wrap: true }), pageText = bindText(find('.online-page'));
    const connectText = bindText(form.querySelector('button'), { width: '12ch', height: '24px' }), jumpText = bindText(action('transfer'), { height: '24px' });
    const navigationPanel = find('.online-navigation .ui-panel-content'), fleetPanel = find('.online-fleet-panel .ui-panel-content');
    const rosterPanel = find('.online-roster-panel'), activityPanel = find('.online-activity .ui-panel-content'), planetPanel = find('.online-planets .ui-panel-content');
    const overview = createStrategicOverview(navigationPanel);
    const retained = find('.online-retained');
    const signIn = document.createElement('a');
    signIn.href = './';
    signIn.textContent = 'Sign in again';
    signIn.hidden = true;
    form.after(signIn);
    const fleetOptions = bindOptions(fleets), systemOptions = bindOptions(systems);
    const destinationOptions = bindOptions(destinations), retainedOptions = bindOptions(retained);
    let busy = false;
    let blocked = false;
    let orders = [];
    const needsFleet = new Set(['move', 'transfer', 'preview', 'route', 'focus', 'details']);
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
        root: panel, dockWindows: shell.windows, form, fleets, systems, destinations, retained, overview,
        action, input, orderPanel, navigationPanel, fleetPanel, rosterPanel, activityPanel, planetPanel, accountPanel: form.parentElement, show: shell.show,
        credentials: () => ({ server: input('server').value, fallback: input('fallback').value, credential: input('credential').value.trim(), pin: input('pin').value.trim() }),
        target: () => ({ x: coordinate('x'), z: coordinate('z') }),
        status(message) { setText(status, message); },
        signInRequired(value) { signIn.hidden = !value; if (value)
            shell.show('account'); },
        preview(message) { setText(preview, message); },
        jumpLabel(name) { setText(jumpText, name ? `Travel to ${name}` : 'Travel'); },
        onRouteChange(listener) {
            for (const element of [fleets, destinations, input('x'), input('z')])
                element.addEventListener('change', listener);
        },
        connected(value) { orderPanel.inert = !value; action('signout').hidden = !value; setText(connectText, value ? 'Reconnect' : 'Connect'); },
        busy(value) { busy = value; updateButtons(); },
        recovery(values, canIssue) {
            if (values.length && !orders.length)
                shell.show('fleet');
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