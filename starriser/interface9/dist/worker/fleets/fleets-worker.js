import { subscribeGalaxyMirror } from "../bus/subscribe-galaxy-mirror.js";
import { whenPubSubReady } from "../bus/when-pubsub-ready.js";
import { createFleetRuntime } from "../../features/fleets/runtime.js";
import { createFleetPublishers, subscribeFleetCommands, } from "../../features/fleets/subscriptions.js";
const TICK_MS = 120;
/** Worker lifetime and broker wiring only; the feature runtime is headless. */
export function busConstructor(bus) {
    let destroyed = false;
    let tickHandle = null;
    let unsubscribeMirror;
    let unsubscribeCommands;
    const runtime = createFleetRuntime({
        now: Date.now,
        random: Math.random,
        defer: (task) => {
            const handle = setTimeout(task, 0);
            return () => clearTimeout(handle);
        },
        events: createFleetPublishers(bus),
        onBulkShortfall: (remaining) => {
            if (bus.getDebugLevel() >= 1) {
                console.warn(`[fleets] bulk spawn short: need ${remaining} more (galaxy empty?)`);
            }
        },
    });
    whenPubSubReady(bus, () => {
        if (destroyed)
            return;
        if (bus.getDebugLevel() >= 1) {
            console.log("Fleets worker setting up pub/sub subscriptions");
        }
        unsubscribeMirror = subscribeGalaxyMirror(bus, {
            onOps: runtime.applyOps,
            onClearGalaxy: runtime.clear,
        }, 'fleets');
        unsubscribeCommands = subscribeFleetCommands(bus, runtime);
        tickHandle = setInterval(runtime.tick, TICK_MS);
    });
    bus.send("worker_ready", { role: "fleets" });
    return {
        destroy: () => {
            if (destroyed)
                return;
            destroyed = true;
            unsubscribeMirror?.();
            unsubscribeCommands?.();
            if (tickHandle != null)
                clearInterval(tickHandle);
            tickHandle = null;
            runtime.dispose();
        },
    };
}
//# sourceMappingURL=fleets-worker.js.map