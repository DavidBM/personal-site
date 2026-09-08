import { defineTopic } from "../../worker/protocol/feature-topics.js";
/** Stable wire names retained for the existing broker and saved tooling. */
export const FleetTopicNames = {
    generateFleet: "generate_fleet",
    generateFleetsBulk: "generate_fleets_bulk",
    fleetSpawned: "fleet_spawned",
    fleetsSpawnedBatch: "fleets_spawned_batch",
    fleetState: "fleet_state",
    fleetRemoved: "fleet_removed",
};
/** Commands are requests; lifecycle events report the worker's accepted state. */
export const FleetTopics = {
    generateFleet: defineTopic(FleetTopicNames.generateFleet),
    generateFleetsBulk: defineTopic(FleetTopicNames.generateFleetsBulk),
    fleetSpawned: defineTopic(FleetTopicNames.fleetSpawned),
    fleetsSpawnedBatch: defineTopic(FleetTopicNames.fleetsSpawnedBatch),
    fleetState: defineTopic(FleetTopicNames.fleetState),
    fleetRemoved: defineTopic(FleetTopicNames.fleetRemoved),
};
//# sourceMappingURL=contracts.js.map