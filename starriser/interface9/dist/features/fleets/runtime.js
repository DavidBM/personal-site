import { applyFleetOps, clearFleetWorld, createFleetWorld, removeInvalidFleets, } from "../../lib/fleet-sim/domain/fleet-world.js";
import { tickFleets } from "../../lib/fleet-sim/domain/fleet-simulation.js";
import { trySpawnFleet, trySpawnParkedAt } from "../../lib/fleet-sim/domain/fleet-spawner.js";
import { createBulkFleetSpawner } from "./bulk-spawn.js";
/** One authority for fleet state. Renderers receive events, never mutable world maps. */
export function createFleetRuntime(ports) {
    const world = createFleetWorld();
    let disposed = false;
    const events = ports.events;
    const publishState = (fleet) => {
        events.onFleetState({ id: fleet.id, state: fleet.state });
    };
    const publishRemoved = (id) => { events.onFleetRemoved({ id }); };
    const bulk = createBulkFleetSpawner(world, {
        now: ports.now,
        random: ports.random,
        defer: ports.defer,
        onBatch: (payload) => events.onFleetsSpawnedBatch(payload),
        onShortfall: ports.onBulkShortfall,
    });
    const clear = () => {
        bulk.cancel();
        clearFleetWorld(world);
    };
    const generate = (payload) => {
        if (disposed)
            return;
        const at = payload?.at;
        const hasNode = at && Number.isFinite(at.clusterId) && Number.isFinite(at.solarSystemId);
        const fleet = hasNode
            ? trySpawnParkedAt(world, { clusterId: at.clusterId, solarSystemId: at.solarSystemId }, ports.random)
            : trySpawnFleet(world, ports.now(), ports.random);
        if (!fleet)
            return;
        events.onFleetSpawned({ id: fleet.id, counts: fleet.counts, state: fleet.state });
    };
    return {
        applyOps: (ops) => {
            if (disposed)
                return;
            applyFleetOps(world, ops);
            for (const id of removeInvalidFleets(world))
                publishRemoved(id);
        },
        clear,
        generate,
        generateBulk: (payload) => {
            if (disposed)
                return;
            // Bulk has always been galaxy-wide, including when a Kepler scene is open.
            bulk.start(payload?.count ?? 0);
        },
        tick: () => {
            if (disposed)
                return;
            tickFleets(world, ports.now(), publishState, publishRemoved, ports.random);
        },
        fleetCount: () => world.fleets.size,
        dispose: () => {
            if (disposed)
                return;
            disposed = true;
            clear();
        },
    };
}
//# sourceMappingURL=runtime.js.map