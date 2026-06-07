export function registerAppWorkerRuntimeSubscriptions(bus, targets, logger = console) {
    if (!bus._brokerReady) {
        logger.warn("Pub/sub not available on main bus - broker not ready");
        return false;
    }
    bus.subscribe("ops", (ops) => {
        targets.processOps(ops);
        targets.updateStats();
    });
    bus.subscribe("complete", (payload) => {
        if (!payload || payload.finalizeBuffers !== false) {
            targets.finalizeBuffers();
        }
        targets.updateStats();
    });
    bus.subscribe("error", ({ error }) => {
        targets.showError(`Galaxy Worker error: ${error}`);
    });
    bus.subscribe("update_ui_state", (update) => {
        targets.handleUIStateUpdate(update);
    });
    bus.subscribe("setConnectionColors", (connectionColors) => {
        targets.setConnectionColors(connectionColors);
    });
    bus.subscribe("show_edit_handles", ({ clusterId, handles }) => {
        targets.setEditModeActive(true, clusterId);
        targets.setEditingClusterId(clusterId);
        targets.showEditHandles(clusterId, handles);
    });
    bus.subscribe("hide_edit_handles", ({ clusterId }) => {
        targets.setEditModeActive(false, null);
        targets.setEditingClusterId(null);
        targets.hideEditHandles(clusterId);
    });
    bus.subscribe("update_cluster", ({ clusterId, position }) => {
        targets.handleClusterDragUpdate(clusterId, position);
    });
    bus.subscribe("commit_cluster_move", ({ clusterId, position }) => {
        targets.handleClusterDragCommit(clusterId, position);
    });
    bus.subscribe("fleet_spawned", ({ id, counts, state }) => {
        targets.handleFleetSpawned(id, counts, state);
    });
    bus.subscribe("fleet_state", ({ id, state }) => {
        targets.handleFleetState(id, state);
    });
    bus.subscribe("fleet_removed", ({ id }) => {
        targets.handleFleetRemoved(id);
    });
    return true;
}
export function registerAppLifecycleSubscriptions({ bus, targets, logger = console, }) {
    if (!bus._brokerReady) {
        logger.warn("Pub/sub not available on main bus - broker not ready");
        return false;
    }
    try {
        const debugLevel = bus._options?.debug ?? 0;
        bus.subscribe("galaxy_generation_started", (data) => {
            if (isRecord(data) && typeof data.generationId === "number") {
                logger.log("🌌 Galaxy generation started:", data.generationId);
            }
        });
        bus.subscribe("galaxy_generation_complete", (data) => {
            if (isRecord(data) && typeof data.generationId === "number") {
                logger.log("✅ Galaxy generation complete:", data.generationId);
            }
        });
        bus.subscribe("galaxy_regeneration_started", (data) => {
            if (isRecord(data) && typeof data.regenerationId === "number") {
                logger.log("🔁 Galaxy regeneration started:", data.regenerationId);
            }
        });
        bus.subscribe("galaxy_regeneration_complete", (data) => {
            if (isRecord(data) && typeof data.regenerationId === "number") {
                logger.log("✅ Galaxy regeneration complete:", data.regenerationId);
            }
        });
        bus.subscribe("galaxy_generation_error", (data) => {
            if (isRecord(data) && typeof data.error === "string") {
                logger.error("❌ Galaxy generation error:", data.error);
            }
        });
        bus.subscribe("selection_changed", (data) => {
            if (debugLevel >= 2) {
                logger.log("🎯 Selection changed:", data);
            }
        });
        bus.subscribe("edit_mode_changed", (data) => {
            if (!isRecord(data))
                return;
            const clusterId = data.clusterId;
            const editMode = data.editMode;
            if (typeof clusterId !== "number" || typeof editMode !== "boolean") {
                return;
            }
            targets.setEditingClusterId(editMode ? clusterId : null);
            logger.log("✏️ Edit mode changed:", clusterId, "editMode:", editMode);
        });
        logger.log("📢 Main thread pub/sub subscriptions set up successfully");
        return true;
    }
    catch (error) {
        logger.error("❌ Failed to set up main thread pub/sub subscriptions:", error);
        return false;
    }
}
export function demonstrateAppPubSubSystem({ bus, logger = console, now = Date.now, setTimeoutFn = setTimeout, }) {
    if (!bus.publish || !bus._brokerReady) {
        logger.warn("Pub/sub not available for demonstration - broker not ready");
        return false;
    }
    logger.log("🧪 Demonstrating pub/sub system...");
    try {
        setTimeoutFn(() => {
            try {
                bus.publish?.("test_message", {
                    message: "Hello from main thread!",
                    timestamp: now(),
                });
                logger.log("📤 Test message published");
            }
            catch (error) {
                logger.error("❌ Failed to publish test message:", error);
            }
        }, 1000);
        setTimeoutFn(() => {
            try {
                bus.publish?.("request_galaxy_status", {});
                logger.log("📤 Galaxy status request published");
            }
            catch (error) {
                logger.error("❌ Failed to publish galaxy status request:", error);
            }
        }, 2000);
        return true;
    }
    catch (error) {
        logger.error("❌ Failed to demonstrate pub/sub system:", error);
        return false;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=app-main-bus.js.map