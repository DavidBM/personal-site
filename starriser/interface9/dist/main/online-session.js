import { ShipOrders, ShipProjection } from '../worker/protocol/services.js';
import { NetworkEvents, OwnedShips, RememberIntent, NetworkDiagnostics, NetworkPlayback } from '../network/service-contracts.js';
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
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => { });
    const startupTimer = setTimeout(() => fail(new Error('Online world did not become ready')), 20000);
    const binding = options.bus.bind({ service: 'online-session', instance: 'main', scope, source: 'js/main/online-session.ts' }, {
        consumes: { ...NetworkEvents, move: ShipOrders.move, transfer: ShipOrders.transfer, retry: ShipOrders.retry, queryReceipt: ShipOrders.receipt,
            ownedShips: OwnedShips, diagnostics: NetworkDiagnostics, projection: ShipProjection.batches, refreshPlayback: NetworkPlayback.refresh },
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
        if (attached)
            throw new Error('Online topology attachment already exists');
        subscription = { ...event.subscription };
        const node = options.installTopology(event.topology, subscription);
        // Own the pending attachment before awaiting its acknowledgement. Disposal
        // queues clearFleets after attach on this same ordered renderer connection.
        attached = true;
        await options.renderer.attachProjection({ generation, identity: subscription, node, port: channel.port2 });
    }
    function handleEvent(event) {
        if (closed)
            return;
        options.onEvent(event);
        if (event.type === 'topology')
            return topology(event).catch(fail);
        if (event.type === 'received') {
            received = copyWatermark(event.watermark);
            if (event.snapshotComplete && !initialApplying) {
                initialApplying = true;
                void applied(event.watermark).catch(fail);
            }
        }
        if (event.type === 'state' && event.state === 'closed')
            fail(new Error('Online connection closed; pending outcomes need their original receipt keys'));
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
        move(intent, context) { current(); return binding.consumes.move.request(intent, { context, timeoutMs: 15000 }); },
        transfer(intent, context) { current(); return binding.consumes.transfer.request(intent, { context, timeoutMs: 15000 }); },
        retry(command, context) { current(); return binding.consumes.retry.request(command, { context, timeoutMs: 15000 }); },
        queryReceipt(key, context) { current(); return binding.consumes.queryReceipt.request(key, { context, timeoutMs: 15000 }); },
        takeDiagnostics() { current(); return binding.consumes.diagnostics.request(undefined, { timeoutMs: 3000 }); },
        ownedShips(query = {}) { current(); return binding.consumes.ownedShips.request(query); },
        replaceStrategic(value) { current(); return strategic.replace(value); },
        strategicSnapshot() { current(); return strategic.query(); },
        received: () => received && copyWatermark(received),
        subscription: () => subscription && { ...subscription },
        getServiceGraph: () => options.bus.getServiceGraph(),
    };
}
//# sourceMappingURL=online-session.js.map