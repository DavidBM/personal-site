import { PlayerViews } from './views/service-contracts.js';
import { FleetOrders, FleetProjection } from '../worker/protocol/services.js';
import { NetworkEvents, OwnedFleets, RememberIntent, NetworkDiagnostics, NetworkPlayback, ViewTopologyInstalled } from './service-contracts.js';
import { createServiceRequests } from './service-requests.js';
import { createStrategicService } from './strategic-service-host.js';
export function createNetworkService(bus, scope, session) {
    const binding = bus.bind({ service: 'network', instance: 'network', scope, source: 'js/network/service-host.ts' }, {
        consumes: { rememberIntent: RememberIntent },
        provides: { replaceView: PlayerViews.replace, viewStatus: PlayerViews.status, ownedRoster: PlayerViews.owned, topologyInstalled: ViewTopologyInstalled, ...NetworkEvents, move: FleetOrders.move, transfer: FleetOrders.transfer, retry: FleetOrders.retry, queryReceipt: FleetOrders.receipt,
            ownedFleets: OwnedFleets, diagnostics: NetworkDiagnostics, refreshPlayback: NetworkPlayback.refresh, projection: FleetProjection.batches },
    });
    function viewOwner() { const owner = session().views; if (!owner)
        throw new Error('Player views unavailable'); return owner; }
    binding.provides.replaceView.handle(({ slot, selector }) => viewOwner().replace(slot, selector));
    binding.provides.viewStatus.handle(slot => viewOwner().status(slot));
    binding.provides.ownedRoster.handle(query => viewOwner().owned(query));
    binding.provides.topologyInstalled.handle(token => viewOwner().topologyInstalled(token));
    let strategic;
    try {
        strategic = createStrategicService(bus, scope, session);
    }
    catch { /* Optional overview remains unavailable. */ }
    const requests = createServiceRequests(value => session().control(value));
    binding.provides.move.handle((input, context) => requests.submit(requestId => ({ type: 'move', requestId, ...input }), undefined, context.causal));
    binding.provides.transfer.handle((input, context) => requests.submit(requestId => ({ type: 'transfer', requestId, ...input }), undefined, context.causal));
    binding.provides.retry.handle((command, context) => requests.submit(requestId => ({ type: 'retry', requestId, command }), command.key, context.causal));
    binding.provides.queryReceipt.handle((key, context) => requests.submit(requestId => ({ type: 'queryReceipt', requestId, key }), key, context.causal));
    binding.provides.ownedFleets.handle(query => session().ownedFleets(query));
    binding.provides.refreshPlayback.handle(() => session().control({ type: 'refreshPlayback' }));
    binding.provides.diagnostics.handle(() => session().takeDiagnostics());
    return {
        ready: () => binding.ready(),
        emit(event) {
            if (event.type === 'strategic') {
                strategic?.notify(event.frontier);
                return;
            }
            const context = requests.observe(event);
            if (event.type === 'pending')
                return binding.consumes.rememberIntent.request(event, { context });
            // The discriminated event chooses its matching descriptor; no payload inspection.
            binding.provides[event.type].publish(event, { context });
        },
        connectStream(generation) {
            return binding.provides.projection.connect({ id: `fleet-projection-${generation}`, generation,
                source: 'network', target: 'render', maxBytes: 1024 * 1024, maxBuffers: 4 });
        },
        async dispose() {
            requests.dispose();
            await Promise.allSettled([strategic?.dispose(), binding.dispose()]);
        },
    };
}
//# sourceMappingURL=service-host.js.map