import { subscribeGalaxyMirror } from "../bus/subscribe-galaxy-mirror.js";
import { whenPubSubReady } from "../bus/when-pubsub-ready.js";
import { publishTopic, subscribeTopic, Topics, } from "../protocol/topics.js";
import { applyFleetOps, clearFleetWorld, createFleetWorld, removeInvalidFleets, } from "./fleet-world.js";
import { tickFleets } from "./fleet-simulation.js";
import { spawnFleet, spawnParkedAt, trySpawnFleet, } from "./fleet-spawner.js";
const TICK_MS = 120;
/**
 * Worker-side bulk spawn pacing.
 * - WORK_CHUNK: max successful trySpawn attempts per macrotask (path CPU).
 * - OUT_BATCH: fleets per fleets_spawned_batch (small structured clone).
 */
/** Spawns attempted per worker macrotask (pathfind CPU on fleets-worker only). */
const BULK_WORK_CHUNK = 800;
/** Fleets per fleets_spawned_batch (small structured-clone messages). */
const BULK_OUT_BATCH = 128;
export function busConstructor(bus) {
    const world = createFleetWorld();
    let tickHandle = null;
    /** Cancel token for in-flight bulk pump (clear galaxy / new bulk). */
    let bulkGen = 0;
    const publishState = (fleet) => {
        publishTopic(bus, Topics.fleetState, { id: fleet.id, state: fleet.state });
    };
    const publishRemoved = (fleetId) => {
        publishTopic(bus, Topics.fleetRemoved, { id: fleetId });
    };
    const publishSpawned = (fleet) => {
        publishTopic(bus, Topics.fleetSpawned, {
            id: fleet.id,
            counts: fleet.counts,
            state: fleet.state,
        });
    };
    const publishSpawnedBatch = (fleets) => {
        if (fleets.length === 0)
            return;
        publishTopic(bus, Topics.fleetsSpawnedBatch, { fleets });
    };
    const handleOps = (ops) => {
        applyFleetOps(world, ops);
        for (const fleetId of removeInvalidFleets(world)) {
            publishRemoved(fleetId);
        }
    };
    const handleClearGalaxy = () => {
        bulkGen++;
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
    /**
     * Pump bulk spawns on the worker only — main never runs pathfinding.
     * Yields between chunks so the worker stays responsive to ops/ticks.
     */
    const startBulkSpawn = (count) => {
        const n = Math.max(0, Math.min(count | 0, 100000));
        if (n <= 0)
            return;
        const gen = ++bulkGen;
        let need = n;
        /** Cap retries so empty worlds do not spin forever. */
        let attemptsLeft = Math.max(n * 4, n + 64);
        const pending = [];
        const flushPending = () => {
            if (pending.length === 0)
                return;
            publishSpawnedBatch(pending.splice(0, pending.length));
        };
        const pump = () => {
            if (gen !== bulkGen)
                return;
            const now = Date.now();
            let work = 0;
            // Count work as attempts (not only successes) so failed picks still yield.
            while (need > 0 && attemptsLeft > 0 && work < BULK_WORK_CHUNK) {
                attemptsLeft--;
                work++;
                const fleet = trySpawnFleet(world, now);
                if (!fleet)
                    continue;
                need--;
                pending.push({
                    id: fleet.id,
                    counts: fleet.counts,
                    state: fleet.state,
                });
                if (pending.length >= BULK_OUT_BATCH) {
                    flushPending();
                }
            }
            if (need > 0 && attemptsLeft > 0) {
                self.setTimeout(pump, 0);
            }
            else {
                flushPending();
                if (need > 0 && bus.getDebugLevel() >= 1) {
                    console.warn(`[fleets] bulk spawn short: need ${need} more (galaxy empty?)`);
                }
            }
        };
        pump();
    };
    whenPubSubReady(bus, () => {
        if (bus.getDebugLevel() >= 1) {
            console.log("📢 Fleets worker setting up pub/sub subscriptions");
        }
        subscribeGalaxyMirror(bus, {
            onOps: handleOps,
            onClearGalaxy: handleClearGalaxy,
        });
        subscribeTopic(bus, Topics.generateFleet, (payload) => {
            const at = payload?.at;
            if (at && Number.isFinite(at.clusterId) && Number.isFinite(at.solarSystemId)) {
                spawnParkedAt(world, { clusterId: at.clusterId, solarSystemId: at.solarSystemId }, publishSpawned);
                return;
            }
            // Single fleet: one fleet_spawned with jumping state.
            spawnFleet(world, Date.now(), publishSpawned);
        });
        subscribeTopic(bus, Topics.generateFleetsBulk, (payload) => {
            // Galaxy-wide only. Ignoring payload.at — parking N fleets in one jewel
            // floods NEAR triangles (Generate 1K while SCENE is open).
            startBulkSpawn(payload?.count ?? 0);
        });
        ensureTicking();
    });
    bus.send("worker_ready", { role: "fleets" });
    return {
        destroy: () => {
            bulkGen++;
            if (tickHandle != null) {
                clearInterval(tickHandle);
                tickHandle = null;
            }
            clearFleetWorld(world);
        },
    };
}
//# sourceMappingURL=fleets-worker.js.map