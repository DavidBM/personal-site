// @ts-expect-error JS runtime metadata is shared with the seed writer.
import { fleetComposition, visualParts } from '../../../lib/ship-runtime/fleet-mix.mjs';
// @ts-expect-error JS class metadata is shared with the motion kernel.
import { CLASSES, CLASS_BY_TYPE } from '../../../lib/ship-runtime/classes.mjs';
export const FLEET_MARKER = { stem: 24, cellWidth: 25, cellHeight: 8, padding: 3, glyphScale: 1 };
/** Same contiguous type ranges as seedDirectedShips; evaluate on membership changes. */
export function sceneFleetTypes(id, count, explicitType) {
    if (explicitType != null) {
        const kind = CLASS_BY_TYPE[explicitType & 31];
        return count > 0 ? [{ type: explicitType, kind, name: CLASSES[kind].name, count, ordinal: 0 }] : [];
    }
    const mix = fleetComposition(id), parts = visualParts(mix, count);
    let ordinal = 0;
    return mix.classes.flatMap((entry, index) => {
        const n = parts[index];
        const row = { type: entry.type, kind: entry.kind, name: CLASSES[entry.kind].name, count: n, ordinal };
        ordinal += n;
        return n > 0 ? [row] : [];
    });
}
export function fleetMarkerSize(types) {
    return { width: Math.min(3, types) * FLEET_MARKER.cellWidth + FLEET_MARKER.padding * 2,
        height: Math.ceil(types / 3) * FLEET_MARKER.cellHeight + FLEET_MARKER.padding * 2 };
}
/** Matches fleet-marker.wgsl.ts in CSS pixels, using the sun-local frame matrix. */
export function projectFleetMarker(vp, p, types, width, height) {
    const w = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
    if (!Number.isFinite(w) || w <= 0 || types <= 0)
        return null;
    const z = (vp[2] * p.x + vp[6] * p.y + vp[10] * p.z + vp[14]) / w;
    if (!Number.isFinite(z) || z < 0 || z > 1)
        return null;
    const x = ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / w + 1) * width / 2;
    const baseY = (1 - (vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / w) * height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(baseY))
        return null;
    const size = fleetMarkerSize(types), y = baseY - FLEET_MARKER.stem - size.height / 2;
    if (x + size.width / 2 < 0 || x - size.width / 2 > width || y + size.height / 2 < 0 || y - size.height / 2 > height)
        return null;
    return { x, y, baseY, ...size, depth: w };
}
//# sourceMappingURL=fleet-marker.js.map