import { publishFeatureTopic, subscribeFeatureTopic, } from "../../worker/protocol/feature-topics.js";
import { FleetTopics } from "./contracts.js";
/** The worker binds only its commands; future mechanics own separate bindings. */
export function subscribeFleetCommands(transport, runtime) {
    const offGenerate = subscribeFeatureTopic(transport, FleetTopics.generateFleet, runtime.generate);
    const offBulk = subscribeFeatureTopic(transport, FleetTopics.generateFleetsBulk, runtime.generateBulk);
    return () => { offGenerate(); offBulk(); };
}
/** Main UI, worker renderer, and headless fixtures consume the same events. */
export function subscribeFleetEvents(transport, handlers) {
    const offSpawn = subscribeFeatureTopic(transport, FleetTopics.fleetSpawned, handlers.onFleetSpawned);
    const offBatch = subscribeFeatureTopic(transport, FleetTopics.fleetsSpawnedBatch, handlers.onFleetsSpawnedBatch);
    const offState = subscribeFeatureTopic(transport, FleetTopics.fleetState, handlers.onFleetState);
    const offRemove = subscribeFeatureTopic(transport, FleetTopics.fleetRemoved, handlers.onFleetRemoved);
    return () => { offSpawn(); offBatch(); offState(); offRemove(); };
}
export function createFleetPublishers(transport) {
    return {
        onFleetSpawned: (payload) => publishFeatureTopic(transport, FleetTopics.fleetSpawned, payload),
        onFleetsSpawnedBatch: (payload) => publishFeatureTopic(transport, FleetTopics.fleetsSpawnedBatch, payload),
        onFleetState: (payload) => publishFeatureTopic(transport, FleetTopics.fleetState, payload),
        onFleetRemoved: (payload) => publishFeatureTopic(transport, FleetTopics.fleetRemoved, payload),
    };
}
//# sourceMappingURL=subscriptions.js.map