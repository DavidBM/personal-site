import { publishFeatureTopic, subscribeFeatureTopic, } from "../../worker/protocol/feature-topics.js";
import { FleetTopics } from "./contracts.js";
/** The worker binds only its commands; future mechanics own separate bindings. */
export function subscribeFleetCommands(transport, runtime) {
    const offGenerate = subscribeFeatureTopic(transport, FleetTopics.generateFleet, runtime.generate);
    const offBulk = subscribeFeatureTopic(transport, FleetTopics.generateFleetsBulk, runtime.generateBulk);
    const offMove = subscribeFeatureTopic(transport, FleetTopics.moveLocal, runtime.moveLocal);
    return () => { offGenerate(); offBulk(); offMove(); };
}
/** Main UI, worker renderer, and headless fixtures consume the same events. */
export function subscribeFleetEvents(transport, handlers) {
    const offSpawn = subscribeFeatureTopic(transport, FleetTopics.fleetSpawned, handlers.onFleetSpawned);
    const offBatch = subscribeFeatureTopic(transport, FleetTopics.fleetsSpawnedBatch, handlers.onFleetsSpawnedBatch);
    const offState = subscribeFeatureTopic(transport, FleetTopics.fleetState, handlers.onFleetState);
    const offStates = subscribeFeatureTopic(transport, FleetTopics.fleetsStateBatch, payload => {
        if (handlers.onFleetsStateBatch)
            handlers.onFleetsStateBatch(payload);
        else
            for (const fleet of payload.fleets)
                handlers.onFleetState(fleet);
    });
    const offRemove = subscribeFeatureTopic(transport, FleetTopics.fleetRemoved, handlers.onFleetRemoved);
    return () => { offSpawn(); offBatch(); offState(); offStates(); offRemove(); };
}
export function createFleetPublishers(transport) {
    return {
        onFleetSpawned: (payload) => publishFeatureTopic(transport, FleetTopics.fleetSpawned, payload),
        onFleetsSpawnedBatch: (payload) => publishFeatureTopic(transport, FleetTopics.fleetsSpawnedBatch, payload),
        onFleetState: (payload) => publishFeatureTopic(transport, FleetTopics.fleetState, payload),
        onFleetsStateBatch: (payload) => publishFeatureTopic(transport, FleetTopics.fleetsStateBatch, payload),
        onFleetRemoved: (payload) => publishFeatureTopic(transport, FleetTopics.fleetRemoved, payload),
    };
}
//# sourceMappingURL=subscriptions.js.map