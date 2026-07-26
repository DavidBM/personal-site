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
 * Closed ring as Line2 segment pairs (N segments).
 * Default 48 segments — matches map overlay budget.
 */
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