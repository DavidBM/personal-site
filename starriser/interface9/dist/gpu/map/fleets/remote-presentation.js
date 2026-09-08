import { FLEET_FLAG_ALIVE, FLEET_GPU_STRIDE, FleetGpuFields } from '../../fleet-layout.js';
import { initializeRemoteShipPose, setRemoteFleetAlive, writeRemoteFleetPath } from './remote-path.js';
/** Hidden slots use the same allocator/buffers as live fleets. They are absent
 * from model selection until publication; ALIVE=0 also hides compute proxies. */
export function createRemoteFleetSlots(fleets, onFollowRetired) {
    function retireFollow(visual) {
        const index = fleets.follow.followShipIndex;
        if (index == null || index < visual.instanceStart || index >= visual.instanceStart + visual.instanceCapacity)
            return;
        fleets.follow.resetTracking();
        onFollowRetired?.();
    }
    function hide(visual) {
        retireFollow(visual);
        setRemoteFleetAlive(fleets.storage, visual, false);
        fleets.records.delete(visual.id);
        fleets.warmingFleetIds.delete(visual.id);
    }
    function release(visual) {
        retireFollow(visual);
        // A hidden slot remains allocated until retirement; no reuse can alias it.
        fleets.records.set(visual.id, visual);
        fleets.removeFleet(visual.id);
    }
    function retirePrevious(previous, flags) {
        let matched = 0;
        for (const visual of previous.values()) {
            retireFollow(visual);
            flags[visual.fleetSlot * (FLEET_GPU_STRIDE / 4) + FleetGpuFields.flags / 4] &= ~FLEET_FLAG_ALIVE;
            if (fleets.records.get(visual.id) === visual)
                matched++;
        }
        return matched === fleets.records.size;
    }
    function publishMixed(previous, next) {
        for (const visual of previous.values()) {
            if (fleets.records.get(visual.id) !== visual)
                continue;
            fleets.records.delete(visual.id);
            fleets.warmingFleetIds.delete(visual.id);
        }
        for (const visual of next.records.values())
            fleets.records.set(visual.id, visual);
        for (const id of next.warmingFleetIds)
            fleets.warmingFleetIds.add(id);
    }
    return {
        create(id, path) {
            fleets.addFleet(id, { red: 1, blue: 0, green: 0 }, { state: 'awaiting', node: path.node }, path);
            const visual = fleets.records.get(id);
            if (!visual)
                throw new Error('Remote fleet capacity exhausted');
            hide(visual);
            return visual;
        },
        prepare(visual) {
            writeRemoteFleetPath(fleets.storage, visual, fleets.scene.fleetLocMatchesKepler(visual.state), fleets.positionLookup, fleets.timeline.elapsedMs);
            initializeRemoteShipPose(fleets.storage, visual, fleets.timeline.elapsedMs);
            setRemoteFleetAlive(fleets.storage, visual, false);
        },
        preparePublication(previous, next) {
            const ranges = snapshotRanges(previous, next);
            const index = { records: new Map(), warmingFleetIds: new Set() };
            return {
                // The adapter calls this inside bounded hidden-pose preparation, not
                // immediately outside the measured publication closure.
                stage(visual) {
                    index.records.set(visual.id, visual);
                    if (visual.warmFramesLeft > 0)
                        index.warmingFleetIds.add(visual.id);
                    else
                        index.warmingFleetIds.delete(visual.id);
                },
                publish() {
                    if (index.records.size !== next.size)
                        throw new Error('Remote publication index is incomplete');
                    const flags = new Uint32Array(fleets.storage.fleetGpuBytes);
                    const exclusive = retirePrevious(previous, flags);
                    for (const visual of next.values()) {
                        flags[visual.fleetSlot * (FLEET_GPU_STRIDE / 4) + FleetGpuFields.flags / 4] |= FLEET_FLAG_ALIVE;
                    }
                    if (exclusive)
                        fleets.publishVisibleIndex(index);
                    else
                        publishMixed(previous, index);
                    for (const range of ranges)
                        fleets.layer.uploadFleetGpuRange(fleets.storage.fleetGpuU8, range.start, range.count);
                },
            };
        },
        publish(visual) {
            setRemoteFleetAlive(fleets.storage, visual, true);
            fleets.records.set(visual.id, visual);
            if (visual.warmFramesLeft > 0)
                fleets.warmingFleetIds.add(visual.id);
        },
        update(visual, path) {
            visual.remote = path;
            writeRemoteFleetPath(fleets.storage, visual, fleets.scene.fleetLocMatchesKepler(visual.state), fleets.positionLookup, fleets.timeline.elapsedMs);
        },
        hide, release,
        spaceRevision: () => fleets.scene.revision,
        flush: () => fleets.upload.flushFleetGpuDirt(),
        unavailable: fleets.isUnavailable,
        read: (visual) => fleets.readFleetGpuSlot(visual.id),
    };
}
/** Snapshot ranges are known before publication. Prepare their coalescing off
 * the commit path; sparse delta updates retain ordinary dirty-range uploads. */
function snapshotRanges(previous, next) {
    const slots = [];
    for (const visual of previous.values())
        slots.push(visual.fleetSlot);
    for (const visual of next.values())
        slots.push(visual.fleetSlot);
    slots.sort((a, b) => a - b);
    const ranges = [];
    for (const slot of slots) {
        const last = ranges[ranges.length - 1];
        if (last && slot === last.start + last.count)
            last.count++;
        else
            ranges.push({ start: slot, count: 1 });
    }
    return ranges;
}
//# sourceMappingURL=remote-presentation.js.map