import { consumeDevLogin } from './online-login.js';
import { App } from '../app.js';
import { createOnlinePanel } from '../ui/online-panel.js';
import { createOnlineIntents } from './online-intents.js';
import { createDomainClient } from '../features/fleets/domain/client.js';
import { sameToken } from '../features/fleets/domain/seed.js';
import { createOnlineInspector } from './online-inspector.js';
import { opaqueIdAt } from '../contracts/opaque-id.js';
import { createOnlineOverview } from './online-overview.js';
import { previewOnlineRoute, routeStillCurrent, sameRouteSelection } from './online-route-preview.js';
let devLogin = consumeDevLogin(window);
let pageClosed = false;
const app = new App({ authority: 'online' });
const inspection = new URLSearchParams(location.search).get('inspect') === '1' ? createOnlineInspector(app) : undefined;
// Explicit development API references this existing App; it creates no second game.
if (inspection)
    Object.assign(window, { __galaxyOnlineInspector: inspection });
const panel = createOnlinePanel(document.body);
const intents = createOnlineIntents();
const overview = createOnlineOverview(panel.overview, () => app.online ?? undefined);
let refreshTimer;
let refreshing = false;
let refreshDirty = false;
let nextPage;
let displayedOffset = 0;
let listGeneration = 0;
let activeOwner = '';
let pendingOwner = '';
let domain;
let routeTopology;
let routePreview;
let busy = false;
const message = (error) => error instanceof Error ? error.message : String(error);
const identity = () => crypto.randomUUID().replace(/-/g, '');
const tracedOrder = (commandId, send) => inspection ? inspection.command(commandId, send) : send();
function connected() {
    if (!app.online)
        throw new Error('Connect to a server first');
    if (intents.size() && activeOwner !== pendingOwner)
        throw new Error('Reconnect to the account that issued the pending order');
    return app.online;
}
async function action(run) {
    if (busy)
        return;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    busy = true;
    panel.busy(true);
    try {
        await run();
    }
    catch (error) {
        panel.status(message(error));
    }
    finally {
        busy = false;
        panel.busy(false);
        syncRecovery();
        if (refreshDirty)
            scheduleRefresh();
    }
}
function syncRecovery() { panel.recovery(intents.list(), intents.canIssue()); }
function continueOrder() {
    connected();
    intents.continueExpired(panel.retained.value);
    panel.status(intents.canIssue()
        ? 'You may issue a separate new order. The original remains unresolved and may still complete.'
        : 'The original remains unresolved and may still complete. Resolve a retained order before submitting more.');
    syncRecovery();
}
function receipt(value) {
    const original = intents.observe(value);
    switch (value.result.case) {
        case 'accepted':
            // Receipt events may also settle the awaited request. Only the first
            // observation owns the retained command and changes its status copy.
            if (original)
                panel.status(original.$typeName === 'galaxy.v1.TransferCommand'
                    ? 'Ship departed. Arrival is not confirmed yet.'
                    : 'Order accepted. The ship is moving to its destination.');
            break;
        case 'rejected':
            panel.status('The server rejected this order. Refresh the ship state and try again.');
            break;
        default: panel.status('The outcome is unknown. Check or retry the original order.');
    }
    syncRecovery();
}
function event(value) {
    if (value.type === 'welcome')
        activeOwner = `${value.worldId}:${value.playerId}`;
    if (value.type === 'topology') {
        routeTopology = value.topology;
        clearRoute();
        panel.setTopology(value.topology, value.subscription.systemId);
        overview.connect(value.topology, value.subscription.systemId);
    }
    if (value.type === 'received' && value.snapshotComplete)
        scheduleRefresh();
    if (value.type === 'receipt')
        receipt(value.receipt);
    if (value.type === 'unknown') {
        panel.status('Connection interrupted. The original order is retained on this page.');
        syncRecovery();
    }
    if (value.type === 'error')
        panel.status(value.message);
    if (value.type === 'state' && value.state === 'closed') {
        routeTopology = undefined;
        clearRoute();
        overview.clear();
        panel.status('Disconnected. Reconnect to resolve pending orders.');
    }
}
function scheduleRefresh() {
    refreshDirty = true;
    if (refreshTimer || refreshing || busy)
        return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh().catch(error => panel.status(message(error))); }, 150);
}
async function refresh() {
    if (refreshing) {
        refreshDirty = true;
        return;
    }
    const session = connected();
    const generation = listGeneration;
    refreshing = true;
    refreshDirty = false;
    try {
        const watermark = session.received();
        const offset = displayedOffset;
        const required = offset && watermark ? { connectionGeneration: session.generation, watermark } : undefined;
        const page = await session.ownedShips({ offset, required, limit: 256 });
        if (app.online === session && generation === listGeneration) {
            nextPage = page.nextOffset === null ? undefined : { offset: page.nextOffset, required: page.seed.token };
            panel.setShips(page.ships, offset, page.total, !!nextPage);
        }
    }
    finally {
        refreshing = false;
        if (refreshDirty)
            scheduleRefresh();
    }
}
async function moreShips() {
    if (!nextPage)
        return;
    const generation = ++listGeneration;
    const session = connected();
    const cursor = nextPage;
    const page = await session.ownedShips({ ...cursor, limit: 256 });
    if (app.online !== session || generation !== listGeneration)
        return;
    displayedOffset = cursor.offset;
    nextPage = page.nextOffset === null ? undefined : { offset: page.nextOffset, required: page.seed.token };
    panel.setShips(page.ships, cursor.offset, page.total, !!nextPage);
}
function startDomain() {
    domain?.dispose();
    return createDomainClient(new Worker(new URL('../features/fleets/domain/worker-entry.js', import.meta.url), { type: 'module', name: 'galaxy-domain-preview' }), { type: 'initialize', mode: 'online-preview', moduleUrl: new URL('../wasm/game/galaxy_game_wasm.js', import.meta.url).href,
        wasmUrl: new URL('../wasm/game/galaxy_game_wasm_bg.wasm', import.meta.url).href }, { onAccepted() { throw new Error('Online preview unexpectedly emitted accepted state'); }, onError: error => panel.preview(error.message) });
}
async function connect(preferredSystemId) {
    const fields = panel.credentials();
    if (!/^[0-9a-f]{64}$/i.test(fields.credential))
        throw new Error('Enter the 64-character access code supplied with your account');
    const credential = Uint8Array.from(fields.credential.match(/../g), byte => Number.parseInt(byte, 16));
    panel.status('Connecting…');
    panel.preview('');
    displayedOffset = 0;
    listGeneration++;
    domain = startDomain();
    routeTopology = undefined;
    clearRoute();
    overview.clear();
    try {
        await Promise.all([domain.ready, app.connectOnline({ endpoints: { webTransportUrl: fields.server, webSocketUrl: fields.fallback }, credential,
                preferredSystemId,
                diagnostics: !!inspection,
                rememberIntent(value) { pendingOwner = activeOwner; intents.remember(value.command); }, onEvent: event, onStrategic: overview.refresh })]);
        connected();
    }
    catch (error) {
        domain.dispose();
        await app.online?.dispose();
        panel.connected(false);
        throw error;
    }
    panel.connected(true);
    panel.status('Connected. Select a ship and a destination.');
    await refresh();
}
async function preview() {
    const session = connected();
    const worker = domain;
    if (!worker)
        throw new Error('Shared rules are not ready');
    const shipId = panel.ships.value;
    const target = panel.target();
    const page = await session.ownedShips({ shipId });
    const token = page.seed.token;
    await worker.request({ type: 'seed', seed: page.seed });
    const result = await worker.request({ type: 'previewMove', move: { token, shipId, orderId: identity(),
            targetX: target.x, targetZ: target.z, nowMs: page.serverNowMs, expectedSystemRevision: token.watermark.systemRevision } });
    const watermark = session.received();
    if (app.online !== session || !watermark || !sameToken(token, { connectionGeneration: session.generation, watermark })) {
        panel.preview('The ship state changed. Preview again.');
        return;
    }
    panel.preview(result.code === 0 ? 'This move is valid in the current shared rules. The server will confirm the order.' : 'This move is not available in the current ship state.');
}
async function move() {
    if (!intents.canIssue())
        throw new Error('Resolve pending orders or explicitly continue an expired order before issuing another');
    const session = connected();
    const shipId = panel.ships.value;
    const target = panel.target();
    const commandId = identity();
    const page = await session.ownedShips({ shipId });
    panel.status('Submitting order…');
    receipt(await tracedOrder(commandId, context => session.move({ commandId, shipId, target,
        expectedSystemRevision: page.seed.token.watermark.systemRevision }, context)));
}
async function resolve(retry) {
    const command = intents.get(panel.retained.value);
    if (!command)
        return;
    const session = connected();
    panel.status('Resolving the original order…');
    receipt(await tracedOrder(opaqueIdAt(command.key.commandId), context => retry ? session.retry(command, context) : session.queryReceipt(command.key, context)));
}
async function transfer() {
    if (!intents.canIssue())
        throw new Error('Resolve pending orders or explicitly continue an expired order before issuing another');
    const session = connected();
    const selection = selectedRoute();
    const previous = routePreview;
    const current = previous && routeTopology && sameRouteSelection(previous.selection, selection)
        && routeStillCurrent(session, previous.result, routeTopology);
    const result = current ? previous.result : await previewRoute();
    // A distant selection needs an explicit click on the named next leg.
    if (result.path.byteLength > 32 && result !== previous?.result)
        return;
    const first = result.firstLeg;
    if (!first)
        throw new Error('Preview a reachable route first');
    const commandId = identity();
    panel.status('Submitting jump order…');
    receipt(await tracedOrder(commandId, context => session.transfer({ commandId, shipId: selection.shipId,
        target: { x: first.targetX, z: first.targetZ }, destinationSystemId: first.destinationSystemId,
        expectedSystemRevision: result.token.watermark.systemRevision }, context)));
    clearRoute();
}
function selectedRoute() {
    return { shipId: panel.ships.value, destinationSystemId: panel.destinations.value, target: panel.target() };
}
function clearRoute() { routePreview = undefined; panel.jumpLabel(); }
async function previewRoute() {
    const session = connected();
    const worker = domain;
    const topology = routeTopology;
    const selection = selectedRoute();
    if (!worker || !topology)
        throw new Error('Shared rules and system routes are not ready');
    if (!selection.destinationSystemId)
        throw new Error('Choose a route destination');
    const result = await previewOnlineRoute(session, worker, topology, selection);
    if (app.online !== session || domain !== worker || routeTopology !== topology
        || !sameRouteSelection(selection, selectedRoute()) || !routeStillCurrent(session, result, topology)) {
        clearRoute();
        throw new Error('The route or ship state changed. Preview again.');
    }
    if (result.code !== 0 || !result.firstLeg) {
        clearRoute();
        throw new Error(result.code === 103 ? 'No route connects these systems.' : 'This route is not available in the current ship state.');
    }
    const names = new Map(topology.systems.map(system => [system.id, system.name]));
    const path = Array.from({ length: result.path.byteLength / 16 }, (_, i) => names.get(opaqueIdAt(result.path, i * 16)) ?? 'System');
    routePreview = { selection, result };
    panel.jumpLabel(names.get(result.firstLeg.destinationSystemId));
    panel.preview(`${path.join(' → ')} · ${path.length - 1} jumps · ${Number(result.totalTravelMs) / 1000}s travel. Jump sends only the next leg; the server confirms departure.`);
    return result;
}
panel.form.addEventListener('submit', e => { e.preventDefault(); void action(connect); });
panel.action('preview').addEventListener('click', () => { void action(preview); });
panel.action('route').addEventListener('click', () => { void action(async () => { await previewRoute(); }); });
panel.onRouteChange(clearRoute);
panel.action('move').addEventListener('click', () => { void action(move); });
panel.action('transfer').addEventListener('click', () => { void action(transfer); });
panel.action('view').addEventListener('click', () => { const systemId = panel.systems.value; void action(() => connect(systemId)); });
panel.overview.onView(systemId => { void action(() => connect(systemId)); });
panel.action('continue').addEventListener('click', () => { void action(async () => continueOrder()); });
panel.action('resolve').addEventListener('click', () => { void action(() => resolve(false)); });
panel.action('retry').addEventListener('click', () => { void action(() => resolve(true)); });
panel.action('more').addEventListener('click', () => { void action(moreShips); });
panel.action('first').addEventListener('click', () => { void action(async () => { displayedOffset = 0; listGeneration++; await refresh(); }); });
panel.action('focus').addEventListener('click', () => {
    void action(async () => {
        connected();
        await app.followOnlineShip(panel.ships.value);
    });
});
panel.busy(true);
void app.initialize().then(() => {
    if (pageClosed)
        return;
    panel.busy(false);
    const login = devLogin;
    devLogin = undefined;
    if (!login) {
        panel.status('Enter your account access code to connect.');
        return;
    }
    for (const [name, value] of [['server', ''], ['fallback', login.endpoint], ['credential', login.credential]]) {
        panel.form.querySelector(`input[name="${name}"]`).value = value;
    }
    // Local launch uses explicit WS; no certificate bypass or remote endpoint attempt.
    panel.form.querySelector('input[name="server"]').required = false;
    void action(() => connect(login.systemId));
}).catch(error => { devLogin = undefined; panel.status(message(error)); });
window.addEventListener('pagehide', () => {
    pageClosed = true;
    devLogin = undefined;
    clearTimeout(refreshTimer);
    overview.dispose();
    domain?.dispose();
    inspection?.dispose();
    void app.dispose();
    if (inspection)
        Reflect.deleteProperty(window, '__galaxyOnlineInspector');
}, { once: true });
//# sourceMappingURL=online-entry.js.map