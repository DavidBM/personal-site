/**
 * Hull level of detail by projected diameter (render pixels), per mesh class.
 *
 * One owner for the renderer (both GPU decision sites use hullLodWgsl), the
 * model viewer's preview/tuning tool and the catalog. Each level has a pixel
 * range [min, max). Ranges may overlap: a ship keeps its current level while the
 * size stays inside that level's range, so an overlap is the hysteresis band
 * that stops a ship on a boundary from flickering. When the size leaves the
 * current range, the most detailed level whose range contains it wins; in a gap
 * between ranges the nearest range wins.
 */
/** Most to least detailed. */
export const HULL_LEVELS = ['full', 'mid', 'low', 'dart', 'point'];
/** ShipSim.targetKind detail bits (bits 9, 10, 13, 14, 15). */
export const HULL_LEVEL_BITS = Object.freeze({
    full: 1024, mid: 512, low: 16384, dart: 8192, point: 32768,
});
export const HULL_DETAIL_MASK = 1024 | 512 | 16384 | 8192 | 32768;
/** Catalog mesh each level draws; `dart` is per class, `point` is one screen-facing triangle. */
export const HULL_LEVEL_MESH = Object.freeze({ full: 'high', mid: 'low', low: 'far', dart: 'dart', point: null });
/**
 * Full detail from 150 px, the ~1000-triangle mid level to 80 px, the
 * ~300-triangle low level to 40 px, the ship-shaped dart to 1 px and a single
 * triangle below. Each overlap (about 5-10 %) is that boundary's hysteresis.
 */
export const DEFAULT_HULL_LOD = Object.freeze({
    full: [140, Infinity], mid: [76, 150], low: [36, 80], dart: [0.9, 40], point: [0, 1],
});
function contains(band, px) {
    return px >= band[0] && px < band[1];
}
export function selectHullLevel(px, previous, bands = DEFAULT_HULL_LOD) {
    if (previous && contains(bands[previous], px))
        return previous;
    let best = 'full', bestGap = Infinity;
    for (const level of HULL_LEVELS) {
        const band = bands[level];
        if (contains(band, px))
            return level;
        if (band[0] >= band[1])
            continue;
        const gap = Math.max(band[0] - px, px - band[1]);
        if (gap < bestGap) {
            bestGap = gap;
            best = level;
        }
    }
    return best;
}
/** GPU rows per class: (full, mid), (low, dart), (point, unused); Infinity is stored as 1e30. */
export const HULL_LOD_ROWS_PER_CLASS = 3;
export const HULL_LOD_MAX_CLASSES = 8;
export const HULL_LOD_BYTES = HULL_LOD_MAX_CLASSES * HULL_LOD_ROWS_PER_CLASS * 16;
export function packHullLod(perClass) {
    const out = new Float32Array(HULL_LOD_BYTES / 4);
    for (let c = 0; c < HULL_LOD_MAX_CLASSES; c++) {
        const bands = perClass[Math.min(c, perClass.length - 1)] ?? DEFAULT_HULL_LOD;
        HULL_LEVELS.forEach((level, i) => {
            const [min, max] = bands[level];
            out.set([min, Number.isFinite(max) ? max : 1e30], c * 12 + i * 2);
        });
    }
    return out;
}
/** WGSL for hullDetailBits(px, previous, meshClass); binds the packed table at (group, binding). */
export function hullLodWgsl(group, binding) {
    const bits = HULL_LEVELS.map((l) => `${HULL_LEVEL_BITS[l]}u`).join(', ');
    return /* wgsl */ `
struct HullLodTable { rows: array<vec4<f32>, ${HULL_LOD_MAX_CLASSES * HULL_LOD_ROWS_PER_CLASS}> }
@group(${group}) @binding(${binding}) var<uniform> hullLod: HullLodTable;
fn hullBand(meshClass: u32, level: u32) -> vec2<f32> {
  let row = hullLod.rows[min(meshClass, ${HULL_LOD_MAX_CLASSES - 1}u) * ${HULL_LOD_ROWS_PER_CLASS}u + level / 2u];
  return select(row.xy, row.zw, (level & 1u) == 1u);
}
fn hullDetailBits(px: f32, previous: u32, meshClass: u32) -> u32 {
  let bits = array<u32, ${HULL_LEVELS.length}>(${bits});
  // Keep the current level while the size stays inside its range (overlap = hysteresis).
  for (var level = 0u; level < ${HULL_LEVELS.length}u; level++) {
    let band = hullBand(meshClass, level);
    if ((previous & bits[level]) != 0u && px >= band.x && px < band.y) { return bits[level]; }
  }
  var best = 0u; var bestGap = 3.0e38;
  for (var level = 0u; level < ${HULL_LEVELS.length}u; level++) {
    let band = hullBand(meshClass, level);
    if (px >= band.x && px < band.y) { return bits[level]; }
    let gap = select(max(band.x - px, px - band.y), 3.0e38, band.x >= band.y);
    if (gap < bestGap) { bestGap = gap; best = level; }
  }
  return bits[best];
}
`;
}
/**
 * The point level draws one camera-facing triangle whose circumcircle is the
 * hull's own projected diameter, but never smaller than this. 2.85 px gives an
 * inradius over half a pixel diagonal, so the triangle covers at least one pixel
 * centre wherever it lands, even without MSAA, and a class whose point range
 * reaches past it does not shrink when it switches from the dart.
 */
export const HULL_POINT_PX = 2.85;
/** Point mesh: equilateral triangle, circumradius 1, in the XY plane (billboard corners). */
export const HULL_POINT_CORNERS = Object.freeze([0, 1, -0.8660254, -0.5, 0.8660254, -0.5]);
/**
 * World radius whose projected diameter is `px` (the renderer's measure:
 * diameter px = pixelGain * radius / distance, pixelGain = |proj[1][1]| * height).
 */
export function hullRadiusForPixels(px, distance, pixelGain) {
    return (px * distance) / Math.max(pixelGain, 1e-9);
}
/** Billboard offset for a point-level vertex; toShip is camera-to-ship and hullRadius the hull's radius, in world units. */
export const HULL_POINT_WGSL = /* wgsl */ `
fn hullPointOffset(toShip: vec3<f32>, corner: vec3<f32>, pixelGain: f32, hullRadius: f32) -> vec3<f32> {
  let distance = length(toShip);
  let forward = toShip / max(distance, 1e-9);
  let hint = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(forward.y) > 0.99);
  let right = normalize(cross(forward, hint));
  let up = cross(right, forward);
  return (right * corner.x + up * corner.y) * max(hullRadius, ${HULL_POINT_PX} * distance / max(pixelGain, 1e-9));
}
`;
export function hullLodToJson(bands) {
    return Object.fromEntries(HULL_LEVELS.map((l) => [l, [bands[l][0], Number.isFinite(bands[l][1]) ? bands[l][1] : null]]));
}
function parseBand(level, band) {
    if (!Array.isArray(band) || band.length !== 2)
        throw new Error(`Hull LOD ${level} must be [min, max]`);
    const min = Number(band[0]), max = band[1] === null ? Infinity : Number(band[1]);
    if (!Number.isFinite(min) || min < 0 || Number.isNaN(max))
        throw new Error(`Hull LOD ${level} has an invalid range`);
    return [min, max];
}
/** Validates a JSON level table; missing levels take the fallback's ranges. */
export function parseHullLod(value, fallback = DEFAULT_HULL_LOD) {
    if (value == null)
        return fallback;
    if (typeof value !== 'object')
        throw new Error('Hull LOD must be an object of level ranges');
    const source = value;
    return Object.freeze(Object.fromEntries(HULL_LEVELS.map((level) => [level, source[level] === undefined ? fallback[level] : parseBand(level, source[level])])));
}
//# sourceMappingURL=hull-lod.js.map