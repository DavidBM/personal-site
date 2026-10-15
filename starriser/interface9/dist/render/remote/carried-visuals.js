import { sameHullAppearance } from '../../contracts/hull-appearance.js';
/**
 * Live fleet visuals carried across a same-scope projection refresh (a native
 * turn's or a starting battle's system snapshot replays every fleet). A visual
 * whose allocated appearance still matches, or that a battle protects, is
 * reused by the replay, so the ships the player sees are never rebuilt; the
 * rest are released once the replay commits. Only `carrying` hand-offs are
 * accepted, so ordinary removals keep their usual release path.
 */
export function createCarriedVisuals(release, protects) {
    const carried = new Map();
    let carrying = false;
    return {
        /** Accept hand-offs only while `run` executes (the old adapter's disposal). */
        during(run) { carrying = true; try {
            run();
        }
        finally {
            carrying = false;
        } },
        carry(id, visual, appearance) {
            if (!carrying)
                return false;
            carried.set(id, { visual, appearance });
            return true;
        },
        take(id, appearance) {
            const row = carried.get(id);
            if (!row)
                return;
            carried.delete(id);
            if (protects(id) || sameHullAppearance(row.appearance, appearance))
                return row.visual;
            release(row.visual);
            return;
        },
        releaseAll() { for (const row of carried.values())
            release(row.visual); carried.clear(); },
        get size() { return carried.size; },
    };
}
//# sourceMappingURL=carried-visuals.js.map