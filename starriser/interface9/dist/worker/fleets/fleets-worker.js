import { createBattleRuntime } from "../../features/battles/runtime.js";
import { BattleTopics } from "../../features/battles/contracts.js";
import { publishFeatureTopic } from "../protocol/feature-topics.js";
import { subscribeGalaxyMirror } from "../bus/subscribe-galaxy-mirror.js";
import { whenPubSubReady } from "../bus/when-pubsub-ready.js";
import { subscribeFeatureTopic } from "../../worker/protocol/feature-topics.js";
import { FleetTopics } from "../../features/fleets/contracts.js";
import { createFleetRuntime } from "../../features/fleets/runtime.js";
import { createFleetPublishers, subscribeFleetCommands, } from "../../features/fleets/subscriptions.js";
import { readSimPause, simNowMs } from "../../lib/sim-clock.js";
const TICK_MS = 120;
/** Worker lifetime and broker wiring only; the feature runtime is headless. */
export function busConstructor(bus) {
    let destroyed = false;
    let tickHandle = null;
    let unsubscribeMirror;
    let unsubscribeCommands;
    let unsubscribePause;
    let sim = { paused: false, pauseAccumMs: 0, frozenSimMs: 0 };
    const runtime = createFleetRuntime({
        now: () => simNowMs(Date.now(), sim),
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
    const battles = createBattleRuntime({ now: () => simNowMs(Date.now(), sim), fleets: runtime.battlePort,
        changed: event => publishFeatureTopic(bus, BattleTopics.changed, event),
        rejected: reason => publishFeatureTopic(bus, BattleTopics.rejected, { reason }) });
    const battleOff = [];
    whenPubSubReady(bus, () => {
        if (destroyed)
            return;
        if (bus.getDebugLevel() >= 1) {
            console.log("Fleets worker setting up pub/sub subscriptions");
        }
        unsubscribeMirror = subscribeGalaxyMirror(bus, {
            onOps: runtime.applyOps,
            onClearGalaxy: () => { battles.clear(); runtime.clear(); },
        }, 'fleets');
        unsubscribeCommands = subscribeFleetCommands(bus, runtime);
        unsubscribePause = subscribeFeatureTopic(bus, FleetTopics.simPause, (payload) => {
            sim = readSimPause(payload, sim.frozenSimMs);
        });
        battleOff.push(subscribeFeatureTopic(bus, BattleTopics.fight, battles.fight), subscribeFeatureTopic(bus, BattleTopics.observe, battles.observe), subscribeFeatureTopic(bus, BattleTopics.end, battles.end));
        tickHandle = setInterval(() => { runtime.tick(); battles.tick(); }, TICK_MS);
    });
    bus.send("worker_ready", { role: "fleets" });
    return {
        destroy: () => {
            if (destroyed)
                return;
            destroyed = true;
            unsubscribeMirror?.();
            unsubscribeCommands?.();
            unsubscribePause?.();
            if (tickHandle != null)
                clearInterval(tickHandle);
            tickHandle = null;
            for (const off of battleOff)
                off();
            battles.clear();
            runtime.dispose();
        },
    };
}
//# sourceMappingURL=fleets-worker.js.map