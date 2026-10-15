/**
 * Engine trails and glows per hull class, from the fleet-v2 catalog: authored
 * in the model viewer, imported by scripts/import-ship-fx.mjs. Positions,
 * ribbon widths and glow sizes are in catalog hull space (bounding radius 1,
 * +Z forward, +Y up), so the GPU scales them by each ship's hull draw scale.
 *
 * The GPU reads one small uniform table (SHIP_FX_WGSL): per class, its engine
 * emitters (offset, ribbon width, ribbon style layer) and glows (offset, size,
 * glow style layer, facing). Ribbon and glow styles are layers of two texture
 * arrays, in `trailStyles` order. A catalog without styles or points yields
 * null and the game keeps one centre trail per ship.
 */
export const SHIP_FX_MAX_CLASSES = 8;
export const SHIP_FX_MAX_EMITTERS = 8;
export const SHIP_FX_MAX_GLOWS = 8;
export const SHIP_FX_MAX_STYLES = 8;
/** header: 1 vec4; counts: 8 vec4; emitters and glows: 8 classes × 8 items × 2 vec4 each. */
const COUNT_VEC4 = SHIP_FX_MAX_CLASSES;
const ITEM_VEC4 = SHIP_FX_MAX_CLASSES * 8 * 2;
export const SHIP_FX_UNIFORM_BYTES = (1 + COUNT_VEC4 + 2 * ITEM_VEC4) * 16;
const asObj = (v) => (v && typeof v === "object" ? v : {});
const validImage = (p) => typeof p === "string" && /^fx\/[\w-]+\.png$/.test(p);
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x) && Math.abs(x) <= 4) ? v : null;
function styles(list) {
    const out = { ids: new Map(), images: [], facing: [] };
    for (const s of Array.isArray(list) ? list.slice(0, SHIP_FX_MAX_STYLES) : []) {
        const style = asObj(s);
        if (typeof style.id !== "string" || !validImage(style.image) || out.ids.has(style.id))
            continue;
        out.ids.set(style.id, out.images.length);
        out.images.push(style.image);
        out.facing.push(Number.isFinite(style.facing) ? Math.min(Math.max(style.facing, 0), 1) : 1);
    }
    return out;
}
/** Points with a finite position, positive size and known style (unknown styles use the first). */
function points(list, sizeKey, ids, max, make) {
    if (!ids.size)
        return [];
    const out = [];
    for (const p of Array.isArray(list) ? list : []) {
        const point = asObj(p), at = vec3(point.at), size = point[sizeKey];
        if (!at || !(typeof size === "number" && size > 0 && size <= 4))
            continue;
        out.push(make(at, size, ids.get(point.style) ?? 0));
        if (out.length === max)
            break;
    }
    return out;
}
/** Engine data of a parsed catalog (index = classId); null when it has none. */
export function parseShipFx(catalog) {
    const root = asObj(catalog), trailStyles = asObj(root.trailStyles);
    const ribbons = styles(trailStyles.ribbons), glows = styles(trailStyles.glows);
    const ships = Array.isArray(root.ships) ? root.ships.slice(0, SHIP_FX_MAX_CLASSES) : [];
    const classes = ships.map((s) => {
        const ship = asObj(s);
        return {
            emitters: points(ship.trails, "width", ribbons.ids, SHIP_FX_MAX_EMITTERS, (at, width, layer) => ({ at, width, layer })),
            glows: points(ship.glows, "size", glows.ids, SHIP_FX_MAX_GLOWS, (at, size, layer) => ({ at, size, layer, facing: glows.facing[layer] ?? 1 })),
        };
    });
    if (!classes.some((c) => c.emitters.length || c.glows.length))
        return null;
    return { classes, ribbonImages: ribbons.images, glowImages: glows.images };
}
/**
 * The uniform table read by SHIP_FX_WGSL (no counts = no engines anywhere).
 * `hullUnit`: world size of hull radius 1 at draw scale 1 (scene units).
 */
export function packShipFx(fx, hullUnit) {
    const buffer = new ArrayBuffer(SHIP_FX_UNIFORM_BYTES);
    const words = new Uint32Array(buffer), floats = new Float32Array(buffer);
    floats[0] = hullUnit;
    fx?.classes.forEach((c, cls) => {
        words[(1 + cls) * 4] = c.emitters.length;
        words[(1 + cls) * 4 + 1] = c.glows.length;
        c.emitters.forEach((e, i) => floats.set([...e.at, e.width, e.layer, 0, 0, 0], (1 + COUNT_VEC4 + (cls * 8 + i) * 2) * 4));
        c.glows.forEach((g, i) => floats.set([...g.at, g.size, g.layer, g.facing, 0, 0], (1 + COUNT_VEC4 + ITEM_VEC4 + (cls * 8 + i) * 2) * 4));
    });
    return buffer;
}
export const SHIP_FX_WGSL = (binding) => /* wgsl */ `
// Engine trails and glows per hull class (ship-fx.ts). Items: [class * 8 + i] * 2.
struct ShipFxTable {
  header: vec4<f32>,                              // x: world size of hull radius 1 at draw scale 1; y: 1 = draw engine copies;
                                                  // z: glow-ship diameter floor (render px, 0 = none); w: render px of diameter per radius/depth
  counts: array<vec4<u32>, ${COUNT_VEC4}>,       // x emitters, y glows
  emitters: array<vec4<f32>, ${ITEM_VEC4}>,      // (at.xyz, ribbon width), (ribbon layer, 0, 0, 0)
  glows: array<vec4<f32>, ${ITEM_VEC4}>,         // (at.xyz, glow size), (glow layer, facing, 0, 0)
};
@group(0) @binding(${binding}) var<uniform> shipFx: ShipFxTable;
`;
/**
 * Engine list written by trail expansion each frame, drawn without CPU counts:
 *   words 0-4   DrawIndexedIndirect for engine trails: the trail template,
 *               SHIP_FX_MAX_EMITTERS instances per engine-ship centre segment
 *               (the vertex shader drops copies beyond the class's emitters);
 *               textured ribbons for mid/full, one thin line for low;
 *   word 5      engine ships this frame (their segments are engine copies);
 *   word 6      low/mid/full ships whose class has engines and whose trail
 *               is in view (whether or not copies are on: header.y of the
 *               class table turns them on);
 *   word 9      SHIP_FX_MAX_GLOWS × glow ships (words 8-11 keep DrawIndirect
 *               shape; the glow draw is direct and reads this count);
 *   word 10     glow demand: on-screen mid/full-detail ships with glows that
 *               passed the size floor, before the capacity check;
 *   then, as vec4 from byte 256: glow ships (3 vec4 each: centre and hull
 *   scale, attitude, (class, kernel slot bits, engine level)) and engine ships (2 vec4 each: attitude, then hull
 *   scale and class). Engine-ship centre segments live in the top quarter of
 *   the trail records, filled from the end (ENGINE_RECORD_SHARE), with their
 *   engine-ship index in the colour slots.
 */
/** Words the host resets each frame; glow ships start at SHIP_ENGINE_HEADER_BYTES. */
export const SHIP_ENGINE_HEADER_WORDS = 12;
export const SHIP_ENGINE_HEADER_BYTES = 256;
export const SHIP_ENGINE_GLOW_ARGS_BYTE = 32;
/**
 * Glow ships per frame: mid and full-detail hulls on screen (those drawing
 * textured engine ribbons). They are 115–710 render px across at the least,
 * but a big fleet at a high resolution puts dozens to hundreds in view. The
 * glow draw is a direct SHIP_GLOW_SHIP_CAPACITY × SHIP_FX_MAX_GLOWS instances
 * whose surplus collapses in the vertex shader (an indirect draw would cost a
 * validation pass in the sun-lens pass). When more ships qualify, the host
 * raises a diameter floor (table header.z) so the biggest keep their glows
 * instead of an arbitrary subset each frame.
 */
export const SHIP_GLOW_SHIP_CAPACITY = 512;
/**
 * The glow-ship diameter floor (render px, 0 = none) after a read of the glow
 * demand: while more qualify than the list holds it steps up per read from
 * just below every class's mid-detail threshold until they fit, and steps
 * back down (to none below the first step) once demand falls under a quarter
 * of the list. The gap keeps a fleet near the limit from alternating between
 * two floors.
 */
export const GLOW_FLOOR_START_PX = 100;
/**
 * Glow ships the direct glow draw covers after a read of the glow demand: twice
 * the demand (a power of two, at least 8), up to the list. Each listed ship is
 * SHIP_FX_MAX_GLOWS instances whose surplus collapses, so drawing the whole list
 * cost ~5 µs per frame at 512; reads lag 2-3 frames, and the headroom covers
 * ships entering view meanwhile.
 */
export function glowDrawShips(demand) {
    let ships = 8;
    while (ships < 2 * demand && ships < SHIP_GLOW_SHIP_CAPACITY)
        ships *= 2;
    return Math.min(ships, SHIP_GLOW_SHIP_CAPACITY);
}
export const GLOW_FLOOR_STEP = 1.25;
export function nextGlowFloorPx(floorPx, demand) {
    if (demand > SHIP_GLOW_SHIP_CAPACITY)
        return Math.max(floorPx, GLOW_FLOOR_START_PX) * GLOW_FLOOR_STEP;
    if (floorPx <= 0 || demand >= SHIP_GLOW_SHIP_CAPACITY / 4)
        return floorPx;
    const lower = floorPx / GLOW_FLOOR_STEP;
    return lower < GLOW_FLOOR_START_PX * GLOW_FLOOR_STEP ? 0 : lower;
}
export const SHIP_GLOW_SHIP_STRIDE = 48;
/** Engine ships per frame: low, mid and full-detail hulls whose trails are in view. */
export const SHIP_ENGINE_SHIP_CAPACITY = 4096;
export const SHIP_ENGINE_SHIP_STRIDE = 32;
export const SHIP_ENGINE_LIST_BYTES = SHIP_ENGINE_HEADER_BYTES + SHIP_GLOW_SHIP_CAPACITY * SHIP_GLOW_SHIP_STRIDE
    + SHIP_ENGINE_SHIP_CAPACITY * SHIP_ENGINE_SHIP_STRIDE;
/** vec4 index (from byte 0) of the first glow ship and of the first engine ship. */
export const SHIP_GLOW_SHIP_VEC4 = SHIP_ENGINE_HEADER_BYTES / 16;
export const SHIP_ENGINE_SHIP_VEC4 = SHIP_GLOW_SHIP_VEC4 + SHIP_GLOW_SHIP_CAPACITY * 3;
export const SHIP_GLOW_VERTICES = 6;
/** Engine-ship centre segments may use up to 1/ENGINE_RECORD_SHARE of the trail records. */
export const ENGINE_RECORD_SHARE = 4;
//# sourceMappingURL=ship-fx.js.map