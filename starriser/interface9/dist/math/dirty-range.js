/**
 * Backend-agnostic dirty-range tracking for partial GPU buffer uploads.
 * Offsets/counts are in **array elements** (e.g. floats), not vertices.
 *
 * Maps to a single contiguous GPU upload span (union of dirty writes in a frame).
 */
export const DIRTY_CLEAN = { kind: "clean" };
export const DIRTY_FULL = { kind: "full" };
/** Replace state with a single partial span (or clean if count ≤ 0). */
export function markDirtyRange(_prev, floatOffset, floatCount) {
    if (floatCount <= 0)
        return DIRTY_CLEAN;
    return { kind: "partial", start: floatOffset, count: floatCount };
}
/**
 * Expand pending dirty span to the union with
 * `[floatOffset, floatOffset + floatCount)`.
 *
 * - clean → partial of the new span
 * - full → stays full (whole buffer must upload)
 * - partial → union of intervals
 */
export function expandDirtyRange(prev, floatOffset, floatCount) {
    if (floatCount <= 0)
        return prev;
    if (prev.kind === "full")
        return DIRTY_FULL;
    if (prev.kind === "clean") {
        return { kind: "partial", start: floatOffset, count: floatCount };
    }
    const end = floatOffset + floatCount;
    const prevEnd = prev.start + prev.count;
    const start = Math.min(prev.start, floatOffset);
    const newEnd = Math.max(prevEnd, end);
    return { kind: "partial", start, count: newEnd - start };
}
export function markDirtyFull(_prev) {
    return DIRTY_FULL;
}
export function clearDirty(_prev) {
    return DIRTY_CLEAN;
}
//# sourceMappingURL=dirty-range.js.map