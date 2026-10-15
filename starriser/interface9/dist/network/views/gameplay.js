import { opaqueIdAt } from '../../contracts/opaque-id.js';
import { create } from '@bufbuild/protobuf';
import { GameplayRequestSchema } from '../generated/galaxy/v1/galaxy_pb.js';
/** One worker-to-worker port. The socket stays owned by the network worker. */
export function createGameplayChannel(port, send) {
    let closed = false, ready = false;
    const active = new Set();
    if (port) {
        port.onmessage = ({ data }) => {
            if (data.kind === 'cancel') {
                active.delete(BigInt(data.id));
                return;
            }
            if (closed || data.kind !== 'request')
                return;
            const id = BigInt(data.id);
            if (!ready || active.size >= 8 || active.has(id)) {
                port.postMessage({ kind: 'reply', id: data.id, error: 'Gameplay channel unavailable' });
                return;
            }
            active.add(id);
            void send(create(GameplayRequestSchema, { requestId: id, operation: data.operation, payload: data.payload })).catch(() => { active.delete(id); port.postMessage({ kind: 'reply', id: data.id, error: 'Gameplay send unconfirmed; retry the same order' }); });
        };
        port.start();
    }
    return {
        ready() { ready = true; port?.postMessage({ kind: 'ready' }); },
        barrier() { active.clear(); port?.postMessage({ kind: 'barrier' }); },
        changed(topics, ids = []) { port?.postMessage({ kind: 'changed', topics, fleetIds: ids.map(id => opaqueIdAt(id)) }); },
        reply(value) { if (!active.delete(value.requestId))
            return; port?.postMessage({ kind: 'reply', id: Number(value.requestId), status: value.status, epoch: value.visibilityEpoch.toString(), payload: value.payload }, value.payload.length >= 1024 ? [value.payload.buffer] : []); },
        dispose() { closed = true; active.clear(); port?.postMessage({ kind: 'closed' }); port?.close(); }
    };
}
//# sourceMappingURL=gameplay.js.map