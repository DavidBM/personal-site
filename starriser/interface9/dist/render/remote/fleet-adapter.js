import { runBounded } from './bounded-work.js';
/** One direct stream owns its active, staged and retired slot identities. Packing
 * is sliced; publication changes visibility in one task before the next frame. */
export function createRemoteFleetAdapter(slots, map, prefix) {
    let active = new Map();
    let moving = new Set();
    const owned = new Set();
    const lifetime = new AbortController();
    let serial = 0;
    let retired = Promise.resolve();
    let closed = false;
    let lastCommitMs = 0;
    function create(ship) {
        if (closed || slots.unavailable())
            throw new Error('Remote renderer unavailable');
        const visual = slots.create(`${prefix}:${++serial}:${ship.id}`, map(ship));
        owned.add(visual);
        return visual;
    }
    function release(visual) { slots.release(visual); owned.delete(visual); }
    function retire(values) {
        retired = runBounded(values, release, lifetime.signal, slots.flush).then(() => { if (!closed)
            slots.flush(); });
        // Disposal cancels retirement and synchronously releases remaining ownership.
        void retired.catch(() => { });
    }
    async function prepare(values, signal, stage) {
        let revision;
        do {
            revision = slots.spaceRevision();
            await runBounded(values.values(), visual => { slots.prepare(visual); stage?.(visual); }, signal, slots.flush);
        } while (revision !== slots.spaceRevision());
        // Upload hidden poses before the small publication task. A frame between
        // these writes and publication still sees only the previous ALIVE set.
        slots.flush();
    }
    function commit(next, publish) {
        const started = performance.now();
        const previous = active;
        publish();
        active = next;
        lastCommitMs = performance.now() - started;
        retire(previous.values());
    }
    return {
        async replace(ships, signal) {
            const alive = AbortSignal.any([signal, lifetime.signal]);
            await retired;
            const staged = new Map(), stagedMoving = new Set();
            try {
                await runBounded(ships.values(), ship => { staged.set(ship.id, create(ship)); if (ship.moving)
                    stagedMoving.add(ship.id); }, alive, slots.flush);
                const publication = slots.preparePublication(active, staged);
                await prepare(staged, alive, publication.stage);
                alive.throwIfAborted();
                commit(staged, publication.publish);
                moving = stagedMoving;
            }
            catch (error) {
                for (const visual of staged.values()) {
                    if (owned.has(visual))
                        release(visual);
                }
                throw error;
            }
        },
        async apply(change, signal) {
            const alive = AbortSignal.any([signal, lifetime.signal]);
            await retired;
            const additions = new Map();
            try {
                await runBounded(change.upserts, ship => { if (!active.has(ship.id))
                    additions.set(ship.id, create(ship)); }, alive);
                await prepare(additions, alive);
                alive.throwIfAborted();
                const removed = remove(change.removed);
                for (const ship of change.upserts)
                    update(ship, additions);
                slots.flush();
                retire(removed);
            }
            catch (error) {
                for (const [id, visual] of additions) {
                    if (!active.has(id) && owned.has(visual))
                        release(visual);
                }
                throw error;
            }
        },
        async retime(lookup, signal) {
            const alive = AbortSignal.any([signal, lifetime.signal]);
            await retired;
            await runBounded(moving, id => {
                const ship = lookup(id);
                if (ship?.moving)
                    slots.update(active.get(id), map(ship));
            }, alive, slots.flush);
        },
        visual: (id) => active.get(id),
        entries: () => active.entries(),
        inspect: () => ({ active: active.size, allocated: owned.size, lastCommitMs }),
        dispose() {
            if (closed)
                return;
            closed = true;
            lifetime.abort();
            for (const visual of owned)
                release(visual);
            active.clear();
            moving.clear();
        },
    };
    function remove(ids) {
        const removed = [];
        for (const id of ids) {
            const visual = active.get(id);
            if (!visual)
                continue;
            slots.hide(visual);
            active.delete(id);
            moving.delete(id);
            removed.push(visual);
        }
        return removed;
    }
    function update(ship, additions) {
        if (ship.moving)
            moving.add(ship.id);
        else
            moving.delete(ship.id);
        const existing = active.get(ship.id);
        if (existing)
            slots.update(existing, map(ship));
        else {
            const visual = additions.get(ship.id);
            slots.publish(visual);
            active.set(ship.id, visual);
        }
    }
}
//# sourceMappingURL=fleet-adapter.js.map