import { PlayerViews } from '../network/views/service-contracts.js';
import { FleetOrders, FleetProjection } from '../worker/protocol/services.js';
import { NetworkEvents, OwnedFleets, RememberIntent, NetworkDiagnostics, NetworkPlayback, ViewTopologyInstalled } from '../network/service-contracts.js';
import { copyWatermark } from '../render/remote/projection-state.js';
import { prepareNetworkServices } from './network-service-bootstrap.js';
import { createStrategicClient } from './strategic-client.js';
let nextGeneration = 0;
export function createOnlineSession(options) {
    const generation = ++nextGeneration;
    const scope = `online-${crypto.randomUUID()}`;
    const workerId = `${scope}-network`;
    const lifetime = new AbortController();
    const channel = new MessageChannel();
    let worker;
    let closed = false;
    let attached = false;
    let subscription;
    let received;
    let initialApplying = false;
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
            ownedFleets: OwnedFleets, diagnostics: NetworkDiagnostics, projection: FleetProjection.batches, refreshPlayback: NetworkPlayback.refresh },
        provides: { rememberIntent: RememberIntent },
    });
    binding.provides.rememberIntent.handle(async (event) => {
        await options.rememberIntent(event);
        options.onEvent(event);
    });
    for (const name of Object.keys(NetworkEvents))
        binding.consumes[name].subscribe(handleEvent);
    const strategic = createStrategicClient(options.bus, scope, generation, value => options.onStrategic?.(value));
    document.addEventListener('visibilitychange', resumePlayback, { signal: lifetime.signal });
    function resumePlayback() {
        if (closed || document.visibilityState !== 'visible')
            return;
        if (attached)
            void binding.consumes.refreshPlayback.request(undefined, { timeoutMs: 2000 }).catch(() => { });
    }
    function fail(reason) {
        if (closed)
            return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        rejectReady(error);
        void dispose();
        options.onEvent({ type: 'error', message: error.message });
    }
    async function topology(event) {
        if (event.generation !== generation || closed)
            return;
        if (attached && !event.viewToken)
            throw new Error('Online topology attachment already exists');
        subscription = { ...event.subscription };
        const node = options.installTopology(event.topology, subscription);
        // Own the pending attachment before awaiting its acknowledgement. Disposal
        // queues clearFleets after attach on this same ordered renderer connection.
        if (!attached && node) {
            attached = true;
            attachments++;
            await options.renderer.attachProjection({ generation, identity: subscription, node, port: channel.port2, dynamic: !!event.viewToken });
        }
        if (event.viewToken) {
            await options.renderer.query({ type: 'snapshot' });
            if (closed)
                return;
            await binding.consumes.topologyInstalled.request(event.viewToken);
            // Map usability is independent of detail permission and source readiness.
            clearTimeout(startupTimer);
            resolveReady(undefined);
        }
    }
    function handleEvent(event) {
        if (closed)
            return;
        recordLifetime(event);
        options.onEvent(event);
        switch (event.type) {
            case 'viewInterests':
                overviewClosed = event.interests.slots.overview === null;
                return;
            case 'topology': return topology(event).catch(fail);
            case 'viewBarrier':
                selectionAttempt++;
                received = undefined;
                options.clearViews?.();
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
        if (status.slot === 'overview') {
            received = undefined;
            options.clearViews?.();
        }
        if (status.slot === 'detail')
            received = undefined;
    }
    function projectionReceived(event) {
        received = copyWatermark(event.watermark);
        if (options.legacy && event.snapshotComplete && !initialApplying) {
            initialApplying = true;
            void applied(event.watermark).catch(fail);
        }
    }
    async function applied(watermark) {
        await options.renderer.query({ type: 'projectionBarrier', required: watermark, timeoutMs: 10000 });
        if (closed)
            return;
        clearTimeout(startupTimer);
        resolveReady(copyWatermark(watermark));
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
        const info = await options.bus.launchWorker('../../network/managed-worker.bundle.js', { workerId });
        worker = info.worker;
        current();
        worker.addEventListener('message', workerMessage);
        worker.addEventListener('error', workerFailed);
        await prepareNetworkServices(worker, { type: 'prepareServices', generation, scope }, lifetime.signal);
        current();
        await binding.ready();
        current();
        const bootstrap = { type: 'connect', generation, endpoints: options.endpoints, credential: options.credential,
            playerViews: options.legacy ? undefined : {}, viewInterests: options.viewInterests,
            discovery: { subscriptionId: crypto.randomUUID().replace(/-/g, ''), preferredSystemId: options.preferredSystemId },
            ownedProjection: true, transfers: true, renewAdmissions: true, strategic: true, playbackCorrections: true,
            diagnostics: options.diagnostics, renderPort: channel.port1 };
        worker.postMessage(bootstrap, [channel.port1]);
    }
    function dispose() {
        if (disposePromise)
            return disposePromise;
        closed = true;
        lifetime.abort();
        clearTimeout(startupTimer);
        rejectReady(new Error('Online session disposed'));
        channel.port1.close();
        channel.port2.close();
        worker?.removeEventListener('message', workerMessage);
        worker?.removeEventListener('error', workerFailed);
        options.bus.terminateWorker(workerId);
        if (attached)
            options.renderer.send({ type: 'clearFleets' });
        disposePromise = Promise.allSettled([strategic.dispose(), binding.dispose()]).then(() => { });
        return disposePromise;
    }
    void start().catch(fail);
    return {
        ready, generation, scope, dispose,
        lifetime: () => ({ generation, closed, transport, wireConnection, welcomes, attachments, portIdentity, lastError }),
        replaceView(slot, selector) { current(); return binding.consumes.replaceView.request({ slot, selector }); },
        viewStatus(slot) { current(); return binding.consumes.viewStatus.request(slot); },
        ownedRoster(query = {}) { current(); return binding.consumes.ownedRoster.request(query); },
        async selectSystem(systemId) {
            current();
            received = undefined;
            const attempt = ++selectionAttempt;
            try {
                await binding.consumes.replaceView.request({ slot: 'detail', selector: { kind: 'detail', systemId } });
            }
            catch (error) {
                if (closed || attempt !== selectionAttempt)
                    return;
                throw error;
            }
            if (closed || attempt !== selectionAttempt)
                return;
            if (subscription)
                subscription = { ...subscription, systemId };
            options.selectSystem?.(systemId);
        },
        move(intent, context) { current(); return binding.consumes.move.request(intent, { context, timeoutMs: 15000 }); },
        transfer(intent, context) { current(); return binding.consumes.transfer.request(intent, { context, timeoutMs: 15000 }); },
        retry(command, context) { current(); return binding.consumes.retry.request(command, { context, timeoutMs: 15000 }); },
        queryReceipt(key, context) { current(); return binding.consumes.queryReceipt.request(key, { context, timeoutMs: 15000 }); },
        takeDiagnostics() { current(); return binding.consumes.diagnostics.request(undefined, { timeoutMs: 3000 }); },
        ownedFleets(query = {}) { current(); return binding.consumes.ownedFleets.request(query); },
        replaceStrategic(value) { current(); return strategic.replace(value); },
        strategicSnapshot() { current(); return strategic.query(); },
        received: () => received && copyWatermark(received),
        subscription: () => subscription && { ...subscription },
        getServiceGraph: () => options.bus.getServiceGraph(),
    };
}
//# sourceMappingURL=online-session.js.map