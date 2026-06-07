import { subscribeTopic, Topics, } from "../worker/protocol/topics.js";
const isRecord = (value) => typeof value === "object" && value !== null;
export function subscribeAppTopics(mainBus, handlers) {
    subscribeGalaxyTopics(mainBus, handlers.galaxy);
    subscribeBusinessTopics(mainBus, handlers.business);
    subscribeFleetTopics(mainBus, handlers.fleets);
}
export function subscribeGalaxyTopics(mainBus, handlers) {
    if (!mainBus.isPubSubReady()) {
        console.warn("Pub/sub not available on main bus - broker not ready");
        return;
    }
    subscribeTopic(mainBus, Topics.galaxyOps, handlers.onGalaxyOps);
    subscribeTopic(mainBus, Topics.galaxyComplete, handlers.onGalaxyComplete);
    subscribeTopic(mainBus, Topics.galaxyError, ({ error }) => {
        handlers.onGalaxyError(error);
    });
}
export function subscribeBusinessTopics(mainBus, handlers) {
    if (!mainBus.isPubSubReady()) {
        console.warn("Pub/sub not available on main bus - broker not ready");
        return;
    }
    subscribeTopic(mainBus, Topics.updateUIState, handlers.onUIState);
    subscribeTopic(mainBus, Topics.setConnectionColors, handlers.onConnectionColors);
    subscribeTopic(mainBus, Topics.showEditHandles, handlers.onShowEditHandles);
    subscribeTopic(mainBus, Topics.hideEditHandles, handlers.onHideEditHandles);
    subscribeTopic(mainBus, Topics.updateCluster, handlers.onUpdateCluster);
    subscribeTopic(mainBus, Topics.commitClusterMove, handlers.onCommitClusterMove);
}
export function subscribeFleetTopics(mainBus, handlers) {
    if (!mainBus.isPubSubReady()) {
        console.warn("Pub/sub not available on main bus - broker not ready");
        return;
    }
    subscribeTopic(mainBus, Topics.fleetSpawned, handlers.onFleetSpawned);
    subscribeTopic(mainBus, Topics.fleetState, handlers.onFleetState);
    subscribeTopic(mainBus, Topics.fleetRemoved, handlers.onFleetRemoved);
}
export function subscribeAppLifecycleDebugTopics(mainBus) {
    if (!mainBus.isPubSubReady()) {
        console.warn("Pub/sub not available on main bus - broker not ready");
        return;
    }
    try {
        const debugLevel = mainBus.getDebugLevel();
        subscribeTopic(mainBus, Topics.galaxyGenerationStarted, (data) => {
            if (typeof data.generationId === "number") {
                console.log("🌌 Galaxy generation started:", data.generationId);
            }
        });
        subscribeTopic(mainBus, Topics.galaxyGenerationComplete, (data) => {
            if (typeof data.generationId === "number") {
                console.log("✅ Galaxy generation complete:", data.generationId);
            }
        });
        subscribeTopic(mainBus, Topics.galaxyRegenerationStarted, (data) => {
            if (typeof data.regenerationId === "number") {
                console.log("🔁 Galaxy regeneration started:", data.regenerationId);
            }
        });
        subscribeTopic(mainBus, Topics.galaxyRegenerationComplete, (data) => {
            if (typeof data.regenerationId === "number") {
                console.log("✅ Galaxy regeneration complete:", data.regenerationId);
            }
        });
        subscribeTopic(mainBus, Topics.galaxyGenerationError, ({ error }) => {
            console.error("❌ Galaxy generation error:", error);
        });
        subscribeTopic(mainBus, Topics.selectionChanged, (data) => {
            if (debugLevel >= 2) {
                console.log("🎯 Selection changed:", data);
            }
        });
        subscribeTopic(mainBus, Topics.editModeChanged, (data) => {
            if (!isRecord(data))
                return;
            const clusterId = data.clusterId;
            const editMode = data.editMode;
            if (typeof clusterId === "number" && typeof editMode === "boolean") {
                console.log("✏️ Edit mode changed:", clusterId, "editMode:", editMode);
            }
        });
        console.log("📢 Main thread pub/sub subscriptions set up successfully");
    }
    catch (error) {
        console.error("❌ Failed to set up main thread pub/sub subscriptions:", error);
    }
}
//# sourceMappingURL=app-subscriptions.js.map