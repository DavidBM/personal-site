import { publishTopic, subscribeTopic, Topics } from '../worker/protocol/topics.js';
/** Admission can finish before a mirror applies its batch. Keep the generation
 * owner informed of an explicitly disconnected worker during that final wait. */
export function watchGenerationWorkers(bus, report) {
    let generationId;
    const broker = bus.getWorker('broker');
    const required = new Set(['galaxy', 'business', 'fleets', 'broker']);
    function failed(workerId) {
        if (!required.has(workerId) || generationId === undefined || bus.signal.aborted)
            return;
        const id = generationId;
        generationId = undefined;
        const error = `Required generation worker ${workerId} disconnected`;
        if (workerId === 'broker') {
            bus.destroy();
            report(error);
            return;
        }
        publishTopic(bus, Topics.cancelGeneration, { generationId: id }, 0);
        publishTopic(bus, Topics.galaxyError, { generationId: id, error }, 0);
    }
    const disconnected = (data) => {
        if (data && typeof data === 'object' && 'workerId' in data && typeof data.workerId === 'string')
            failed(data.workerId);
    };
    broker?.bus.on('worker_disconnected', disconnected);
    const clear = () => { generationId = undefined; };
    const disposers = [
        subscribeTopic(bus, Topics.galaxyGenerationStarted, event => { generationId = event.generationId; }),
        subscribeTopic(bus, Topics.galaxyComplete, event => { if (event.generationId === generationId)
            clear(); }),
        subscribeTopic(bus, Topics.galaxyCancelled, event => { if (event.generationId === generationId)
            clear(); }),
        subscribeTopic(bus, Topics.galaxyError, event => { if (event.generationId === generationId)
            clear(); }),
        subscribeTopic(bus, Topics.clearGalaxy, clear),
    ];
    for (const workerId of required) {
        const worker = bus.getWorker(workerId)?.worker;
        const error = () => {
            if (bus.getWorker(workerId)?.worker !== worker)
                return;
            failed(workerId);
            if (workerId === 'broker')
                bus.destroy();
            else
                bus.terminateWorker(workerId);
        };
        worker?.addEventListener('error', error);
        disposers.push(() => worker?.removeEventListener('error', error));
    }
    return () => {
        clear();
        broker?.bus.off('worker_disconnected', disconnected);
        for (const dispose of disposers)
            dispose();
    };
}
//# sourceMappingURL=generation-worker-lifetime.js.map