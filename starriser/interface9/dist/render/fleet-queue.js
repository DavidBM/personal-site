const monotonicNow = () => performance.now();
export function createRenderFleetQueue(apply) {
    let queue = [];
    let head = 0;
    const pending = new Map();
    return {
        enqueue(fleets) {
            for (const fleet of fleets) {
                pending.set(fleet.id, fleet);
                queue.push(fleet);
            }
        },
        update(id, state) {
            const fleet = pending.get(id);
            if (!fleet)
                return false;
            fleet.state = state;
            return true;
        },
        remove(id) { pending.delete(id); },
        clear() { queue = []; head = 0; pending.clear(); },
        size() { return pending.size; },
        /** Stops at either budget; stale entries do not count as applied fleets. */
        drain(budgetMs, maxFleets = Infinity, now = monotonicNow) {
            const start = now();
            let count = 0;
            while (head < queue.length && count < maxFleets && now() - start < budgetMs) {
                const fleet = queue[head++];
                if (pending.get(fleet.id) !== fleet)
                    continue;
                pending.delete(fleet.id);
                apply(fleet);
                count++;
            }
            if (head === queue.length) {
                queue = [];
                head = 0;
            }
            return count;
        },
    };
}
//# sourceMappingURL=fleet-queue.js.map