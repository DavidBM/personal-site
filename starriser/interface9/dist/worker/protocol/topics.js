/**
 * Wire topic names. One topic per semantic event.
 * Prefer small payloads; main-thread handlers must stay ≤ ~1 ms.
 *
 * Priority convention (callers may override):
 * - 0 real-time: pointer, local ops, drag
 * - 1 normal: UI state, fleet events, generation start
 * - 2 background: OP batches, generation complete
 */
export const Topics = {
    galaxyOps: "ops",
    galaxyLocalOps: "ops_local",
    galaxyComplete: "complete",
    galaxyError: "error",
    generateGalaxy: "generateGalaxy",
    cancelGeneration: "cancelGeneration",
    galaxyCancelled: "cancelled",
    clearGalaxy: "clearGalaxy",
    pointerEvent: "pointer_event",
    updateUIState: "update_ui_state",
    setConnectionColors: "setConnectionColors",
    showEditHandles: "show_edit_handles",
    hideEditHandles: "hide_edit_handles",
    updateCluster: "update_cluster",
    commitClusterMove: "commit_cluster_move",
    generateFleet: "generate_fleet",
    /** One request for N fleets; fleets-worker chunks spawn + batch replies. */
    generateFleetsBulk: "generate_fleets_bulk",
    fleetSpawned: "fleet_spawned",
    /** Small batch of successful spawns (64–128); cuts main-thread message storm. */
    fleetsSpawnedBatch: "fleets_spawned_batch",
    fleetState: "fleet_state",
    fleetRemoved: "fleet_removed",
    galaxyGenerationStarted: "galaxy_generation_started",
    galaxyRegenerationStarted: "galaxy_regeneration_started",
    galaxyRegenerationComplete: "galaxy_regeneration_complete",
    editModeChanged: "edit_mode_changed",
};
export function publishTopic(bus, topic, payload, priority = 1) {
    bus.publish(topic, payload, priority);
}
export function subscribeTopic(bus, topic, handler) {
    bus.subscribe(topic, handler);
}
//# sourceMappingURL=topics.js.map