import { publishTopicWithBackpressure, subscribeTopic, Topics } from '../protocol/topics.js';
/** One batch in flight, returned only after every projection has applied it.
 * Slow consumers hold credit until they finish; cancellation ends the wait. */
export function createGenerationDelivery(bus, generationId, signal) {
    const owner = new AbortController();
    const lifetime = AbortSignal.any([signal, owner.signal, bus.signal]);
    let sequence = 0;
    let pending;
    const unsubscribe = subscribeTopic(bus, Topics.galaxyOpsApplied, (ack, meta) => {
        if (ack.generationId !== generationId || ack.sequence !== sequence || meta.senderId !== ack.mirror)
            return;
        if (!pending?.mirrors.has(ack.mirror))
            return;
        if (ack.error) {
            pending.reject(new Error(`${ack.mirror}: ${ack.error}`));
            return;
        }
        pending.mirrors.delete(ack.mirror);
        if (!pending.mirrors.size)
            pending.resolve();
    });
    const abort = () => pending?.reject(new Error('Galaxy generation cancelled'));
    lifetime.addEventListener('abort', abort);
    return {
        async send(ops) {
            lifetime.throwIfAborted();
            if (pending)
                throw new Error('A generation batch is already in flight');
            sequence++;
            try {
                const applied = new Promise((resolve, reject) => {
                    pending = { mirrors: new Set(['main', 'business', 'fleets']), resolve, reject };
                });
                await Promise.all([applied, publishTopicWithBackpressure(bus, Topics.galaxyOps, { generationId, sequence, ops }, 2, { signal: lifetime, requiredSubscribers: ['main', 'business', 'fleets'] })]);
            }
            catch (error) {
                owner.abort();
                throw error;
            }
            finally {
                pending = undefined;
            }
        },
        dispose() { owner.abort(); unsubscribe(); lifetime.removeEventListener('abort', abort); },
    };
}
//# sourceMappingURL=generation-delivery.js.map