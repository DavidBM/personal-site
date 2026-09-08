import { ShipOrders, ShipProjection } from '../worker/protocol/services.js';
import { NetworkEvents, OwnedShips, RememberIntent, NetworkDiagnostics, NetworkPlayback } from './service-contracts.js';
import { createServiceRequests } from './service-requests.js';
import { createStrategicService } from './strategic-service-host.js';
export function createNetworkService(bus, scope, session) {
    const binding = bus.bind({ service: 'network', instance: 'network', scope, source: 'js/network/service-host.ts' }, {
        consumes: { rememberIntent: RememberIntent },
        provides: { ...NetworkEvents, move: ShipOrders.move, transfer: ShipOrders.transfer, retry: ShipOrders.retry, queryReceipt: ShipOrders.receipt,
            ownedShips: OwnedShips, diagnostics: NetworkDiagnostics, refreshPlayback: NetworkPlayback.refresh, projection: ShipProjection.batches },
    });
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
    binding.provides.ownedShips.handle(query => session().ownedShips(query));
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
            return binding.provides.projection.connect({ id: `ship-projection-${generation}`, generation,
                source: 'network', target: 'render', maxBytes: 1024 * 1024, maxBuffers: 4 });
        },
        async dispose() {
            requests.dispose();
            await Promise.allSettled([strategic?.dispose(), binding.dispose()]);
        },
    };
}
//# sourceMappingURL=service-host.js.map