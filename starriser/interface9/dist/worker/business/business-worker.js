import { subscribeGalaxyMirror } from "../bus/subscribe-galaxy-mirror.js";
import { whenPubSubReady } from "../bus/when-pubsub-ready.js";
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
    whenPubSubReady(bus, () => {
        if (bus.getDebugLevel() >= 1) {
            console.log("📢 Business worker setting up pub/sub subscriptions");
        }
        SelectionStore.subscribe(interactions.handleSelectionChange);
        subscribeTopic(bus, Topics.pointerEvent, interactions.handlePointerEvent);
        subscribeGalaxyMirror(bus, {
            onOps: interactions.handleOps,
            onClearGalaxy: interactions.handleClearGalaxy,
        });
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