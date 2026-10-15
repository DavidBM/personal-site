import { createOnlineJourneyScene } from './online-journey-scene.js';
import { notifyObserver } from '../lib/notify-observer.js';
import { createOnlineBattleScene } from './online-battle-scene.js';
import { attachGameplayTransport } from '../features/http-worker/client.js';
import { createOnlineMapLayers } from './online-map-layers.js';
import { createOnlineSurvey } from './online-survey.js';
import { createOnlineContent } from './online-content.js';
import { PlayerViews } from '../network/views/service-contracts.js';
import { FleetOrders, FleetProjection } from '../worker/protocol/services.js';
import { NetworkEvents, OwnedFleets, RememberIntent, ViewTopologyInstalled } from '../network/service-contracts.js';
import { copyWatermark } from '../render/remote/projection-state.js';
import { prepareNetworkServices } from './network-service-bootstrap.js';
import { createStrategicClient } from './strategic-client.js';
import { BACKEND_RUNTIME } from './runtime-profile.js';
import { createOnlineRosterSurvey } from './online-roster-survey.js';
import { createOnlinePlanetSurvey } from './online-planet-survey.js';
import { waitForOnlineDetail } from './online-view-ready.js';
let nextGeneration = 0;
export function createOnlineSession(options) {
    const generation = ++nextGeneration;
    const scope = `online-${crypto.randomUUID()}`;
    const workerId = `${scope}-network`;
    const content = options.content ? createOnlineContent({ generation, credential: options.credential, consumer: options.content }) : undefined;
    const lifetime = new AbortController();
    const channel = new MessageChannel();
    let worker;
    let closed = false;
    let attached = false;
    let subscription;
    let received;
    let resolveReady;
    let rejectReady;
    let disposePromise;
    let selectionAttempt = 0, attachments = 0, welcomes = 0;
    let overviewClosed = false;
    let transport, wireConnection, lastError;
    const portIdentity = crypto.randomUUID();
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => { });
    const startupTimer = setTimeout(() => fail(new Error('Online world did not become ready')), 20000);
    const binding = options.bus.bind({ service: 'online-session', instance: 'main', scope, source: 'js/main/online-session.ts' }, {
        consumes: { replaceView: PlayerViews.replace, viewStatus: PlayerViews.status, ownedRoster: PlayerViews.owned, topologyInstalled: ViewTopologyInstalled, ...NetworkEvents, move: FleetOrders.move, transfer: FleetOrders.transfer, retry: FleetOrders.retry, queryReceipt: FleetOrders.receipt,
            ownedFleets: OwnedFleets, projection: FleetProjection.batches },
        provides: { rememberIntent: RememberIntent },
    });
    binding.provides.rememberIntent.handle(async (event) => {
        await options.rememberIntent(event);
        notifyObserver('online UI', () => options.onEvent(event));
    });
    for (const name of Object.keys(NetworkEvents))
        binding.consumes[name].subscribe(handleEvent);
    const strategic = createStrategicClient(options.bus, scope, generation, value => options.onStrategic?.(value));
    const journeyScene = options.surveyNode ? createOnlineJourneyScene({ generation, renderer: options.renderer, node: options.surveyNode, arrival: options.onJourneyArrival, error: message => notifyObserver('journey error UI', () => options.onEvent({ type: 'error', message })) }) : undefined;
    const battleScene = createOnlineBattleScene(generation, options.renderer, message => options.onEvent({ type: 'error', message }));
    const mapLayers = options.surveyNode ? createOnlineMapLayers({ generation, renderer: options.renderer, node: options.surveyNode }) : undefined;
    const planets = createOnlinePlanetSurvey({ generation, credential: options.credential,
        publish: value => options.renderer.send({ type: 'surveyPlanets', value }) });
    const discovery = options.surveyNode ? createOnlineSurvey({ generation, node: options.surveyNode,
        planets: planets.discover, alerts: (rows, partial) => options.renderer.send({ type: 'surveyAlerts', rows, partial }) }) : undefined;
    const survey = options.surveyNode ? createOnlineRosterSurvey({ generation, credential: options.credential,
        query: query => binding.consumes.ownedRoster.request(query), node: options.surveyNode,
        publish: fleets => { notifyObserver('roster renderer', () => options.renderer.send({ type: 'surveyRoster', fleets })); notifyObserver('roster planets', () => planets.roster(fleets)); notifyObserver('roster layers', () => mapLayers?.roster(fleets)); notifyObserver('roster journeys', () => journeyScene?.roster(fleets)); },
        failed: error => options.onEvent({ type: 'error', message: `Fleet map indicators: ${error instanceof Error ? error.message : String(error)}` }),
    }) : undefined;
    function fail(reason) {
        if (closed)
            return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        rejectReady(error);
        void dispose();
        notifyObserver('online error UI', () => options.onEvent({ type: 'error', message: error.message }));
        // Worker crashes and readiness failures also retire every gameplay scope.
        notifyObserver('online closed UI', () => options.onEvent({ type: 'state', generation, state: 'closed' }));
    }
    async function topology(event) {
        if (event.generation !== generation || closed)
            return;
        subscription = { ...event.subscription };
        const node = options.installTopology(event.topology, subscription);
        const nodes = options.nodeHandles?.() ?? [];
        discovery?.topology(event.topology);
        // Own the pending attachment before awaiting its acknowledgement. Disposal
        // queues clearFleets after attach on this same ordered renderer connection.
        if (!attached && node) {
            attached = true;
            attachments++;
            await options.renderer.attachProjection({ generation, identity: subscription, node, port: channel.port2, dynamic: true });
        }
        {
            await options.renderer.query({ type: 'snapshot' });
            if (closed)
                return;
            await binding.consumes.topologyInstalled.request({ ...event.viewToken, nodes });
            // Map usability is independent of detail permission and source readiness.
            clearTimeout(startupTimer);
            resolveReady(undefined);
        }
    }
    async function attachSelectedSystem(systemId) {
        if (attached || !subscription)
            return;
        const node = options.nodeHandles?.().find(row => row.systemId === systemId)?.node;
        if (!node)
            throw new Error('System is outside the loaded map region');
        attached = true;
        attachments++;
        await options.renderer.attachProjection({ generation, identity: { ...subscription, systemId }, node, port: channel.port2, dynamic: true });
    }
    function handleEvent(event) {
        if (closed)
            return;
        notifyObserver('content', () => content?.event(event));
        recordLifetime(event);
        notifyObserver('online UI', () => options.onEvent(event));
        notifyObserver('journeyScene', () => journeyScene?.event(event));
        notifyObserver('battleScene', () => battleScene.event(event));
        notifyObserver('mapLayers', () => mapLayers?.event(event));
        notifyObserver('planets', () => planets.event(event));
        notifyObserver('discovery', () => discovery?.event(event));
        notifyObserver('survey', () => survey?.event(event));
        switch (event.type) {
            case 'viewInterests':
                overviewClosed = event.interests.slots.overview === null;
                return;
            case 'topology': return topology(event).catch(fail);
            case 'viewBarrier':
                selectionAttempt++;
                received = undefined;
                options.clearViews?.(true);
                return;
            case 'viewChanged':
                viewChanged(event.status);
                return;
            case 'received':
                projectionReceived(event);
                return;
            case 'state':
                connectionState(event.state);
                return;
        }
    }
    function connectionState(state) {
        if (state === 'ready' && overviewClosed) {
            clearTimeout(startupTimer);
            resolveReady(undefined);
        }
        if (state === 'closed')
            fail(new Error(lastError ?? 'Online connection closed; pending outcomes need their original receipt keys'));
    }
    function recordLifetime(event) {
        if (event.type === 'error')
            lastError = event.message;
        if (event.type === 'welcome') {
            welcomes++;
            wireConnection = event.connectionGeneration;
        }
        if (event.type === 'state' && event.transport)
            transport = event.transport;
    }
    function viewChanged(status) {
        if (status.state === 'ready')
            return;
        if (status.slot === 'overview')
            overviewChanged(status);
        if (status.slot === 'detail')
            received = undefined;
    }
    function overviewChanged(status) {
        // Keep the displayed baseline while staging. A source reset drops overview
        // rows but the independently authorized detail system remains resident.
        // Policy barriers clear received before this event and retain nothing.
        if (status.displayed)
            return;
        const keep = received?.scope.systemId;
        if (!keep)
            received = undefined;
        options.clearViews?.(false, keep);
        // Atlas browsing remains usable if an initial whole-world scope is rejected.
        if (status.state === 'rejected' && !attached && content) {
            clearTimeout(startupTimer);
            resolveReady(undefined);
        }
    }
    function projectionReceived(event) {
        // A partial packed snapshot cannot provide an owned rule seed or a camera
        // target yet. Deltas are complete observations too.
        received = event.snapshotComplete ? copyWatermark(event.watermark) : undefined;
    }
    function workerMessage(event) {
        if (event.data.type === 'networkFatal' && event.data.generation === generation)
            fail(new Error(event.data.message));
    }
    function workerFailed() { fail(new Error('Online network worker failed')); }
    function current() { if (closed)
        throw new Error('Online session is closed'); }
    async function start() {
        await binding.registered;
        current();
        const info = await options.bus.launchWorker(options.workerModule ?? BACKEND_RUNTIME.workers.session, { workerId });
        worker = info.worker;
        current();
        worker.addEventListener('message', workerMessage);
        worker.addEventListener('error', workerFailed);
        await prepareNetworkServices(worker, { type: 'prepareServices', generation, scope }, lifetime.signal);
        current();
        await binding.ready();
        current();
        const bootstrap = { type: 'connect', generation, endpoints: options.endpoints, credential: options.credential,
            playerViews: { ...options.expectedOwner, viewportNavigation: options.viewportNavigation }, viewInterests: options.viewInterests,
            discovery: { subscriptionId: crypto.randomUUID().replace(/-/g, ''), preferredSystemId: options.preferredSystemId },
            gameplayPort: attachGameplayTransport(), renderPort: channel.port1 };
        worker.postMessage(bootstrap, [channel.port1, ...(bootstrap.gameplayPort ? [bootstrap.gameplayPort] : [])]);
    }
    function dispose(forgetContent = false) {
        if (disposePromise)
            return forgetContent
                ? Promise.allSettled([disposePromise, content?.dispose(true)]).then(() => { }) : disposePromise;
        closed = true;
        lifetime.abort();
        clearTimeout(startupTimer);
        rejectReady(new Error('Online session disposed'));
        journeyScene?.dispose();
        battleScene.dispose();
        survey?.dispose();
        mapLayers?.dispose();
        planets.dispose();
        discovery?.dispose();
        channel.port1.close();
        channel.port2.close();
        worker?.removeEventListener('message', workerMessage);
        worker?.removeEventListener('error', workerFailed);
        options.bus.terminateWorker(workerId);
        if (attached)
            options.renderer.send({ type: 'clearFleets' });
        disposePromise = Promise.allSettled([strategic.dispose(), binding.dispose(), content?.dispose(forgetContent)]).then(() => { });
        return disposePromise;
    }
    void start().catch(fail);
    return {
        ready, generation, scope, dispose,
        observeJourney: (value) => journeyScene?.seed(value),
        setMapLayers: (value) => mapLayers?.options(value),
        planetContext: planets.context,
        contentStatus: () => content?.inspect(),
        prefetchSystem: (id) => content?.prefetchSystem(id),
        lifetime: () => ({ generation, closed, transport, wireConnection, welcomes, attachments, portIdentity, lastError }),
        replaceView(slot, selector) { current(); return binding.consumes.replaceView.request({ slot, selector }); },
        viewStatus(slot) { current(); return binding.consumes.viewStatus.request(slot); },
        ownedRoster(query = {}) { current(); return binding.consumes.ownedRoster.request(query); },
        async selectSystem(systemId, navigate = true) {
            current();
            received = undefined;
            const attempt = ++selectionAttempt;
            const status = await binding.consumes.replaceView.request({ slot: 'detail', selector: { kind: 'detail', systemId } });
            if (closed || attempt !== selectionAttempt)
                throw new Error('System selection was superseded');
            if (subscription)
                subscription = { ...subscription, systemId };
            await attachSelectedSystem(systemId);
            await waitForOnlineDetail({ viewStatus: slot => binding.consumes.viewStatus.request(slot), received: () => received }, status, systemId, () => !closed && attempt === selectionAttempt);
            if (closed || attempt !== selectionAttempt)
                throw new Error('System selection was superseded');
            content?.selectSystem(systemId);
            options.selectSystem?.(systemId, navigate);
        },
        move(intent, context) { current(); return binding.consumes.move.request(intent, { context, timeoutMs: 15000 }); },
        transfer(intent, context) { current(); return binding.consumes.transfer.request(intent, { context, timeoutMs: 15000 }); },
        retry(command, context) { current(); return binding.consumes.retry.request(command, { context, timeoutMs: 15000 }); },
        queryReceipt(key, context) { current(); return binding.consumes.queryReceipt.request(key, { context, timeoutMs: 15000 }); },
        ownedFleets(query = {}) { current(); return binding.consumes.ownedFleets.request(query); },
        replaceStrategic(value) { current(); return strategic.replace(value); },
        strategicSnapshot() { current(); return strategic.query(); },
        received: () => received && copyWatermark(received),
        subscription: () => subscription && { ...subscription },
        getServiceGraph: () => options.bus.getServiceGraph(),
    };
}
//# sourceMappingURL=online-session.js.map