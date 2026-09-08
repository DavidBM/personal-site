import { createProjectionSender } from '../render/remote/transfer-sender.js';
import { bufferBytes, projectionBuffers } from '../render/remote/contracts.js';
import { SESSION_LIMITS } from './session-contracts.js';
export function createProjectionOutput(port, generation, onError, onIdle) {
    let queue = [];
    let head = 0;
    let bytes = 0;
    let disposed = false;
    const sender = createProjectionSender(port, { generation, onError, onReturned: flush });
    function flush() {
        while (!disposed && head < queue.length) {
            const batch = queue[head];
            const size = bufferBytes(projectionBuffers(batch));
            if (!sender.send(batch))
                return;
            bytes -= size;
            queue[head++] = undefined;
            if (head >= SESSION_LIMITS.pendingProjectionBatches) {
                queue = queue.slice(head);
                head = 0;
            }
        }
        if (head === queue.length) {
            queue = [];
            head = 0;
        }
        if (!disposed && head === queue.length && sender.inspect().inFlightBatches === 0)
            onIdle?.();
    }
    return {
        enqueue(batch) {
            if (disposed)
                throw new Error('Projection output disposed');
            const size = bufferBytes(projectionBuffers(batch));
            if (bytes + size > SESSION_LIMITS.pendingProjectionBytes || queue.length - head >= SESSION_LIMITS.pendingProjectionBatches)
                throw new Error('Render consumer is too slow; projection queue budget exceeded');
            queue.push(batch);
            bytes += size;
            flush();
        },
        dispose() { if (disposed)
            return; disposed = true; queue = []; head = 0; bytes = 0; sender.dispose(); },
        inspect: () => ({ ...sender.inspect(), queuedBatches: queue.length - head, queuedBytes: bytes }),
    };
}
//# sourceMappingURL=projection-output.js.map