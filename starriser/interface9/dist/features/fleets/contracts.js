import { defineTopic } from "../../worker/protocol/feature-topics.js";
/** Stable wire names retained for the existing broker and saved tooling. */
export const FleetTopicNames = {
    generateFleet: "generate_fleet",
    generateFleetsBulk: "generate_fleets_bulk",
    moveLocal: "fleet_move_local",
    fleetSpawned: "fleet_spawned",
    fleetsSpawnedBatch: "fleets_spawned_batch",
    fleetState: "fleet_state",
    fleetRemoved: "fleet_removed",
    simPause: "sim_pause",
};
/** Commands are requests; lifecycle events report the worker's accepted state. */
export const FleetTopics = {
    generateFleet: defineTopic(FleetTopicNames.generateFleet),
    generateFleetsBulk: defineTopic(FleetTopicNames.generateFleetsBulk),
    moveLocal: defineTopic(FleetTopicNames.moveLocal),
    fleetSpawned: defineTopic(FleetTopicNames.fleetSpawned),
    fleetsSpawnedBatch: defineTopic(FleetTopicNames.fleetsSpawnedBatch),
    fleetState: defineTopic(FleetTopicNames.fleetState),
    fleetRemoved: defineTopic(FleetTopicNames.fleetRemoved),
    simPause: defineTopic(FleetTopicNames.simPause),
};
//# sourceMappingURL=contracts.js.map