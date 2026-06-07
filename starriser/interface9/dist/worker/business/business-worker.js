import { publishTopic, subscribeTopic, Topics, } from "../protocol/topics.js";
import { createBusinessWorld } from "./business-world.js";
import { createEditModeController } from "./edit-mode-controller.js";
import { createPointerInteractionController } from "./pointer-interactions.js";
import { SelectionStore } from "./selection-store.js";
export function busConstructor(bus) {
    const world = createBusinessWorld();
    const editMode = createEditModeController();
    const interactions = createPointerInteractionController({
        world,
        editMode,
        publish: (topic, data, priority) => {
            publishTopic(bus, topic, data, priority);
        },
    });
    let pubSubReady = false;
    const setupPubSubSubscriptions = () => {
        if (pubSubReady || !bus.hasBrokerPort())
            return;
        pubSubReady = true;
        const debugLevel = bus.getDebugLevel();
        if (debugLevel >= 1) {
            console.log("📢 Business worker setting up pub/sub subscriptions");
        }
        SelectionStore.subscribe(interactions.handleSelectionChange);
        subscribeTopic(bus, Topics.pointerEvent, interactions.handlePointerEvent);
        subscribeTopic(bus, Topics.galaxyOps, interactions.handleOps);
        subscribeTopic(bus, Topics.galaxyLocalOps, interactions.handleOps);
        subscribeTopic(bus, Topics.clearGalaxy, interactions.handleClearGalaxy);
        subscribeTopic(bus, Topics.galaxyGenerationComplete, () => {
            if (debugLevel >= 1) {
                console.log("🌌 Business worker received galaxy generation complete");
            }
        });
        subscribeTopic(bus, Topics.galaxyRegenerationComplete, (data) => {
            if (debugLevel >= 1) {
                console.log("🔁 Business worker received galaxy regeneration complete", data);
            }
        });
    };
    if (bus.hasBrokerPort()) {
        setupPubSubSubscriptions();
    }
    bus.on("setup_broker_port", () => {
        setupPubSubSubscriptions();
    });
    bus.send("worker_ready", { role: "business" });
    return {
        destroy: () => {
            SelectionStore.unsubscribe(interactions.handleSelectionChange);
            interactions.destroy();
        },
    };
}
//# sourceMappingURL=business-worker.js.map