/** Approved visual assets, independent of ship role or combat statistics. */
export const HULL_ASSET_KEYS = Object.freeze([
    'aster-vale/interceptor', 'aster-vale/fighter', 'aster-vale/bomber',
    'aster-vale/frigate', 'aster-vale/battleship', 'aster-vale/colossus',
]);
export const HULL_APPEARANCE_STRIDE = 7;
export const MAX_FLEET_MEMBERS = 1000000;
export const LEGACY_HULL_APPEARANCE = Object.freeze({ totalShips: 0, hullCounts: Object.freeze([0, 0, 0, 0, 0, 0]), placeholder: true });
export function hullClass(assetKey, version) {
    if (version !== 1)
        return;
    const index = HULL_ASSET_KEYS.indexOf(assetKey);
    return index < 0 ? undefined : index;
}
/** Own the six values before transferred buffers are returned to their sender. */
export function readHullAppearance(columns, offset) {
    const totalShips = columns[offset], hullCounts = Array.from(columns.subarray(offset + 1, offset + 7));
    if (hullCounts.length !== 6 || totalShips > MAX_FLEET_MEMBERS)
        throw new Error('Invalid projection appearance');
    const represented = hullCounts.reduce((a, b) => a + b, 0);
    if (represented > totalShips)
        throw new Error('Invalid projection hull count');
    return { totalShips, hullCounts, placeholder: totalShips === 0 || represented !== totalShips };
}
export function sameHullAppearance(a, b) {
    a ?? (a = LEGACY_HULL_APPEARANCE);
    b ?? (b = LEGACY_HULL_APPEARANCE);
    return a.totalShips === b.totalShips && a.placeholder === b.placeholder && a.hullCounts.every((count, index) => count === b.hullCounts[index]);
}
//# sourceMappingURL=hull-appearance.js.map