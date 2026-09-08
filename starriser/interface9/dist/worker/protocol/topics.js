import { FleetTopicNames } from "../../features/fleets/contracts.js";
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
    galaxyOpsApplied: "galaxy_ops_applied",
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
    ...FleetTopicNames,
    galaxyGenerationStarted: "galaxy_generation_started",
    galaxyRegenerationStarted: "galaxy_regeneration_started",
    galaxyRegenerationComplete: "galaxy_regeneration_complete",
    editModeChanged: "edit_mode_changed",
};
export function publishTopic(bus, topic, payload, priority = 1) {
    bus.publish(topic, payload, priority);
}
/** Resolves after queue admission; application completion is a domain event. */
export function publishTopicWithBackpressure(bus, topic, payload, priority = 1, options) {
    return bus.publishWithBackpressure(topic, payload, priority, options);
}
export function publishTopicAndIgnoreAfterTimeout(bus, topic, payload, maxQueueAgeMs, priority = 1) {
    return bus.publishAndIgnoreAfterTimeout(topic, payload, maxQueueAgeMs, priority);
}
export function subscribeTopic(bus, topic, handler) {
    bus.subscribe(topic, handler);
    let active = true;
    return () => {
        if (!active)
            return;
        active = false;
        bus.unsubscribe(topic, handler);
    };
}
//# sourceMappingURL=topics.js.map