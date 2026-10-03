import { copySceneFleetRow } from './scene-fleet-row.js';
import { allocateSceneVisuals } from './directed-present.wgsl.js';
const requests = new WeakMap();
/** Renderer-owned metadata cache. Time/intent refresh every frame; stable
 * membership does not reallocate/sort occupancy maps or alter admitted counts.
 * The allocator, not this cache, decides retention on a cap/request change. */
export function refreshSceneVisualAllocation(fleets, previous, cap) {
    const counts = previous && requests.get(previous);
    const unchanged = previous?.cap === cap && previous.fleets.length === fleets.length && counts
        && fleets.every((fleet, index) => fleet.id === previous.fleets[index].id
            && fleet.retainedCount === previous.fleets[index].retainedCount
            && fleet.slot === previous.fleets[index].slot && fleet.shipCount === counts[index]);
    if (!previous || !unchanged) {
        const allocation = allocateSceneVisuals(fleets, { previous, cap });
        requests.set(allocation, fleets.map(fleet => fleet.shipCount));
        return allocation;
    }
    for (let i = 0; i < fleets.length; i++) {
        const row = previous.fleets[i], count = row.shipCount;
        copySceneFleetRow(fleets[i], row);
        row.shipCount = count;
    }
    return previous;
}
//# sourceMappingURL=scene-visual-allocation.js.map