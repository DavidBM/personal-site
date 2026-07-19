import { subscribeTopic, Topics } from "../protocol/topics.js";
/**
 * Workers that mirror topology subscribe to both generation batches and
 * main-thread local ops (regeneration) with the same handler.
 */
export function subscribeGalaxyMirror(bus, handlers) {
    subscribeTopic(bus, Topics.galaxyOps, handlers.onOps);
    subscribeTopic(bus, Topics.galaxyLocalOps, handlers.onOps);
    if (handlers.onClearGalaxy) {
        subscribeTopic(bus, Topics.clearGalaxy, handlers.onClearGalaxy);
    }
}
//# sourceMappingURL=subscribe-galaxy-mirror.js.map