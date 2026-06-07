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
    fleetSpawned: "fleet_spawned",
    fleetState: "fleet_state",
    fleetRemoved: "fleet_removed",
    galaxyGenerationStarted: "galaxy_generation_started",
    galaxyGenerationComplete: "galaxy_generation_complete",
    galaxyGenerationError: "galaxy_generation_error",
    galaxyGenerationCancelled: "galaxy_generation_cancelled",
    galaxyRegenerationStarted: "galaxy_regeneration_started",
    galaxyRegenerationComplete: "galaxy_regeneration_complete",
    selectionChanged: "selection_changed",
    editModeChanged: "edit_mode_changed",
    connectionsColored: "connections_colored",
    connectionsCleared: "connections_cleared",
};
export function publishTopic(bus, topic, payload, priority = 1) {
    bus.publish(topic, payload, priority);
}
export function subscribeTopic(bus, topic, handler) {
    bus.subscribe(topic, handler);
}
//# sourceMappingURL=topics.js.map