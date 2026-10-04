import { applyFleetOps, clearFleetWorld, createFleetWorld, removeInvalidFleets, } from "../../lib/fleet-sim/domain/fleet-world.js";
import { tickFleets } from "../../lib/fleet-sim/domain/fleet-simulation.js";
import { trySpawnFleet, trySpawnParkedAt } from "../../lib/fleet-sim/domain/fleet-spawner.js";
import { createBulkFleetSpawner } from "./bulk-spawn.js";
import { createAuthoredFleet } from "./create-fleet.js";
import { acceptLocalMove } from "./local-move.js";
import { createFleetStateBatch } from "./state-batch.js";
/** One authority for fleet state. Renderers receive events, never mutable world maps. */
export function createFleetRuntime(ports) {
    const world = createFleetWorld();
    const held = new Map();
    let disposed = false;
    const events = ports.events;
    const transitions = createFleetStateBatch(events);
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
        held.clear();
        clearFleetWorld(world);
    };
    const generate = (payload) => {
        if (disposed)
            return;
        if (payload?.classes != null) {
            const fleet = createAuthoredFleet(world, payload);
            if (fleet)
                events.onFleetSpawned({ id: fleet.id, counts: fleet.counts, state: fleet.state, relationship: fleet.relationship });
            return;
        }
        const at = payload?.at;
        const hasNode = at && Number.isFinite(at.clusterId) && Number.isFinite(at.solarSystemId);
        const fleet = hasNode
            ? trySpawnParkedAt(world, { clusterId: at.clusterId, solarSystemId: at.solarSystemId }, ports.random)
            : trySpawnFleet(world, ports.now(), ports.random);
        if (!fleet)
            return;
        events.onFleetSpawned({ id: fleet.id, counts: fleet.counts, state: fleet.state, relationship: fleet.relationship });
    };
    const battlePort = {
        member(id) {
            const f = world.fleets.get(id);
            if (!f)
                return null;
            return { node: f.currentNode, jumping: f.state.state === 'jumping',
                battle: f.state.state === 'awaiting' ? f.state.battle?.id ?? null : null };
        },
        order(id, order) {
            const f = world.fleets.get(id);
            if (!f)
                return;
            if (!held.has(id))
                held.set(id, { state: f.state, at: ports.now() });
            const localMove = { revision: order.stage === 'pursuit' ? order.revision : 1,
                orderId: -order.id * 2 - Number(order.stage === 'engaged'), destination: { ...order.center } };
            f.state = { state: 'awaiting', node: f.currentNode, battle: order, localMove };
            publishState(f);
        },
        release(id, battle) {
            const f = world.fleets.get(id), old = held.get(id);
            if (f?.state.state !== 'awaiting' || f.state.battle?.id !== battle)
                return;
            held.delete(id);
            f.state = old?.state ?? { state: 'awaiting', node: f.currentNode };
            if (f.state.state === 'cooldown')
                f.state = { ...f.state, startTime: f.state.startTime + ports.now() - old.at };
            publishState(f);
        },
    };
    return {
        battlePort,
        applyOps: (ops) => {
            if (disposed)
                return;
            applyFleetOps(world, ops);
            for (const id of removeInvalidFleets(world)) {
                held.delete(id);
                publishRemoved(id);
            }
        },
        clear,
        generate,
        moveLocal: (payload) => {
            if (disposed)
                return;
            const fleet = acceptLocalMove(world, payload);
            if (fleet)
                publishState(fleet);
        },
        generateBulk: (payload) => {
            if (disposed)
                return;
            // Bulk has always been galaxy-wide, including when a Kepler scene is open.
            bulk.start(payload?.count ?? 0);
        },
        tick: () => {
            if (disposed)
                return;
            try {
                tickFleets(world, ports.now(), transitions.state, transitions.removed, ports.random);
            }
            finally {
                transitions.flush();
            }
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