/**
 * Fleet status map + list render. Owns bookkeeping; GPU/mesh via injected callbacks.
 *
 * Bulk apply is **rAF-budgeted**: Bus handlers only enqueue small batches so the
 * main thread never burns a 64ms Bus drain packing 10k×48 ships in one turn.
 * Target: keep frames ≤8ms (120 FPS) while bulk still finishes in a few seconds.
 */
/**
 * Main-thread pack budget during bulk (ms / rAF).
 * Plan non-goal: perfect 120 FPS *during* add — keep under multi-frame freezes
 * (Bus 64ms). 10k fleets @ ~0.2–0.5ms pack needs high max/frame for &lt;2s wall.
 */
const APPLY_BUDGET_MS = 8;
/** Soft cap fleets applied per frame even if budget remains. */
const APPLY_MAX_PER_FRAME = 256;
/**
 * Create a controller that mirrors fleet lifecycle topics into a status map
 * and the fleet visual renderer.
 *
 * List UI is **rAF-coalesced**. Bulk spawn packs under a per-frame budget so
 * FPS is not interrupted (Bus handlers stay ≪1ms).
 */
export function createFleetStatusController(options) {
    const byId = new Map();
    const { renderer, onListChanged, onApplied } = options;
    let listRaf = 0;
    let applyRaf = 0;
    const pending = [];
    function renderList() {
        onListChanged(byId);
    }
    function scheduleList() {
        if (listRaf !== 0)
            return;
        listRaf = requestAnimationFrame(() => {
            listRaf = 0;
            onListChanged(byId);
        });
    }
    function applyOne(f) {
        byId.set(f.id, { counts: f.counts, state: f.state });
        renderer.addFleet(f.id, f.counts, f.state);
    }
    function drainApply() {
        applyRaf = 0;
        if (pending.length === 0)
            return;
        const t0 = performance.now();
        let n = 0;
        while (pending.length > 0 &&
            n < APPLY_MAX_PER_FRAME &&
            performance.now() - t0 < APPLY_BUDGET_MS) {
            const f = pending.shift();
            applyOne(f);
            n++;
        }
        if (n > 0) {
            onApplied?.(n);
            scheduleList();
        }
        if (pending.length > 0) {
            applyRaf = requestAnimationFrame(drainApply);
        }
    }
    function scheduleApply() {
        if (applyRaf !== 0)
            return;
        applyRaf = requestAnimationFrame(drainApply);
    }
    return {
        byId,
        handleSpawned(id, counts, state) {
            // Single spawn: apply immediately (interactive path).
            applyOne({ id, counts, state });
            onApplied?.(1);
            scheduleList();
        },
        handleSpawnedBatch(fleets) {
            for (let i = 0; i < fleets.length; i++) {
                pending.push(fleets[i]);
            }
            scheduleApply();
        },
        handleState(id, state) {
            const existing = byId.get(id);
            if (existing) {
                existing.state = state;
            }
            // If still pending apply, patch the queued record so first pack is final.
            for (let i = 0; i < pending.length; i++) {
                if (pending[i].id === id) {
                    pending[i] = { ...pending[i], state };
                    return;
                }
            }
            renderer.updateFleetState(id, state);
            scheduleList();
        },
        handleRemoved(id) {
            byId.delete(id);
            for (let i = pending.length - 1; i >= 0; i--) {
                if (pending[i].id === id)
                    pending.splice(i, 1);
            }
            renderer.removeFleet(id);
            scheduleList();
        },
        clear() {
            byId.clear();
            pending.length = 0;
            if (listRaf !== 0) {
                cancelAnimationFrame(listRaf);
                listRaf = 0;
            }
            if (applyRaf !== 0) {
                cancelAnimationFrame(applyRaf);
                applyRaf = 0;
            }
            onListChanged(byId);
        },
        renderList,
        getPendingApplyCount() {
            return pending.length;
        },
    };
}
//# sourceMappingURL=fleet-status-controller.js.map