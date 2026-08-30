/**
 * M4 — CPU pack helpers for map overlay geometry.
 * Pure math; no GPU.
 *
 * - **Fills** (plane quads): pos.xyz + rgba for MapOverlayGpuLayer triangle-list.
 * - **Lines** (rings / axes): Line2 segment packs (pos pairs + RGB pairs) for
 *   fat screen-space ribbons via `js/vendor/line2`. Thin line-list packs remain
 *   for unit tests / legacy callers.
 */
import { RENDER_PLANE_Y } from "../contracts/render-constants.js";
import { MAP_OVERLAY_FLOATS_PER_VERT, } from "./shaders/map-overlay.wgsl.js";
import { keplerPhaseLocalF32 } from "./math/world-origin.js";
/** Axis X (red). */
export const OVERLAY_COLOR_AXIS_X = [1, 0.25, 0.2, 1];
/** Axis Z (blue). */
export const OVERLAY_COLOR_AXIS_Z = [0.2, 0.45, 1, 1];
/** Plane fill (green, translucent). */
export const OVERLAY_COLOR_PLANE = [0.25, 0.95, 0.35, 0.25];
/** Hover highlight (yellow). */
export const OVERLAY_COLOR_HOVER = [1, 1, 0.2, 1];
/** Selection highlight (cyan). */
export const OVERLAY_COLOR_SELECT = [0, 1, 1, 1];
/** Default ring (soft white). */
export const OVERLAY_COLOR_RING = [0.85, 0.9, 1, 0.7];
/** SCENE orbit rings — faint blueprint cyan (Line2 material supplies alpha). */
export const SCENE_SCHEMATIC_RING_COLOR = [0.45, 0.65, 1, 0.05];
/** SCENE y=0 grid — fainter than rings. */
export const SCENE_SCHEMATIC_GRID_COLOR = [0.45, 0.65, 1, 0.028];
/** SCENE-local jump rays. */
export const SCENE_JUMP_RAY_COLOR = [0.45, 0.85, 1, 0.07];
/** 48 × 5 Kepler ring tessellation. */
export const KEPLER_ORBIT_RING_SEGMENTS = 240;
/** Jump rays start at this × outer planet Kepler radius. */
export const SCENE_JUMP_RAY_R0_MUL = 1.2;
/**
 * Cap local jump-ray length at this × SYSTEM_LOCAL_SPAN so galaxy hops of
 * ~1500 do not become hyperspace beams through the jewel.
 */
export const SCENE_JUMP_RAY_LEN_CAP_MUL = 3.2;
/** Grid half-extent as a multiple of SYSTEM_LOCAL_SPAN. */
export const SCENE_GRID_SPAN_MUL = 2.8;
/** Square grid lines per axis (24 cells → 25 lines × 2 dirs). */
export const SCENE_GRID_DIVISIONS = 24;
/** Rim dissolve: RGB *= 1 − this × (distFromCenter / halfExtent)². */
export const SCENE_GRID_EDGE_FADE = 0.85;
/** Blueprint dash (screen units). */
export const SCENE_SCHEMATIC_DASH_SIZE = 8;
export const SCENE_SCHEMATIC_GAP_SIZE = 10;
/** Local ray length: same direction, min(edge, cap×span). */
export function capSceneJumpRayLength(length, span) {
    const cap = SCENE_JUMP_RAY_LEN_CAP_MUL * span;
    if (!(length > 0))
        return 0;
    if (!(cap > 0))
        return length;
    return length < cap ? length : cap;
}
/** Floats per Line2 segment: start xyz + end xyz. */
export const LINE2_OVERLAY_POS_FLOATS = 6;
/** Floats per Line2 segment: start rgb + end rgb. */
export const LINE2_OVERLAY_COLOR_FLOATS = 6;
const F = MAP_OVERLAY_FLOATS_PER_VERT;
const LP = LINE2_OVERLAY_POS_FLOATS;
const LC = LINE2_OVERLAY_COLOR_FLOATS;
function writeVert(out, o, x, y, z, c) {
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + 3] = c[0];
    out[o + 4] = c[1];
    out[o + 5] = c[2];
    out[o + 6] = c[3];
    return o + F;
}
/**
 * Two axis segments as line-list: +X then +Z from center.
 * 4 vertices (2 lines).
 */
export function packAxisLines(cx, cz, layout, colorX = OVERLAY_COLOR_AXIS_X, colorZ = OVERLAY_COLOR_AXIS_Z, y = RENDER_PLANE_Y) {
    const L = layout.axisLength;
    const vertexCount = 4;
    const data = new Float32Array(vertexCount * F);
    let o = 0;
    o = writeVert(data, o, cx, y, cz, colorX);
    o = writeVert(data, o, cx + L, y, cz, colorX);
    o = writeVert(data, o, cx, y, cz, colorZ);
    writeVert(data, o, cx, y, cz + L, colorZ);
    return { data, vertexCount };
}
/**
 * Filled plane quad on XZ as triangle-list (2 tris, 6 verts).
 * Corners at ±planeHalfExtent around center.
 */
export function packPlaneQuad(cx, cz, halfExtent, color = OVERLAY_COLOR_PLANE, y = RENDER_PLANE_Y) {
    const p = halfExtent;
    const x0 = cx - p;
    const x1 = cx + p;
    const z0 = cz - p;
    const z1 = cz + p;
    const vertexCount = 6;
    const data = new Float32Array(vertexCount * F);
    let o = 0;
    // tri 0: (x0,z0)-(x1,z0)-(x1,z1)
    o = writeVert(data, o, x0, y, z0, color);
    o = writeVert(data, o, x1, y, z0, color);
    o = writeVert(data, o, x1, y, z1, color);
    // tri 1: (x0,z0)-(x1,z1)-(x0,z1)
    o = writeVert(data, o, x0, y, z0, color);
    o = writeVert(data, o, x1, y, z1, color);
    writeVert(data, o, x0, y, z1, color);
    return { data, vertexCount };
}
/** Soft grid line (minor) — high alpha so thin lines read on dark clear. */
export const OVERLAY_COLOR_GRID_MINOR = [0.55, 0.62, 0.78, 0.85];
/** Stronger every Nth grid line (major). */
export const OVERLAY_COLOR_GRID_MAJOR = [0.78, 0.86, 1.0, 0.95];
/** Origin axes on the ground plane. */
export const OVERLAY_COLOR_GRID_AXIS_X = [1.0, 0.4, 0.35, 1.0];
export const OVERLAY_COLOR_GRID_AXIS_Z = [0.35, 0.65, 1.0, 1.0];
/**
 * Y = 0 (or `y`) ground grid as line-list verts for {@link MapOverlayGpuLayer}.
 * Lines parallel to +X and +Z across ±halfExtent, with major every `majorEvery`
 * cells and thicker-looking origin axes.
 *
 * Pure pack — no GPU. Scenic tech demos use this as a height reference.
 */
export function packGroundGridY0(opts) {
    const half = typeof opts.halfExtent === "number" && opts.halfExtent > 0
        ? opts.halfExtent
        : 12000;
    const spacing = typeof opts.spacing === "number" && opts.spacing > 0
        ? opts.spacing
        : 1000;
    const majorEvery = Math.max(1, (typeof opts.majorEvery === "number" ? opts.majorEvery : 5) | 0);
    const y = opts.y !== undefined ? opts.y : RENDER_PLANE_Y;
    const includeAxes = opts.includeAxes !== false;
    const minor = opts.minorColor ?? OVERLAY_COLOR_GRID_MINOR;
    const major = opts.majorColor ?? OVERLAY_COLOR_GRID_MAJOR;
    const axisX = opts.axisXColor ?? OVERLAY_COLOR_GRID_AXIS_X;
    const axisZ = opts.axisZColor ?? OVERLAY_COLOR_GRID_AXIS_Z;
    const n = Math.max(1, Math.round((2 * half) / spacing));
    // For each of n+1 lines in X dir and n+1 in Z dir: 2 verts; + optional 2 axes.
    const lineCount = (n + 1) * 2 + (includeAxes ? 2 : 0);
    const vertexCount = lineCount * 2;
    const data = new Float32Array(vertexCount * F);
    let o = 0;
    let vi = 0;
    const writeLine = (x0, z0, x1, z1, c) => {
        o = writeVert(data, o, x0, y, z0, c);
        o = writeVert(data, o, x1, y, z1, c);
        vi += 2;
    };
    for (let i = 0; i <= n; i++) {
        const t = -half + i * spacing;
        const isMajor = i % majorEvery === 0;
        // Skip pure origin if axes drawn separately (avoid double-bright).
        const onOrigin = Math.abs(t) < spacing * 0.01;
        if (includeAxes && onOrigin)
            continue;
        const c = isMajor ? major : minor;
        // Line parallel to X (constant z = t)
        writeLine(-half, t, half, t, c);
        // Line parallel to Z (constant x = t)
        writeLine(t, -half, t, half, c);
    }
    if (includeAxes) {
        writeLine(-half, 0, half, 0, axisX);
        writeLine(0, -half, 0, half, axisZ);
    }
    return { data: data.subarray(0, vi * F), vertexCount: vi };
}
/**
 * Ground plane + grid pack for scenic demos (fill under lines).
 */
export function packGroundReferenceY0(opts) {
    const half = typeof opts?.halfExtent === "number" && opts.halfExtent > 0
        ? opts.halfExtent
        : 12000;
    const y = opts?.y !== undefined ? opts.y : RENDER_PLANE_Y;
    const planeColor = opts?.planeColor ?? [0.12, 0.18, 0.28, 0.55];
    const plane = packPlaneQuad(0, 0, half, planeColor, y);
    const grid = packGroundGridY0({
        halfExtent: half,
        spacing: opts?.spacing,
        majorEvery: opts?.majorEvery,
        y,
    });
    return {
        fills: plane.data,
        fillVertexCount: plane.vertexCount,
        lines: grid.data,
        lineVertexCount: grid.vertexCount,
    };
}
/**
 * Closed ring as line-list pairs (N segments → 2N vertices).
 * Default 48 segments. Prefer {@link packRingLine2} for map fat lines.
 */
export function packRingLineLoop(cx, cz, radius, segments = 48, color = OVERLAY_COLOR_RING, y = RENDER_PLANE_Y) {
    const n = Math.max(3, segments | 0);
    const vertexCount = n * 2;
    const data = new Float32Array(vertexCount * F);
    let o = 0;
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const x0 = cx + Math.cos(a0) * radius;
        const z0 = cz + Math.sin(a0) * radius;
        const x1 = cx + Math.cos(a1) * radius;
        const z1 = cz + Math.sin(a1) * radius;
        o = writeVert(data, o, x0, y, z0, color);
        o = writeVert(data, o, x1, y, z1, color);
    }
    return { data, vertexCount };
}
function writeLine2Seg(positions, colors, segIndex, x0, y0, z0, x1, y1, z1, c) {
    const po = segIndex * LP;
    positions[po] = x0;
    positions[po + 1] = y0;
    positions[po + 2] = z0;
    positions[po + 3] = x1;
    positions[po + 4] = y1;
    positions[po + 5] = z1;
    const co = segIndex * LC;
    // Line2 vertex colors are RGB; material alpha supplies opacity.
    colors[co] = c[0];
    colors[co + 1] = c[1];
    colors[co + 2] = c[2];
    colors[co + 3] = c[0];
    colors[co + 4] = c[1];
    colors[co + 5] = c[2];
}
/**
 * Two axis segments for Line2: +X then +Z from center.
 * 2 segments (12 position floats, 12 color floats).
 */
export function packAxisLinesLine2(cx, cz, layout, colorX = OVERLAY_COLOR_AXIS_X, colorZ = OVERLAY_COLOR_AXIS_Z, y = RENDER_PLANE_Y) {
    const L = layout.axisLength;
    const segmentCount = 2;
    const positions = new Float32Array(segmentCount * LP);
    const colors = new Float32Array(segmentCount * LC);
    writeLine2Seg(positions, colors, 0, cx, y, cz, cx + L, y, cz, colorX);
    writeLine2Seg(positions, colors, 1, cx, y, cz, cx, y, cz + L, colorZ);
    return { positions, colors, segmentCount };
}
/**
 * Subtract frame origin from a Line2 pack (f64 then store f32).
 * Use with viewRel so thickness stays screen-px at |xz| ≳ 1e5.
 */
export function shiftLine2PackByOrigin(pack, originX, originY, originZ, out) {
    const n = pack.segmentCount;
    const need = n * LP;
    const positions = out && out.positions.length >= need
        ? out.positions
        : new Float32Array(need);
    const colors = out && out.colors.length >= need ? out.colors : new Float32Array(need);
    const src = pack.positions;
    for (let i = 0; i < need; i += 3) {
        positions[i] = src[i] - originX;
        positions[i + 1] = src[i + 1] - originY;
        positions[i + 2] = src[i + 2] - originZ;
    }
    colors.set(pack.colors.subarray(0, need));
    return { positions, colors, segmentCount: n };
}
function ringSpecOf(item) {
    if (typeof item === "number") {
        return { radius: item, inclination: 0, node: 0 };
    }
    return {
        radius: item.radius,
        inclination: item.inclination ?? 0,
        node: item.node ?? 0,
    };
}
/**
 * Kepler orbit rings in **origin-relative** space (sun at centerRel).
 * Radii are already `k * showcaseOrbit`. Sample the same inclined Kepler
 * formula as planets (`keplerPhaseLocalF32`). Default 240 segs.
 */
export function packKeplerOrbitRingsViewRel(centerRelX, centerRelY, centerRelZ, rings, segments = KEPLER_ORBIT_RING_SEGMENTS, color = SCENE_SCHEMATIC_RING_COLOR) {
    const nRing = rings.length;
    const segs = Math.max(3, segments | 0);
    const segmentCount = nRing * segs;
    const positions = new Float32Array(segmentCount * LP);
    const colors = new Float32Array(segmentCount * LC);
    let s = 0;
    for (let r = 0; r < nRing; r++) {
        const spec = ringSpecOf(rings[r]);
        if (!(spec.radius > 0))
            continue;
        for (let i = 0; i < segs; i++) {
            const a0 = (i / segs) * Math.PI * 2;
            const a1 = ((i + 1) / segs) * Math.PI * 2;
            const p0 = keplerPhaseLocalF32(1, spec.radius, a0, spec.inclination, spec.node);
            const p1 = keplerPhaseLocalF32(1, spec.radius, a1, spec.inclination, spec.node);
            writeLine2Seg(positions, colors, s, centerRelX + p0.x, centerRelY + p0.y, centerRelZ + p0.z, centerRelX + p1.x, centerRelY + p1.y, centerRelZ + p1.z, color);
            s += 1;
        }
    }
    return {
        positions: positions.subarray(0, s * LP),
        colors: colors.subarray(0, s * LC),
        segmentCount: s,
    };
}
/**
 * Faint y = 0 square grid in origin-relative space, centered on the sun.
 * `divisions` cells per axis → (divisions+1)×2 Line2 segments.
 * RGB fades toward the rim (outer i=0 / i=n stay, but dimmer).
 */
export function packSceneGridViewRel(centerRelX, centerRelY, centerRelZ, halfExtent, divisions = SCENE_GRID_DIVISIONS, color = SCENE_SCHEMATIC_GRID_COLOR) {
    const n = Math.max(1, divisions | 0);
    const half = halfExtent > 0 ? halfExtent : 0;
    const segmentCount = (n + 1) * 2;
    const positions = new Float32Array(segmentCount * LP);
    const colors = new Float32Array(segmentCount * LC);
    const step = n > 0 ? (2 * half) / n : 0;
    let s = 0;
    for (let i = 0; i <= n; i++) {
        const t = -half + i * step;
        const u = half > 1e-12 ? Math.abs(t) / half : 0;
        const fade = 1 - SCENE_GRID_EDGE_FADE * u * u;
        const faded = [color[0] * fade, color[1] * fade, color[2] * fade, color[3]];
        writeLine2Seg(positions, colors, s, centerRelX - half, centerRelY, centerRelZ + t, centerRelX + half, centerRelY, centerRelZ + t, faded);
        s += 1;
        writeLine2Seg(positions, colors, s, centerRelX + t, centerRelY, centerRelZ - half, centerRelX + t, centerRelY, centerRelZ + half, faded);
        s += 1;
    }
    return { positions, colors, segmentCount: s };
}
/**
 * SCENE-local jump rays: start at `r0` along each unit dir, then original
 * edge length. Positions are already origin-relative (sun at centerRel).
 */
export function packSceneJumpRaysViewRel(centerRelX, centerRelY, centerRelZ, rays, r0, color = SCENE_JUMP_RAY_COLOR) {
    const n = rays.length;
    const positions = new Float32Array(n * LP);
    const colors = new Float32Array(n * LC);
    const startR = r0 > 0 ? r0 : 0;
    let s = 0;
    for (let i = 0; i < n; i++) {
        const ray = rays[i];
        const len = ray.length;
        if (!(len > 0))
            continue;
        let dx = ray.dirX;
        let dz = ray.dirZ;
        const mag = Math.hypot(dx, dz);
        if (!(mag > 1e-12))
            continue;
        dx /= mag;
        dz /= mag;
        const x0 = centerRelX + dx * startR;
        const z0 = centerRelZ + dz * startR;
        writeLine2Seg(positions, colors, s, x0, centerRelY, z0, x0 + dx * len, centerRelY, z0 + dz * len, color);
        s += 1;
    }
    return {
        positions: positions.subarray(0, s * LP),
        colors: colors.subarray(0, s * LC),
        segmentCount: s,
    };
}
export function packRingLine2(cx, cz, radius, segments = 48, color = OVERLAY_COLOR_RING, y = RENDER_PLANE_Y) {
    const n = Math.max(3, segments | 0);
    const positions = new Float32Array(n * LP);
    const colors = new Float32Array(n * LC);
    for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const x0 = cx + Math.cos(a0) * radius;
        const z0 = cz + Math.sin(a0) * radius;
        const x1 = cx + Math.cos(a1) * radius;
        const z1 = cz + Math.sin(a1) * radius;
        writeLine2Seg(positions, colors, i, x0, y, z0, x1, y, z1, color);
    }
    return { positions, colors, segmentCount: n };
}
/**
 * Pack a full edit-handle gizmo for the map path:
 * plane fill (triangle-list) + axes + ring as Line2 segments.
 */
export function packEditHandleGizmoLine2(cx, cz, layout, options) {
    const y = options?.y ?? RENDER_PLANE_Y;
    const axes = packAxisLinesLine2(cx, cz, layout, options?.colorX, options?.colorZ, y);
    const ring = packRingLine2(cx, cz, layout.ringRadius, options?.ringSegments ?? 48, options?.colorRing, y);
    const plane = packPlaneQuad(cx, cz, layout.planeHalfExtent, options?.colorPlane, y);
    const segmentCount = axes.segmentCount + ring.segmentCount;
    const positions = new Float32Array(segmentCount * LP);
    const colors = new Float32Array(segmentCount * LC);
    positions.set(axes.positions, 0);
    colors.set(axes.colors, 0);
    positions.set(ring.positions, axes.segmentCount * LP);
    colors.set(ring.colors, axes.segmentCount * LC);
    return {
        lines: { positions, colors, segmentCount },
        fills: plane,
    };
}
/**
 * Pack a full edit-handle gizmo: plane fill + axes + ring (thin line-list).
 * Prefer {@link packEditHandleGizmoLine2} for the live map path.
 */
export function packEditHandleGizmo(cx, cz, layout, options) {
    const y = options?.y ?? RENDER_PLANE_Y;
    const axes = packAxisLines(cx, cz, layout, options?.colorX, options?.colorZ, y);
    const ring = packRingLineLoop(cx, cz, layout.ringRadius, options?.ringSegments ?? 48, options?.colorRing, y);
    const plane = packPlaneQuad(cx, cz, layout.planeHalfExtent, options?.colorPlane, y);
    const lineCount = axes.vertexCount + ring.vertexCount;
    const lines = new Float32Array(lineCount * F);
    lines.set(axes.data, 0);
    lines.set(ring.data, axes.vertexCount * F);
    return {
        lines: { data: lines, vertexCount: lineCount },
        fills: plane,
    };
}
//# sourceMappingURL=map-overlay-pack.js.map