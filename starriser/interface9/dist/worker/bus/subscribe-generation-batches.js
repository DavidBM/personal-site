import { publishTopic, subscribeTopic, Topics } from '../protocol/topics.js';
/** A new generation or clear fences batches still queued from an older run. */
export function subscribeGenerationBatches(bus, mirror, apply, complete) {
    let generationId;
    let sequence = 0;
    let lifetime;
    const clear = () => { lifetime?.abort(); lifetime = undefined; generationId = undefined; sequence = 0; };
    bus.signal.addEventListener('abort', clear, { once: true });
    const disposers = [
        subscribeTopic(bus, Topics.galaxyGenerationStarted, (event) => { clear(); generationId = event.generationId; lifetime = new AbortController(); }),
        subscribeTopic(bus, Topics.clearGalaxy, clear),
        subscribeTopic(bus, Topics.galaxyCancelled, event => { if (event.generationId === generationId)
            clear(); }),
        subscribeTopic(bus, Topics.galaxyError, event => { if (event.generationId !== undefined && event.generationId === generationId)
            clear(); }),
        subscribeTopic(bus, Topics.galaxyOps, async (batch) => {
            let error;
            try {
                if (!lifetime || batch.generationId !== generationId || batch.sequence !== sequence + 1)
                    throw new Error('Stale or out-of-order generation batch');
                sequence = batch.sequence;
                await apply(batch.ops, lifetime.signal);
                if (batch.generationId !== generationId)
                    throw new Error('Generation was cleared during application');
            }
            catch (reason) {
                error = reason instanceof Error ? reason.message : String(reason);
            }
            if (!bus.signal.aborted)
                publishTopic(bus, Topics.galaxyOpsApplied, { generationId: batch.generationId, sequence: batch.sequence, mirror, error }, 0);
        }),
    ];
    if (complete)
        disposers.push(subscribeTopic(bus, Topics.galaxyComplete, payload => {
            if ((generationId !== undefined && payload.generationId === generationId) || payload.source === 'regeneration')
                complete(payload);
        }));
    return () => { clear(); bus.signal.removeEventListener('abort', clear); for (const dispose of disposers)
        dispose(); };
}
//# sourceMappingURL=subscribe-generation-batches.js.map