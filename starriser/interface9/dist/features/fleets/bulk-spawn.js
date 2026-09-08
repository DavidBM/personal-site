import { trySpawnFleet } from "../../lib/fleet-sim/domain/fleet-spawner.js";
import { createFleetRoutePlanner } from '../../lib/fleet-sim/domain/fleet-route-planner.js';
/** Keep pathfinding off the main thread and structured-clone messages small. */
export const BULK_WORK_CHUNK = 800;
export const BULK_OUT_BATCH = 128;
export function normalizeFleetBulkCount(count) {
    if (!Number.isFinite(count))
        return 0;
    return Math.max(0, Math.min(Math.trunc(count), 100000));
}
export function createBulkFleetSpawner(world, ports) {
    let generation = 0;
    let cancelPending = null;
    const cancel = () => {
        generation++;
        cancelPending?.();
        cancelPending = null;
    };
    const start = (count) => {
        const n = normalizeFleetBulkCount(count);
        if (n === 0)
            return;
        cancel();
        const gen = generation;
        let need = n;
        let attemptsLeft = Math.max(n * 4, n + 64);
        let pending = [];
        const flush = () => {
            if (pending.length === 0)
                return;
            // Hand ownership to the publisher; never mutate a delivered batch.
            const fleets = pending;
            pending = [];
            ports.onBatch({ fleets });
        };
        const runChunk = () => {
            // Reuse only until a publication callback or yield can mutate the world.
            let planner;
            const now = ports.now();
            let work = 0;
            while (gen === generation && need > 0 && attemptsLeft > 0 && work < BULK_WORK_CHUNK) {
                attemptsLeft--;
                work++;
                planner ?? (planner = createFleetRoutePlanner(world));
                const fleet = trySpawnFleet(world, now, ports.random, planner);
                if (!fleet)
                    continue;
                need--;
                pending.push({ id: fleet.id, counts: fleet.counts, state: fleet.state });
                if (pending.length >= BULK_OUT_BATCH) {
                    flush();
                    planner = undefined;
                }
            }
            // Cancellation can arrive at the next yield: every accepted spawn must
            // already be published, including the last partial batch in this chunk.
            flush();
        };
        const pump = () => {
            if (gen !== generation)
                return;
            cancelPending = null;
            runChunk();
            if (gen !== generation)
                return;
            if (need > 0 && attemptsLeft > 0) {
                cancelPending = ports.defer(pump);
            }
            else if (need > 0) {
                ports.onShortfall?.(need);
            }
        };
        pump();
    };
    return { start, cancel };
}
//# sourceMappingURL=bulk-spawn.js.map