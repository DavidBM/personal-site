/**
 * One INDIRECT|STORAGE command table (Year-1 slice B).
 *
 * Grows the existing `trailIndirect` buffer — **not** a second INDIRECT buffer
 * and **not** an 8th storage slot on `cs_ships`. Binding 6 is an offset view
 * of this table starting at {@link TRAIL_INDIRECT_META_BYTE} (256-aligned so
 * it does not overlap DispatchIndirectArgs). Binding 7 is not on `cs_ships`.
 *
 * Word layout (u32):
 *
 * | Word | Byte | Contents |
 * |------|------|----------|
 * | 0–4  | 0    | DrawIndexedIndirectArgs (trails) |
 * | 5–7  | 20   | DispatchIndirectArgs for `cs_ships` (`x, 1, 1`) |
 * | 8–63 | 32   | pad to `minStorageBufferOffsetAlignment` (256) |
 * | 64   | 256  | atomic expand count (binding-6 view [0]) |
 * | 65   | 260  | max line slots (binding-6 view [1]) |
 * | 66   | 264  | compactCount (binding-6 view [2]) |
 * | 67   | 268  | compactCapacity (binding-6 view [3]) |
 * | 68+  | 272  | worklist[simIdx] (binding-6 view [4+]) |
 *
 * Binding 6 (cs_ships / compact / trail_indirect meta) starts at byte 256 so
 * `dispatchWorkgroupsIndirect(table, 20)` does not alias storage in the same
 * compute pass.
 */
export const TRAIL_INDIRECT_WORD = {
    DRAW_INDEX_COUNT: 0,
    DRAW_INSTANCE_COUNT: 1,
    DRAW_FIRST_INDEX: 2,
    DRAW_BASE_VERTEX: 3,
    DRAW_FIRST_INSTANCE: 4,
    DISPATCH_X: 5,
    DISPATCH_Y: 6,
    DISPATCH_Z: 7,
};
/** Binding-6 view (offset 256) word indices. */
export const TRAIL_META_WORD = {
    EXPAND_COUNT: 0,
    MAX_LINE_SLOTS: 1,
    COMPACT_COUNT: 2,
    COMPACT_CAPACITY: 3,
    WORKLIST: 4,
};
/** Byte offset of DispatchIndirectArgs (words 5–7). */
export const TRAIL_INDIRECT_DISPATCH_BYTE = TRAIL_INDIRECT_WORD.DISPATCH_X * 4;
/**
 * 256-byte `minStorageBufferOffsetAlignment` for the meta/worklist storage view.
 * Absolute table word of expand count = 64.
 */
export const TRAIL_INDIRECT_META_BYTE = 256;
/** Binding-6 view: worklist starts at this byte (256 + 16). */
export const TRAIL_INDIRECT_WORKLIST_BYTE = TRAIL_INDIRECT_META_BYTE + TRAIL_META_WORD.WORKLIST * 4;
/** Header through compactCapacity (4 u32s at the 256 view). */
export const TRAIL_INDIRECT_HEADER_BYTES = TRAIL_INDIRECT_META_BYTE + TRAIL_META_WORD.WORKLIST * 4;
/** Table byte length for a worklist of `worklistCap` simIdx slots. */
export function trailIndirectTableBytes(worklistCap) {
    const n = Math.max(0, worklistCap | 0);
    return TRAIL_INDIRECT_HEADER_BYTES + n * 4;
}
/**
 * Write `DispatchIndirectArgs` (`x, 1, 1`) into a 3-word dest.
 * Host writes this at {@link TRAIL_INDIRECT_DISPATCH_BYTE} — no hot-path mapAsync.
 */
export function writeDispatchIndirectArgs(dest, groupsX) {
    dest[0] = groupsX >>> 0;
    dest[1] = 1;
    dest[2] = 1;
}
//# sourceMappingURL=trail-indirect-table.js.map