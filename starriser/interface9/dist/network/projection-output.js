import { createProjectionSender } from '../render/remote/transfer-sender.js';
import { bufferBytes, projectionBuffers } from '../render/remote/contracts.js';
import { SESSION_LIMITS } from './session-contracts.js';
export function createProjectionOutput(port, generation, onError, onIdle) {
    let queue = [];
    let head = 0;
    let bytes = 0;
    let disposed = false;
    let viewGeneration = 0;
    let producer;
    let produced;
    const sender = createProjectionSender(port, { generation, onError, onReturned: flush });
    function flushQueue() {
        while (!disposed && head < queue.length) {
            const batch = queue[head];
            const size = bufferBytes(projectionBuffers(batch));
            if (!sender.send(batch))
                return false;
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
        return true;
    }
    function flushProducer() {
        while (!disposed && producer && head === queue.length && sender.inspect().inFlightBatches < 4) {
            const next = producer.next();
            if (next.done) {
                producer = undefined;
                const done = produced;
                produced = undefined;
                done?.();
                break;
            }
            if (viewGeneration)
                next.value.viewGeneration = viewGeneration;
            if (!sender.send(next.value)) {
                queue.push(next.value);
                bytes += bufferBytes(projectionBuffers(next.value));
                break;
            }
        }
    }
    function flush() {
        if (!flushQueue())
            return;
        flushProducer();
        if (!disposed && !producer && head === queue.length && sender.inspect().inFlightBatches === 0)
            onIdle?.();
    }
    return {
        reset(value = {}) {
            if (disposed || viewGeneration === Number.MAX_SAFE_INTEGER)
                throw new Error('Projection lifetime unavailable');
            queue = [];
            head = 0;
            bytes = 0;
            producer = undefined;
            produced = undefined;
            port.postMessage({ type: 'projectionReset', connectionGeneration: generation, viewGeneration: ++viewGeneration, ...value });
            return viewGeneration;
        },
        stream(iterator, done) {
            if (disposed || producer)
                throw new Error('Projection producer already active');
            producer = iterator;
            produced = done;
            flush();
        },
        enqueue(batch) {
            if (disposed)
                throw new Error('Projection output disposed');
            const size = bufferBytes(projectionBuffers(batch));
            if (bytes + size > SESSION_LIMITS.pendingProjectionBytes || queue.length - head >= SESSION_LIMITS.pendingProjectionBatches)
                throw new Error('Render consumer is too slow; projection queue budget exceeded');
            if (viewGeneration)
                batch.viewGeneration = viewGeneration;
            queue.push(batch);
            bytes += size;
            flush();
        },
        dispose() { if (disposed)
            return; disposed = true; producer = undefined; produced = undefined; queue = []; head = 0; bytes = 0; sender.dispose(); },
        inspect: () => ({ ...sender.inspect(), queuedBatches: queue.length - head, queuedBytes: bytes }),
    };
}
//# sourceMappingURL=projection-output.js.map