import { sameHullAppearance } from '../../contracts/hull-appearance.js';
import { runBounded } from './bounded-work.js';
/** One direct stream owns its active, staged and retired slot identities. Packing
 * is sliced; publication changes visibility in one task before the next frame. */
/** `handoff` and `restore` move live visuals between owners without rebuilding
 * them; both see the appearance the visual's ships were allocated for. */
export function createRemoteFleetAdapter(slots, map, prefix, handoff, restore, protects) {
    let active = new Map();
    const owned = new Set();
    const allocatedAppearance = new WeakMap();
    const lifetime = new AbortController();
    let serial = 0;
    let retired = Promise.resolve();
    let closed = false;
    let lastCommitMs = 0;
    function create(fleet) {
        if (closed || slots.unavailable())
            throw new Error('Remote renderer unavailable');
        const path = map(fleet);
        const restored = restore?.(fleet.id, path.appearance);
        const visual = restored ?? slots.create(`${prefix}:${++serial}:${fleet.id}`, path);
        if (restored) {
            visual.state = { state: 'awaiting', node: path.node };
            slots.update(visual, path);
        }
        allocatedAppearance.set(visual, path.appearance);
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
        async replace(fleets, signal) {
            const alive = AbortSignal.any([signal, lifetime.signal]);
            await retired;
            const staged = new Map();
            try {
                await runBounded(fleets.values(), fleet => { staged.set(fleet.id, create(fleet)); }, alive, slots.flush);
                const publication = slots.preparePublication(active, staged);
                await prepare(staged, alive, publication.stage);
                alive.throwIfAborted();
                commit(staged, publication.publish);
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
                await runBounded(change.upserts, fleet => {
                    const previous = active.get(fleet.id);
                    if (!previous || (!protects?.(fleet.id) && !sameHullAppearance(allocatedAppearance.get(previous), map(fleet).appearance)))
                        additions.set(fleet.id, create(fleet));
                }, alive);
                await prepare(additions, alive);
                alive.throwIfAborted();
                const removed = remove(change.removed);
                for (const fleet of change.upserts)
                    update(fleet, additions, removed);
                slots.flush();
                retire(removed);
            }
            catch (error) {
                for (const [id, visual] of additions) {
                    if (active.get(id) !== visual && owned.has(visual))
                        release(visual);
                }
                throw error;
            }
        },
        /** The ships these fleets' visuals already show stand for their current
         * appearance (a finished battle's survivors), so the next update keeps them. */
        adopt(fleets) {
            for (const fleet of fleets) {
                const visual = active.get(fleet.id);
                if (visual)
                    allocatedAppearance.set(visual, map(fleet).appearance);
            }
        },
        visual: (id) => active.get(id),
        entries: () => active.entries(),
        inspect: () => ({ active: active.size, allocated: owned.size, lastCommitMs }),
        dispose(preserveJourney = false) {
            if (closed)
                return;
            closed = true;
            lifetime.abort();
            if (preserveJourney) {
                for (const [id, visual] of active)
                    if (handoff?.(id, visual, allocatedAppearance.get(visual)))
                        owned.delete(visual);
            }
            for (const visual of owned)
                release(visual);
            active.clear();
        },
    };
    function remove(ids) {
        const removed = [];
        for (const id of ids) {
            const visual = active.get(id);
            if (!visual)
                continue;
            active.delete(id);
            if (handoff?.(id, visual, allocatedAppearance.get(visual))) {
                owned.delete(visual);
                continue;
            }
            slots.hide(visual);
            removed.push(visual);
        }
        return removed;
    }
    function update(fleet, additions, retiredVisuals) {
        const existing = active.get(fleet.id);
        const visual = additions.get(fleet.id);
        if (visual) {
            if (existing) {
                slots.hide(existing);
                retiredVisuals.push(existing);
            }
            slots.publish(visual);
            active.set(fleet.id, visual);
        }
        else if (existing)
            slots.update(existing, map(fleet));
    }
}
//# sourceMappingURL=fleet-adapter.js.map