import { notifyObserver } from '../lib/notify-observer.js';
import { createOwnedPlanetRoster } from './owned-planets.js';
import { createOwnedPlanetsPanel } from '../ui/owned-planets.js';
import { isMobileLayout } from '../ui/mobile-layout.js';
import { createPlanetSceneController } from './planet-development/scene.js';
import { createOnlineSelection } from './online-selection.js';
import { createOnlineRecovery } from './online-recovery.js';
import { configureFeatureWorker, disposeFeatureWorker } from '../features/http-worker/client.js';
import { readFleetOrbit } from '../contracts/fleet-orbit.js';
import { createOnlineGameplay } from './online-gameplay.js';
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
import { createOnlineContentPanel } from './online-content-panel.js';
import { createOnlineWorldNavigation } from './online-world-navigation.js';
import { waitForOnlineView } from './online-view-ready.js';
import { createPlanetInspector } from './planet-inspector.js';
import { createFleetCompositionPanel } from './fleet-composition-panel.js';
import { createOnlineFleetComposition } from './online-fleet-composition.js';
import { sameRouteSelection } from './online-route-preview.js';
import { AuthError, gameAccess, getSession, logout } from './web-auth-client.js';
import { renderResolutionControl } from '../ui/render-resolution-control.js';
import { gpuBudgetControl } from '../ui/gpu-budget-control.js';
import { BACKEND_RUNTIME } from './runtime-profile.js';
export function startOnline(webSession, runtime = BACKEND_RUNTIME) {
    if (runtime.workers.features)
        configureFeatureWorker(runtime.workers.features);
    let devLogin = consumeDevLogin(window);
    if (webSession)
        devLogin = undefined;
    let pageClosed = false;
    const panel = createOnlinePanel(document.body);
    const app = new App({ runtime, dockPanels: panel.dockWindows, onOnlineViewport: (camera, systemId) => { navigation.update(camera, systemId); },
        onOnlineFleetOwners: (system, after, signal) => { if (!onlineGameplay)
            throw new Error('Connect before creating fleets'); return onlineGameplay.fleetOwners(system, after, signal); },
        onOnlineFleetCreate: (system, counts, position, ownerId) => { void action(async () => { await onlineGameplay?.createFleet(system, counts, position, ownerId); }); },
        onOnlineFleetAttack: (systemId, fleetId, targetId) => { panel.show('activity'); if (busy) {
            panel.status('Another command is still being checked. Choose Fight again when it finishes.');
            return;
        } void action(async () => { const page = await connected().ownedFleets({ fleetId }); await onlineGameplay?.attack(systemId, fleetId, targetId, selectedFleetRevision(page, fleetId)); }); },
        onOnlineFleetOrbit: (systemId, fleetId, bodyIndex) => { void action(() => travelTo(systemId, fleetId, { x: 0, y: 0, z: 0 }, bodyIndex)); },
        onOnlineFleetMove: (systemId, fleetId, destination) => { void action(() => travelTo(systemId, fleetId, destination)); },
        onOnlinePlanetSelected: (systemId, bodyId) => { void viewPlanet(systemId, bodyId).catch(error => panel.status(message(error))); },
        onOnlineSystemSelected: id => { void action(() => selectSystem(id)); },
        onOnlineFleetGo: (id, mode) => { void action(() => goToFleet(id, mode)); }, onOnlineFleetDeselected: () => { selection.clear(); onlineGameplay?.setFleet(undefined, true); },
        onOnlineFleetSelected: (systemId, fleetId) => { selection.select(systemId, fleetId, app.commandFleet()); } });
    const inspection = new URLSearchParams(location.search).get('inspect') === '1' ? createOnlineInspector(app) : undefined;
    // Explicit development API references this existing App; it creates no second game.
    if (inspection)
        Object.assign(window, { __galaxyOnlineInspector: inspection });
    app.uiRoot.root.append(panel.root);
    app.uiRoot.register({ id: 'online-game', kind: 'container', element: panel.root, destroy: panel.dispose });
    const intents = createOnlineIntents();
    const movementPreviews = new Map();
    panel.accountPanel.append(renderResolutionControl(app), gpuBudgetControl());
    if (webSession) {
        for (const label of panel.form.querySelectorAll('label'))
            label.hidden = true;
        panel.input('server').required = false;
        panel.input('credential').required = false;
    }
    const navigation = createOnlineWorldNavigation({
        session: () => app.online, topology: () => routeTopology,
        status: message => panel.status(message),
        focus: (x, z, height) => app.cameraController?.focusOnPoint(x, z, height),
        selectScene: id => selectSystem(id, false),
    });
    const contentPanel = createOnlineContentPanel(panel.navigationPanel, id => navigation.focus(id));
    const contentConsumer = {
        ...contentPanel.consumer,
        reset() { navigation.resetContent(); contentPanel.consumer.reset(); },
        atlas: async (rows, index, total) => {
            navigation.atlas(rows);
            await contentPanel.consumer.atlas(rows, index, total);
        },
    };
    let onlineGameplay;
    const planetScene = createPlanetSceneController({ show: open => app.setPlanetDevelopmentOpen(open), live: () => app.isPlanetSceneEnabled(),
        prepare: async (system) => { if (app.online?.subscription()?.systemId !== system)
            await selectSystem(system, false); },
        focus: target => app.focusPlanetDevelopment(target.systemId, target.catalogId), error: error => panel.status(message(error)) });
    const planetInspector = createPlanetInspector(panel.planetPanel, { showLauncher: false, preferredCatalogId: () => app.focusedPlanetCatalogId(), onSelection: value => onlineGameplay?.setPlanet(value), onScene: planetScene.set });
    const planetList = createOwnedPlanetsPanel(panel.planetPanel, { go: row => goToPlanet(row.systemId, row.bodyId), develop: row => viewPlanet(row.systemId, row.bodyId) });
    const planets = createOwnedPlanetRoster(planetList.render);
    planetList.first.onclick = planets.first;
    planetList.next.onclick = planets.next;
    const planetDrawer = panel.planetPanel.closest('.game-drawer');
    const planetVisibility = new MutationObserver(() => planets.visible(!planetDrawer.classList.contains('dock-user-hidden')));
    planetVisibility.observe(planetDrawer, { attributes: true, attributeFilter: ['class'] });
    planets.visible(!planetDrawer.classList.contains('dock-user-hidden'));
    const compositionPanel = createFleetCompositionPanel(panel.fleetPanel);
    const composition = createOnlineFleetComposition(compositionPanel.show);
    const overview = createOnlineOverview(panel.overview, () => app.online ?? undefined);
    const roster = createOnlineRoster(panel.rosterPanel, query => connected().ownedRoster(query), (system, fleet) => { if (fleet)
        selection.select(system, fleet); }, fleet => onlineGameplay?.recoverJourney(fleet));
    let fleetCredential = '';
    const selection = createOnlineSelection({ read: async (id) => (await connected().ownedRoster({ fleetId: id, limit: 1 })).fleets[0],
        show: value => app.setCommandFleet(value), name: system => routeTopology?.systems.find(s => s.id === system)?.name ?? `System ${system.slice(-6)}`,
        selected: (systemId, fleetId) => onlineGameplay?.setFleet({ systemId, fleetId }, true) });
    async function goToFleet(id, mode = 'focus') {
        const row = await selection.refresh();
        if (selection.id() !== id)
            return;
        if (!row) {
            const system = selection.system();
            if (system && app.commandFleet()?.canGo)
                await viewFleet(system, id, mode);
            return;
        }
        // Framing a jump must leave viewport loading active for subsequent free browsing.
        if (row.location.kind === 'transit') {
            if (mode === 'follow')
                throw new Error('Start ship-follow before departure, or after arrival. Go to fleet shows the current jump.');
            app.frameSelectedJump();
            return;
        }
        await viewFleet(row.location.systemId, id, mode);
    }
    async function travelTo(destinationSystem, fleetId, target, orbitBody) {
        const session = connected(), game = onlineGameplay;
        if (!game || selection.id() !== fleetId)
            throw new Error('Select the fleet before ordering it');
        const row = (await session.ownedRoster({ fleetId, limit: 1 })).fleets[0];
        if (!row || row.availability !== 1 || row.location.kind !== 'resident')
            throw new Error('Wait for this fleet to arrive before issuing another destination');
        if (row.location.systemId === destinationSystem) {
            await moveFleet(fleetId, target, destinationSystem, orbitBody);
            return;
        }
        const preview = await game.previewRoute({ fleetId, sourceSystem: row.location.systemId, destinationSystem });
        if (app.online !== session || selection.id() !== fleetId || session.subscription()?.systemId !== destinationSystem)
            throw new Error('The destination or selected fleet changed. Issue the order again.');
        await game.startRoute({ sourceSystem: preview.sourceSystem, fleetId, fleetRevision: preview.fleetRevision, destinationSystem,
            position: [target.x, target.y, target.z], arrival: orbitBody === undefined ? { kind: 'position' } : { kind: 'orbit', bodyIndex: orbitBody },
            names: preview.systems.map(id => routeTopology?.systems.find(s => s.id === id)?.name ?? `System ${id.slice(-6)}`), legs: [], totalLegs: preview.totalLegs });
        panel.status(orbitBody === undefined ? 'Travel order sent · final destination marked' : 'Travel order sent · orbit destination marked');
    }
    let refreshTimer;
    let refreshing = false;
    let refreshDirty = false;
    const fleetList = createOnlineFleetList((page, offset) => {
        panel.setFleets(page?.fleets ?? [], offset, page?.total ?? 0, page?.nextOffset != null);
        if (page)
            refreshComposition();
        else {
            composition.clear();
            if (!selection.id())
                onlineGameplay?.setFleet(undefined);
        }
    });
    function refreshComposition() {
        refreshActivityFleet();
        const session = app.online;
        if (!session) {
            composition.clear();
            return;
        }
        void composition.read(query => session.ownedFleets(query), panel.fleets.value);
    }
    function refreshActivityFleet(explicit = false) {
        const systemId = app.online?.subscription()?.systemId, fleetId = panel.fleets.value;
        if (!selection.id())
            onlineGameplay?.setFleet(systemId && fleetId ? { systemId, fleetId } : undefined, explicit);
    }
    function selectFleetDetails() {
        const system = app.online?.subscription()?.systemId, id = panel.fleets.value;
        if (system && id)
            selection.select(system, id);
        refreshComposition();
    }
    function invalidateFleetList() { clearTimeout(refreshTimer); refreshTimer = undefined; refreshDirty = false; fleetList.invalidate(); clearRoute(); }
    function clearTopology() { routeTopology = undefined; overview.clear(); panel.clearTopology(); invalidateFleetList(); }
    let viewInterests;
    let activeOwner = '';
    let pendingOwner = '';
    let domain;
    let routeTopology;
    let routePreview;
    let busy = false;
    let preferredSystem;
    let expectedOwner;
    const recovery = createOnlineRecovery({
        busy: () => busy,
        status: value => panel.status(value),
        invalidate: suspendConnection,
        retryable: error => {
            const auth = error instanceof AuthError && [401, 403].includes(error.status);
            if (auth)
                panel.signInRequired(true);
            return !auth && !/access code|certificate SHA|Player home (world|player) changed/.test(message(error));
        },
        async connect(signal) {
            busy = true;
            panel.busy(true);
            try {
                await connect(preferredSystem, signal);
            }
            finally {
                busy = false;
                panel.busy(false);
                syncRecovery();
            }
        },
    });
    function suspendConnection() {
        navigation.reset();
        panel.connected(false);
        app.setTesterPermission(false);
        const session = app.online;
        if (session) {
            const closed = { type: 'state', state: 'closed', generation: session.generation };
            onlineGameplay?.event(closed);
            roster.event(closed);
            planets.event(closed);
            selection.event(closed);
            void session.dispose();
        }
        planetRequest++;
        clearTopology();
    }
    const message = (error) => error instanceof Error ? error.message : String(error);
    const identity = () => crypto.randomUUID().replace(/-/g, '');
    const tracedOrder = (commandId, send) => inspection ? inspection.command(commandId, send) : send();
    function connected() {
        if (!app.online || app.online.lifetime().closed)
            throw new Error('Waiting for the connection to recover');
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
        if (value.result.case !== 'accepted' && value.key)
            clearMovementPreview(opaqueIdAt(value.key.commandId));
        else if (value.key)
            movementPreviews.delete(opaqueIdAt(value.key.commandId));
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
        notifyObserver('roster UI', () => roster.event(value));
        notifyObserver('planets UI', () => planets.event(value));
        notifyObserver('selection UI', () => selection.event(value));
        switch (value.type) {
            case 'viewInterests':
                viewInterests = value.interests;
                return;
            case 'welcome':
                expectedOwner = { worldId: value.worldId, playerId: value.playerId };
                void app.renderClient?.query({ type: 'remotePlanetClock', clock: value.clock }).catch(error => panel.status(message(error)));
                planetRequest++;
                activeOwner = `${value.worldId}:${value.playerId}`;
                return;
            case 'topology':
                routeTopology = value.topology;
                clearRoute();
                panel.setTopology(value.topology, value.subscription.systemId);
                overview.connect(value.topology, value.subscription.systemId);
                return;
            case 'viewBarrier':
                planetRequest++;
                clearTopology();
                return;
            case 'viewChanged':
                viewChanged(value.status);
                return;
            case 'received':
                clearRoute();
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
                for (const commandId of movementPreviews.keys())
                    clearMovementPreview(commandId);
                panel.status('Connection interrupted. The original order is retained on this page.');
                syncRecovery();
                return;
            case 'error':
                if (webSession && /protocol failure \(?5\)?$/.test(value.message)) {
                    panel.connected(false);
                    panel.status('Disconnected. Your session has ended. Connect again to return to sign in.');
                }
                else
                    panel.status(value.message);
                return;
            case 'state':
                if (value.state === 'closed') {
                    planetRequest++;
                    navigation.reset();
                    clearTopology();
                    panel.connected(false);
                    recovery.lost();
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
        return createDomainClient(new Worker(app.runtime.workers.preview, { type: 'module', name: 'galaxy-domain-preview' }), { type: 'initialize', mode: 'online-preview', moduleUrl: new URL('../wasm/game/galaxy_game_wasm.js', import.meta.url).href,
            wasmUrl: new URL('../wasm/game/galaxy_game_wasm_bg.wasm', import.meta.url).href }, { onAccepted() { throw new Error('Online preview unexpectedly emitted accepted state'); }, onError: error => panel.preview(error.message) });
    }
    async function connect(preferredSystemId, signal) {
        panel.signInRequired(false);
        navigation.reset();
        app.setTesterPermission(false);
        const fields = webSession ? await managedCredentials() : { ...panel.credentials(), tester: false };
        signal.throwIfAborted();
        app.setTesterPermission(fields.tester);
        if (!/^[0-9a-f]{64}$/i.test(fields.credential))
            throw new Error('Enter the 64-character access code supplied with your account');
        if (fields.pin && !/^[0-9a-f]{64}$/i.test(fields.pin))
            throw new Error('Enter a 64-character certificate SHA-256');
        const certificateHashes = fields.pin ? [{ algorithm: 'sha-256', value: Uint8Array.from(fields.pin.match(/../g), byte => Number.parseInt(byte, 16)) }] : undefined;
        fleetCredential = fields.credential.toLowerCase();
        planets.reconnect(fleetCredential);
        const credential = Uint8Array.from(fields.credential.match(/../g), byte => Number.parseInt(byte, 16));
        const gameplay = onlineGameplay ?? (onlineGameplay = createOnlineGameplay(panel.activityPanel, planetInspector, fields.credential.toLowerCase(), { tester: fields.tester, journeyPath: (value, generation) => app.updateOnlineJourneyPath(value, generation), journey: (value, generation) => { void journeyProjection(value, generation).catch(error => panel.status(message(error))); }, incoming: (system, rows) => app.updateIncomingJourneys(system, rows), planets: value => app.updateSurveyPlanets(value), battle: value => { selection.battle(value); } }));
        gameplay.reconnect(fleetCredential, fields.tester);
        panel.status('Connecting…');
        panel.preview('');
        invalidateFleetList();
        domain = startDomain();
        routeTopology = undefined;
        clearRoute();
        overview.clear();
        try {
            await Promise.all([domain.ready, app.connectOnline({ onJourneyArrival: arrival => { void viewFleet(arrival.systemId, arrival.fleetId, arrival.mode).catch(error => panel.status(message(error))); }, endpoints: { webTransportUrl: fields.server, webSocketUrl: fields.fallback, certificateHashes }, credential,
                    preferredSystemId: viewInterests?.slots.detail?.kind === 'detail' ? viewInterests.slots.detail.systemId : preferredSystemId, viewInterests, expectedOwner,
                    content: contentConsumer, viewportNavigation: true,
                    rememberIntent(value) { pendingOwner = activeOwner; intents.remember(value.command); }, onEvent(value) { if (signal.aborted)
                        return; gameplay.event(value); event(value); }, onStrategic: overview.refresh })]);
            signal.throwIfAborted();
            connected();
        }
        catch (error) {
            domain.dispose();
            await app.online?.dispose();
            panel.connected(false);
            throw error;
        }
        navigation.resume();
        panel.connected(true);
        panel.status('Connected · Scroll to explore. Double-click a system to enter.');
        if (connected().received())
            await refresh();
    }
    async function managedCredentials() {
        const session = await getSession();
        if (!session || session.user.status !== 'active') {
            throw new AuthError('Your session has ended. Sign in again to reconnect.', 401);
        }
        if (webSession && session.user.id !== webSession.user.id)
            throw new AuthError('The signed-in account changed. Sign out before switching accounts.', 403);
        webSession = session;
        const access = await gameAccess(session);
        return { server: '', fallback: access.webSocketUrl, credential: access.credential, pin: '', tester: access.tester === true };
    }
    async function preview() {
        const session = connected();
        const worker = domain;
        if (!worker)
            throw new Error('Shared rules are not ready');
        const fleetId = panel.fleets.value;
        const target = panel.target();
        const page = await session.ownedFleets({ fleetId, movementContext: true });
        const token = page.seed.token;
        if (Math.hypot(target.x, target.y ?? 0, target.z) > page.seed.movementContext.extent) {
            panel.preview("Choose a destination inside this solar system's movement boundary.");
            return;
        }
        await worker.request({ type: 'seed', seed: page.seed });
        const result = await worker.request({ type: 'previewMove', move: { token, fleetId, orderId: identity(),
                targetX: target.x, targetY: target.y ?? 0, targetZ: target.z, nowMs: page.serverNowMs, expectedFleetRevision: selectedFleetRevision(page, fleetId) } });
        const watermark = session.received();
        if (app.online !== session || !watermark || !sameToken(token, { connectionGeneration: session.generation, watermark })) {
            panel.preview('The fleet state changed. Preview again.');
            return;
        }
        panel.preview(result.code === 0 ? 'This move is valid in the current shared rules. The server will confirm the order.' : 'This move is not available in the current fleet state.');
    }
    async function move() {
        await moveFleet(panel.fleets.value, { ...panel.target(), y: 0 });
    }
    function clearMovementPreview(commandId) {
        const id = movementPreviews.get(commandId);
        movementPreviews.delete(commandId);
        if (id)
            void app.renderClient?.query({ type: 'clearRemoteMove', id, commandId }).catch(() => { });
    }
    async function moveFleet(fleetId, target, systemId, orbitBody) {
        if (!intents.canIssue())
            throw new Error('Resolve pending orders before issuing another');
        const session = connected(), worker = domain;
        if (!worker || (systemId && session.subscription()?.systemId !== systemId))
            throw new Error('The fleet system changed');
        const commandId = identity();
        const page = await session.ownedFleets({ fleetId, movementContext: true });
        if (Math.hypot(target.x, target.y, target.z) > page.seed.movementContext.extent) {
            throw new Error("Choose a destination inside this solar system's movement boundary.");
        }
        const token = page.seed.token, expectedFleetRevision = selectedFleetRevision(page, fleetId);
        await app.renderClient?.query({ type: 'remoteMovementContext', required: token.watermark, context: page.seed.movementContext });
        await worker.request({ type: 'seed', seed: page.seed });
        const result = await worker.request({ type: 'previewMove', move: { token, fleetId, orderId: commandId, orbitBody,
                targetX: target.x, targetY: target.y, targetZ: target.z, nowMs: page.serverNowMs, expectedFleetRevision } });
        const watermark = session.received();
        if (app.online !== session || !watermark || !sameToken(token, { connectionGeneration: session.generation, watermark }))
            throw new Error('Fleet changed while planning; issue the order again');
        if (!result.proposal || result.code !== 0)
            throw new Error('No safe route is available to that destination');
        const change = result.proposal, p = change.positions, via = [];
        for (let i = change.pathOffsets?.[0] ?? 0; i < (change.pathOffsets?.[1] ?? 0); i++)
            via.push({ x: change.pathPoints[i * 3], y: change.pathPoints[i * 3 + 1], z: change.pathPoints[i * 3 + 2] });
        await app.renderClient?.query({ type: 'previewRemoteMove', id: fleetId, required: token.watermark, commandId, fleet: {
                id: fleetId, revision: expectedFleetRevision, x: p[0], y: p[1], z: p[2], targetX: p[3], targetY: p[4], targetZ: p[5],
                via, orbit: readFleetOrbit(change.orbitBytes ?? new Uint8Array()), moving: true, departureMs: change.times[0], arrivalMs: change.times[1]
            } });
        movementPreviews.set(commandId, fleetId);
        panel.status('Route ready · awaiting server confirmation…');
        try {
            receipt(await tracedOrder(commandId, context => session.move({ commandId, fleetId, target, expectedFleetRevision, ...(orbitBody === undefined ? {} : { orbitBody }) }, context)));
        }
        catch (error) {
            clearMovementPreview(commandId);
            throw error;
        }
    }
    function selectedFleetRevision(page, fleetId) {
        const fleet = page.fleets.find(value => value.id === fleetId);
        if (!fleet)
            throw new Error('Refresh the selected fleet before ordering it');
        return fleet.revision;
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
            throw new Error('Resolve pending orders before issuing another');
        const selection = selectedRoute(), previous = routePreview;
        const result = previous && sameRouteSelection(previous.selection, selection) ? previous.result : await previewRoute();
        if (result.totalLegs > 1 && result !== previous?.result)
            return;
        if (!onlineGameplay)
            throw new Error('Journey service is not ready');
        panel.status('Preparing the full journey…');
        await onlineGameplay.startRoute(navigationDraft(result, selection));
        clearRoute();
    }
    async function selectSystem(systemId, navigate = true) {
        if (!systemId)
            return;
        const session = connected();
        if (navigate)
            navigation.pause();
        try {
            if (!routeTopology?.systems.some(row => row.id === systemId)) {
                const status = await session.replaceView('overview', { kind: 'overview', scope: { kind: 'systems', ids: [systemId] } });
                await waitForOnlineView(session, status, AbortSignal.timeout(20000));
            }
            await session.selectSystem(systemId, navigate);
            if (app.online !== session || session.subscription()?.systemId !== systemId)
                return;
            navigation.selected(systemId);
            const movementPage = await session.ownedFleets({ limit: 1, movementContext: true });
            if (app.online !== session || session.subscription()?.systemId !== systemId)
                return;
            await app.renderClient?.query({ type: 'remoteMovementContext', required: movementPage.seed.token.watermark, context: movementPage.seed.movementContext });
            if (app.online !== session || session.subscription()?.systemId !== systemId || !routeTopology)
                return;
            panel.setTopology(routeTopology, systemId);
            overview.connect(routeTopology, systemId);
        }
        finally {
            if (navigate && app.online === session)
                navigation.resume();
        }
    }
    async function journeyProjection(value, generation) {
        selection.journey(value);
        const session = app.online;
        if (session?.generation === generation)
            session.prefetchSystem(value && value.completedLegs < value.totalLegs && !['cancelled', 'failed'].includes(value.phase.phase) ? value.destinationSystem : undefined);
        await app.updateOnlineJourney(value, generation);
    }
    let sceneNavigation = 0;
    async function viewFleet(systemId, fleetId, mode = 'focus') {
        const navigationAt = ++sceneNavigation;
        if (!fleetId) {
            await selectSystem(systemId);
            return;
        }
        const session = connected();
        navigation.pause();
        try {
            if (session.subscription()?.systemId !== systemId)
                await selectSystem(systemId, false);
            if (app.online !== session)
                return;
            if (sceneNavigation !== navigationAt)
                return;
            await app.followOnlineFleet(fleetId, mode);
            panel.fleets.value = fleetId;
            selectFleetDetails();
        }
        finally {
            if (app.online === session)
                navigation.resume();
        }
    }
    function selectedRoute() {
        return { fleetId: selection.id() ?? panel.fleets.value, destinationSystemId: panel.destinations.value, target: panel.target() };
    }
    async function signOut() {
        recovery.stop();
        navigation.reset();
        app.setTesterPermission(false);
        if (webSession)
            await logout(webSession);
        onlineGameplay?.dispose();
        onlineGameplay = undefined;
        planetInspector.setContext(undefined);
        await app.disconnectOnline(true);
        domain?.dispose();
        domain = undefined;
        activeOwner = '';
        viewInterests = undefined;
        expectedOwner = undefined;
        panel.input('credential').value = '';
        clearTopology();
        roster.clear();
        planets.clear();
        panel.connected(false);
        panel.status(intents.size() ? 'Signed out. Reconnect to the same account to resolve retained orders.' : 'Signed out.');
        if (webSession)
            location.replace('./');
    }
    function clearRoute() { routePreview = undefined; panel.jumpLabel(); onlineGameplay?.setRoute(undefined); }
    let planetRequest = 0;
    async function goToPlanet(systemId, bodyId) {
        const request = ++planetRequest, session = connected();
        ++sceneNavigation;
        navigation.pause();
        try {
            const context = await session.planetContext(systemId), body = context?.bodies.find(row => row.bodyId === bodyId);
            if (app.online !== session || request !== planetRequest)
                return;
            if (!body?.visualCatalogId)
                throw new Error('Planet location is not available yet.');
            await selectSystem(systemId, false);
            if (app.online !== session || request !== planetRequest)
                return;
            app.focusOnlinePlanet(systemId, body.visualCatalogId);
            if (isMobileLayout())
                window.dispatchEvent(new CustomEvent('galaxy:hide-panel', { detail: 'game-planet' }));
        }
        finally {
            if (app.online === session)
                navigation.resume();
        }
    }
    async function viewPlanet(systemId, bodyId) {
        const request = ++planetRequest;
        if (app.isPlanetSceneEnabled() && connected().subscription()?.systemId !== systemId) {
            await selectSystem(systemId, false);
            if (request !== planetRequest)
                return;
        }
        if (planetInspector.selectPlanet(systemId, bodyId)) {
            if (!isMobileLayout())
                panel.show('planet');
            return;
        }
        const session = connected(), context = await session.planetContext(systemId);
        if (app.online !== session || request !== planetRequest)
            return;
        if (!context)
            throw new Error('This system has no published planet catalog.');
        planetInspector.setContext(context);
        if (planetInspector.selectPlanet(systemId, bodyId) && !isMobileLayout())
            panel.show('planet');
    }
    async function previewRoute() {
        const session = connected(), game = onlineGameplay, selected = selectedRoute(), sourceSystem = await selectedRouteSource(selected.fleetId);
        if (!game || !sourceSystem)
            throw new Error('Journey service is not ready');
        requireRouteSelection(selected);
        const result = await game.previewRoute({ fleetId: selected.fleetId, sourceSystem, destinationSystem: selected.destinationSystemId });
        if (!samePreviewScope(session, game, selected, sourceSystem))
            throw new Error('Route selection changed. Preview again.');
        routePreview = { selection: selected, result };
        game.setRoute(navigationDraft(result, selected));
        panel.jumpLabel(routeTopology?.systems.find(s => s.id === result.destinationSystem)?.name ?? 'destination');
        const names = navigationDraft(result, selected).names;
        panel.preview(`${names.join(' → ')} · ${result.totalLegs} jumps · at least ${Math.ceil(Number(result.estimatedArrivalMs - result.serverNowMs) / 60000)} min. Travel continues automatically through known systems. Safe gate approaches may add time.`);
        return result;
    }
    async function selectedRouteSource(fleetId) {
        const row = (await connected().ownedRoster({ fleetId, limit: 1 })).fleets[0];
        return row?.location.kind === 'resident' ? row.location.systemId : undefined;
    }
    function requireRouteSelection(selection) {
        if (!selection.fleetId || !selection.destinationSystemId)
            throw new Error('Choose a fleet and destination');
    }
    function samePreviewScope(session, game, selection, source) {
        return app.online === session && onlineGameplay === game && sameRouteSelection(selection, selectedRoute());
    }
    function navigationDraft(result, selection) {
        const names = new Map(routeTopology?.systems.map(s => [s.id, s.name]) ?? []);
        const labels = result.systems.map(id => names.get(id) ?? `System ${id.slice(-8)}`);
        if (result.nextOffset !== null)
            labels.push('…', names.get(result.destinationSystem) ?? `System ${result.destinationSystem.slice(-8)}`);
        return { sourceSystem: result.sourceSystem, fleetId: result.fleetId, fleetRevision: result.fleetRevision, names: labels, legs: [],
            destinationSystem: result.destinationSystem, position: [selection.target.x, 0, selection.target.z], arrival: { kind: 'position' }, totalLegs: result.totalLegs };
    }
    panel.form.addEventListener('submit', e => { e.preventDefault(); recovery.start(); });
    panel.action('signout').addEventListener('click', () => { void action(signOut); });
    panel.action('preview').addEventListener('click', () => { void action(preview); });
    panel.action('route').addEventListener('click', () => { void action(async () => { await previewRoute(); }); });
    panel.onRouteChange(clearRoute);
    panel.fleets.addEventListener('change', selectFleetDetails);
    panel.action('details').addEventListener('click', selectFleetDetails);
    panel.action('move').addEventListener('click', () => { void action(move); });
    panel.action('transfer').addEventListener('click', () => { void action(transfer); });
    panel.action('galaxy').addEventListener('click', () => { contentPanel.open(); });
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
            await app.focusOnlineFleet(panel.fleets.value);
        });
    });
    function field(name) {
        return panel.input(name);
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
        document.getElementById('app-loader')?.remove();
        if (webSession) {
            panel.busy(false);
            recovery.start();
            return;
        }
        const login = devLogin;
        devLogin = undefined;
        if (login) {
            panel.busy(false);
            useLoopback(login.endpoint, login.credential);
            preferredSystem = login.systemId;
            recovery.start();
            return;
        }
        const endpoint = await launcherWebSocket();
        if (pageClosed)
            return;
        if (endpoint)
            useLoopback(endpoint);
        panel.busy(false);
        panel.show('account');
        panel.status('Enter your account access code to connect.');
    }).catch(error => { devLogin = undefined; panel.status(message(error)); });
    window.addEventListener('pagehide', () => {
        pageClosed = true;
        recovery.stop();
        recoveryLifetime.abort();
        devLogin = undefined;
        navigation.reset();
        planetVisibility.disconnect();
        planets.dispose();
        planetList.dispose();
        disposeFeatureWorker();
        clearTimeout(refreshTimer);
        roster.dispose();
        overview.dispose();
        contentPanel.dispose();
        onlineGameplay?.dispose();
        planetInspector.dispose();
        composition.dispose();
        compositionPanel.dispose();
        domain?.dispose();
        inspection?.dispose();
        void app.dispose();
        if (inspection)
            Reflect.deleteProperty(window, '__galaxyOnlineInspector');
    }, { once: true });
    const recoveryLifetime = new AbortController();
    window.addEventListener('online', () => recovery.online(true), { signal: recoveryLifetime.signal });
    window.addEventListener('offline', () => recovery.online(false), { signal: recoveryLifetime.signal });
    document.addEventListener('visibilitychange', () => recovery.visibility(document.visibilityState === 'visible'), { signal: recoveryLifetime.signal });
    recovery.online(navigator.onLine);
    recovery.visibility(document.visibilityState === 'visible');
}
//# sourceMappingURL=online-runtime.js.map