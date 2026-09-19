import { consumeDevLogin, parseLauncherEndpoints } from './online-login.js';
import { App } from '../app.js';
import { createOnlinePanel } from '../ui/online-panel.js';
import { createOnlineIntents } from './online-intents.js';
import { createDomainClient } from '../features/fleets/domain/client.js';
import { sameToken } from '../features/fleets/domain/seed.js';
import { createOnlineFleetList } from './online-fleet-list.js';
import { createOnlineInspector } from './online-inspector.js';
import { opaqueIdAt } from '../contracts/opaque-id.js';
import { createOnlineRoster } from './online-roster.js';
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
const roster = createOnlineRoster(panel.form.parentElement.querySelector('.online-orders'), query => connected().ownedRoster(query), system => { void action(() => selectSystem(system)); });
let refreshTimer;
let refreshing = false;
let refreshDirty = false;
const fleetList = createOnlineFleetList((page, offset) => panel.setFleets(page?.fleets ?? [], offset, page?.total ?? 0, page?.nextOffset != null));
function invalidateFleetList() { clearTimeout(refreshTimer); refreshTimer = undefined; refreshDirty = false; fleetList.invalidate(); clearRoute(); }
function clearTopology() { routeTopology = undefined; overview.clear(); panel.clearTopology(); invalidateFleetList(); }
let viewInterests;
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
                    ? 'Fleet departed. Arrival is not confirmed yet.'
                    : 'Order accepted. The fleet is moving to its destination.');
            break;
        case 'rejected':
            panel.status('The server rejected this order. Refresh the fleet state and try again.');
            break;
        default: panel.status('The outcome is unknown. Check or retry the original order.');
    }
    syncRecovery();
}
function event(value) {
    roster.event(value);
    switch (value.type) {
        case 'viewInterests':
            viewInterests = value.interests;
            return;
        case 'welcome':
            activeOwner = `${value.worldId}:${value.playerId}`;
            return;
        case 'topology':
            routeTopology = value.topology;
            clearRoute();
            panel.setTopology(value.topology, value.subscription.systemId);
            overview.connect(value.topology, value.subscription.systemId);
            return;
        case 'viewBarrier':
            clearTopology();
            return;
        case 'viewChanged':
            viewChanged(value.status);
            return;
        case 'received':
            if (value.snapshotComplete)
                scheduleRefresh();
            return;
        default: orderEvent(value);
    }
}
function orderEvent(value) {
    switch (value.type) {
        case 'receipt':
            receipt(value.receipt);
            return;
        case 'unknown':
            panel.status('Connection interrupted. The original order is retained on this page.');
            syncRecovery();
            return;
        case 'error':
            panel.status(value.message);
            return;
        case 'state':
            if (value.state === 'closed') {
                clearTopology();
                panel.status('Disconnected. Reconnect to resolve pending orders.');
            }
            return;
    }
}
function viewChanged(status) {
    if (status.state === 'ready')
        return;
    if (status.slot === 'detail')
        invalidateFleetList();
    if (status.slot === 'overview')
        clearTopology();
}
function scheduleRefresh() {
    refreshDirty = true;
    if (refreshTimer || refreshing)
        return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh().catch(error => panel.status(message(error))); }, 150);
}
async function refresh() {
    if (refreshing) {
        refreshDirty = true;
        return;
    }
    const session = connected();
    refreshing = true;
    refreshDirty = false;
    try {
        await fleetList.read(query => session.ownedFleets(query), false);
    }
    finally {
        refreshing = false;
        if (refreshDirty)
            scheduleRefresh();
    }
}
async function moreFleets() { const session = connected(); await fleetList.read(query => session.ownedFleets(query), true); }
function startDomain() {
    domain?.dispose();
    return createDomainClient(new Worker(new URL('../features/fleets/domain/worker-entry.js', import.meta.url), { type: 'module', name: 'galaxy-domain-preview' }), { type: 'initialize', mode: 'online-preview', moduleUrl: new URL('../wasm/game/galaxy_game_wasm.js', import.meta.url).href,
        wasmUrl: new URL('../wasm/game/galaxy_game_wasm_bg.wasm', import.meta.url).href }, { onAccepted() { throw new Error('Online preview unexpectedly emitted accepted state'); }, onError: error => panel.preview(error.message) });
}
async function connect(preferredSystemId) {
    const fields = panel.credentials();
    if (!/^[0-9a-f]{64}$/i.test(fields.credential))
        throw new Error('Enter the 64-character access code supplied with your account');
    if (fields.pin && !/^[0-9a-f]{64}$/i.test(fields.pin))
        throw new Error('Enter a 64-character certificate SHA-256');
    const certificateHashes = fields.pin ? [{ algorithm: 'sha-256', value: Uint8Array.from(fields.pin.match(/../g), byte => Number.parseInt(byte, 16)) }] : undefined;
    const credential = Uint8Array.from(fields.credential.match(/../g), byte => Number.parseInt(byte, 16));
    panel.status('Connecting…');
    panel.preview('');
    invalidateFleetList();
    domain = startDomain();
    routeTopology = undefined;
    clearRoute();
    overview.clear();
    try {
        await Promise.all([domain.ready, app.connectOnline({ endpoints: { webTransportUrl: fields.server, webSocketUrl: fields.fallback, certificateHashes }, credential,
                preferredSystemId, viewInterests,
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
    panel.status('Connected. The map and your fleet roster are available independently of system detail.');
    if (connected().received())
        await refresh();
}
async function preview() {
    const session = connected();
    const worker = domain;
    if (!worker)
        throw new Error('Shared rules are not ready');
    const fleetId = panel.fleets.value;
    const target = panel.target();
    const page = await session.ownedFleets({ fleetId });
    const token = page.seed.token;
    await worker.request({ type: 'seed', seed: page.seed });
    const result = await worker.request({ type: 'previewMove', move: { token, fleetId, orderId: identity(),
            targetX: target.x, targetZ: target.z, nowMs: page.serverNowMs, expectedSystemRevision: token.watermark.systemRevision } });
    const watermark = session.received();
    if (app.online !== session || !watermark || !sameToken(token, { connectionGeneration: session.generation, watermark })) {
        panel.preview('The fleet state changed. Preview again.');
        return;
    }
    panel.preview(result.code === 0 ? 'This move is valid in the current shared rules. The server will confirm the order.' : 'This move is not available in the current fleet state.');
}
async function move() {
    if (!intents.canIssue())
        throw new Error('Resolve pending orders or explicitly continue an expired order before issuing another');
    const session = connected();
    const fleetId = panel.fleets.value;
    const target = panel.target();
    const commandId = identity();
    const page = await session.ownedFleets({ fleetId });
    panel.status('Submitting order…');
    receipt(await tracedOrder(commandId, context => session.move({ commandId, fleetId, target,
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
    receipt(await tracedOrder(commandId, context => session.transfer({ commandId, fleetId: selection.fleetId,
        target: { x: first.targetX, z: first.targetZ }, destinationSystemId: first.destinationSystemId,
        expectedSystemRevision: result.token.watermark.systemRevision }, context)));
    clearRoute();
}
async function selectSystem(systemId) {
    const session = connected();
    await session.selectSystem(systemId);
    if (app.online !== session || session.subscription()?.systemId !== systemId || !routeTopology)
        return;
    panel.setTopology(routeTopology, systemId);
    overview.connect(routeTopology, systemId);
}
function selectedRoute() {
    return { fleetId: panel.fleets.value, destinationSystemId: panel.destinations.value, target: panel.target() };
}
function clearRoute() { routePreview = undefined; panel.jumpLabel(); }
function previewStillCurrent(session, worker, topology, selection, result) {
    return app.online === session && domain === worker && routeTopology === topology && sameRouteSelection(selection, selectedRoute()) && routeStillCurrent(session, result, topology);
}
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
    if (!previewStillCurrent(session, worker, topology, selection, result)) {
        clearRoute();
        throw new Error('The route or fleet state changed. Preview again.');
    }
    if (result.code !== 0 || !result.firstLeg) {
        clearRoute();
        throw new Error(result.code === 103 ? 'No route connects these systems.' : 'This route is not available in the current fleet state.');
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
panel.action('galaxy').addEventListener('click', () => { void action(async () => { await connected().replaceView('overview', { kind: 'overview', scope: { kind: 'galaxy' } }); }); });
panel.action('region').addEventListener('click', () => { const id = panel.systems.value; if (id)
    void action(async () => { await connected().replaceView('overview', { kind: 'overview', scope: { kind: 'systems', ids: [id] } }); }); });
panel.action('view').addEventListener('click', () => { const systemId = panel.systems.value; void action(() => selectSystem(systemId)); });
panel.overview.onView(systemId => { void action(() => selectSystem(systemId)); });
panel.action('continue').addEventListener('click', () => { void action(async () => continueOrder()); });
panel.action('resolve').addEventListener('click', () => { void action(() => resolve(false)); });
panel.action('retry').addEventListener('click', () => { void action(() => resolve(true)); });
panel.action('more').addEventListener('click', () => { void action(moreFleets); });
panel.action('first').addEventListener('click', () => { void action(async () => { invalidateFleetList(); await refresh(); }); });
panel.action('focus').addEventListener('click', () => {
    void action(async () => {
        connected();
        await app.followOnlineFleet(panel.fleets.value);
    });
});
function field(name) {
    return panel.form.querySelector(`input[name="${name}"]`);
}
function useLoopback(endpoint, credential) {
    field('server').value = '';
    field('server').required = false;
    field('fallback').value = endpoint;
    if (credential !== undefined)
        field('credential').value = credential;
}
async function launcherWebSocket() {
    try {
        const response = await fetch('/dist/galaxy-launcher.json', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
        if (!response.ok)
            return;
        return parseLauncherEndpoints(await response.json(), location.href);
    }
    catch {
        return;
    }
}
panel.busy(true);
void app.initialize().then(async () => {
    if (pageClosed)
        return;
    const login = devLogin;
    devLogin = undefined;
    if (login) {
        panel.busy(false);
        useLoopback(login.endpoint, login.credential);
        void action(() => connect(login.systemId));
        return;
    }
    const endpoint = await launcherWebSocket();
    if (pageClosed)
        return;
    if (endpoint)
        useLoopback(endpoint);
    panel.busy(false);
    panel.status('Enter your account access code to connect.');
}).catch(error => { devLogin = undefined; panel.status(message(error)); });
window.addEventListener('pagehide', () => {
    pageClosed = true;
    devLogin = undefined;
    clearTimeout(refreshTimer);
    roster.dispose();
    overview.dispose();
    domain?.dispose();
    inspection?.dispose();
    void app.dispose();
    if (inspection)
        Reflect.deleteProperty(window, '__galaxyOnlineInspector');
}, { once: true });
//# sourceMappingURL=online-entry.js.map