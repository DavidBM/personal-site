import { subscribeTopic, Topics } from "../protocol/topics.js";
import { subscribeGenerationBatches } from './subscribe-generation-batches.js';
/**
 * Workers that mirror topology subscribe to both generation batches and
 * main-thread local ops (regeneration) with the same handler.
 */
export function subscribeGalaxyMirror(bus, handlers, mirror) {
    const disposers = [
        subscribeGenerationBatches(bus, mirror, handlers.onOps),
        subscribeTopic(bus, Topics.galaxyLocalOps, handlers.onOps),
    ];
    if (handlers.onClearGalaxy) {
        disposers.push(subscribeTopic(bus, Topics.clearGalaxy, handlers.onClearGalaxy));
    }
    return () => { for (const dispose of disposers)
        dispose(); };
}
//# sourceMappingURL=subscribe-galaxy-mirror.js.map