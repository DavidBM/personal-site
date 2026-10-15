import { hullClass, MAX_FLEET_MEMBERS } from '../contracts/hull-appearance.js';
/** Seven u32 values: logical total followed by approved asset counts. Unknown
 * assets remain unrepresented; the renderer uses an explicit fixed placeholder. */
export function packFleetAppearance(target, offset, value, appearance) {
    if (appearance) {
        validateFleetAppearance(appearance);
        target[offset] = appearance.totalShips;
        target.set(appearance.hullCounts, offset + 1);
        return;
    }
    if (!value)
        return;
    if (!value.groups.length || value.groups.length > 16)
        throw new Error('Invalid fleet appearance groups');
    let total = 0;
    for (const group of value.groups) {
        validateCount(group.count);
        total += group.count;
        const hull = group.design?.hull, index = hull && hullClass(hull.assetKey, hull.version);
        if (index !== undefined)
            target[offset + 1 + index] += group.count;
    }
    if (total > MAX_FLEET_MEMBERS)
        throw new Error('Fleet appearance budget exceeded');
    target[offset] = total;
}
export function validateFleetAppearance(value) {
    validateCount(value.totalShips);
    if (value.hullCounts.length !== 6)
        throw new Error('Invalid fleet appearance hulls');
    let represented = 0;
    for (const count of value.hullCounts) {
        if (!Number.isInteger(count) || count < 0 || count > MAX_FLEET_MEMBERS)
            throw new Error('Invalid fleet appearance count');
        represented += count;
    }
    if (represented > value.totalShips)
        throw new Error('Invalid fleet appearance total');
}
function validateCount(count) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_FLEET_MEMBERS)
        throw new Error('Invalid fleet appearance count');
}
//# sourceMappingURL=fleet-appearance.js.map