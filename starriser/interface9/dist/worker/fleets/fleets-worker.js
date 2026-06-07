import { publishTopic, subscribeTopic, Topics, } from "../protocol/topics.js";
import { applyFleetOps, clearFleetWorld, createFleetWorld, removeInvalidFleets, } from "./fleet-world.js";
import { tickFleets } from "./fleet-simulation.js";
import { spawnFleet } from "./fleet-spawner.js";
const TICK_MS = 120;
export function busConstructor(bus) {
    const world = createFleetWorld();
    let pubSubReady = false;
    let tickHandle = null;
    const publishState = (fleet) => {
        publishTopic(bus, Topics.fleetState, { id: fleet.id, state: fleet.state });
    };
    const publishRemoved = (fleetId) => {
        publishTopic(bus, Topics.fleetRemoved, { id: fleetId });
    };
    const publishSpawned = (fleet) => {
        publishTopic(bus, Topics.fleetSpawned, { id: fleet.id, counts: fleet.counts, state: fleet.state });
    };
    const handleOps = (ops) => {
        applyFleetOps(world, ops);
        for (const fleetId of removeInvalidFleets(world)) {
            publishRemoved(fleetId);
        }
    };
    const handleClearGalaxy = () => {
        clearFleetWorld(world);
    };
    const tick = () => {
        tickFleets(world, Date.now(), publishState, publishRemoved);
    };
    const ensureTicking = () => {
        if (tickHandle != null)
            return;
        tickHandle = self.setInterval(tick, TICK_MS);
    };
    const setupPubSubSubscriptions = () => {
        if (pubSubReady || !bus.hasBrokerPort())
            return;
        pubSubReady = true;
        const debugLevel = bus.getDebugLevel();
        if (debugLevel >= 1) {
            console.log("📢 Fleets worker setting up pub/sub subscriptions");
        }
        subscribeTopic(bus, Topics.galaxyOps, handleOps);
        subscribeTopic(bus, Topics.galaxyLocalOps, handleOps);
        subscribeTopic(bus, Topics.clearGalaxy, handleClearGalaxy);
        subscribeTopic(bus, Topics.generateFleet, () => {
            spawnFleet(world, Date.now(), publishSpawned, publishState, publishRemoved);
        });
        ensureTicking();
    };
    if (bus.hasBrokerPort()) {
        setupPubSubSubscriptions();
    }
    bus.on("setup_broker_port", () => {
        setupPubSubSubscriptions();
    });
    bus.send("worker_ready", { role: "fleets" });
    return {
        destroy: () => {
            if (tickHandle != null) {
                clearInterval(tickHandle);
                tickHandle = null;
            }
            clearFleetWorld(world);
        },
    };
}
//# sourceMappingURL=fleets-worker.js.map