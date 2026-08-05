/**
 * Hard test-run shapes for the multi-method disc-impostor demo.
 *
 * Each shape is a **star-convex radial shell** about the origin: for unit
 * direction ω, surface radius r(ω) ∈ (0,1]. Height for the ray-heightfield is
 * h = r (with heightScale = 1 → rSurf = h), so non-sphere silhouettes read as
 * true 3D radial solids inside the unit billboard disc.
 *
 * Pure TS — Node smoke drives these generators directly (no GPU).
 */
import { HEIGHT_TEX_SIZE, NORMAL_MAP_STRENGTH, heightToNormal } from "./heightfield.js";
/** Extra-hard radial indent for stress tests (vs mid-band SPHERE_HEIGHT_SCALE≈0.16). */
export const TEST_RUN_HEIGHT_SCALE = 1.0;
/** Prior mid-band demo scale (smoke asserts test runs are harder than this). */
export const MID_BAND_HEIGHT_SCALE = 0.16;
const EPS = 1e-8;
function hypot3(x, y, z) {
    return Math.hypot(x, y, z) || 1;
}
function clamp01(x) {
    return Math.min(1, Math.max(0, x));
}
/**
 * Largest r∈[0,rMax] with point r·d still inside the solid (origin assumed inside).
 * 28 bisections → sub-1e-8 relative precision for unit-scale solids.
 */
export function radialFromInside(dx, dy, dz, inside, rMax = 1) {
    const len = hypot3(dx, dy, dz);
    const x = dx / len;
    const y = dy / len;
    const z = dz / len;
    if (!inside(0, 0, 0)) {
        // Degenerate: origin outside — fall back to tiny shell
        return 0.05;
    }
    let lo = 0;
    let hi = rMax;
    // Expand hi if still inside at rMax (should not for our shapes)
    if (inside(x * hi, y * hi, z * hi)) {
        return hi;
    }
    for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) * 0.5;
        if (inside(x * mid, y * mid, z * mid))
            lo = mid;
        else
            hi = mid;
    }
    return lo;
}
// ---------------------------------------------------------------------------
// Shape solid predicates (origin-centered, max radius ≤ 1)
// ---------------------------------------------------------------------------
/** Axis-aligned cube half-extent → max corner radius = s√3 ≤ 1 ⇒ s ≤ 1/√3. */
const CUBE_HALF = 0.55;
function insideCube(x, y, z) {
    return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= CUBE_HALF + EPS;
}
function radiusCube(x, y, z) {
    const len = hypot3(x, y, z);
    const ax = Math.abs(x / len);
    const ay = Math.abs(y / len);
    const az = Math.abs(z / len);
    const m = Math.max(ax, ay, az);
    return m > EPS ? Math.min(1, CUBE_HALF / m) : CUBE_HALF;
}
/** Square pyramid: apex +Y, base −Y. */
const PYR_APEX_Y = 0.92;
const PYR_BASE_Y = -0.55;
const PYR_BASE_HALF = 0.7;
function insidePyramid(x, y, z) {
    if (y > PYR_APEX_Y + EPS || y < PYR_BASE_Y - EPS)
        return false;
    const t = (PYR_APEX_Y - y) / (PYR_APEX_Y - PYR_BASE_Y);
    const half = PYR_BASE_HALF * t;
    return Math.abs(x) <= half + EPS && Math.abs(z) <= half + EPS;
}
function radiusPyramid(x, y, z) {
    return radialFromInside(x, y, z, insidePyramid, 1);
}
const SMALL_SPHERE_R = 0.42;
function radiusSmallerSphere(_x, _y, _z) {
    return SMALL_SPHERE_R;
}
/** Deterministic 3D value noise in [0,1). */
function hash3(ix, iy, iz) {
    let n = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7) * 43758.5453;
    n = n - Math.floor(n);
    return n;
}
function valueNoise3(px, py, pz) {
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const z0 = Math.floor(pz);
    const fx = px - x0;
    const fy = py - y0;
    const fz = pz - z0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const n = (i, j, k) => hash3(x0 + i, y0 + j, z0 + k);
    const x00 = n(0, 0, 0) + (n(1, 0, 0) - n(0, 0, 0)) * ux;
    const x10 = n(0, 1, 0) + (n(1, 1, 0) - n(0, 1, 0)) * ux;
    const x01 = n(0, 0, 1) + (n(1, 0, 1) - n(0, 0, 1)) * ux;
    const x11 = n(0, 1, 1) + (n(1, 1, 1) - n(0, 1, 1)) * ux;
    const y0v = x00 + (x10 - x00) * uy;
    const y1v = x01 + (x11 - x01) * uy;
    return y0v + (y1v - y0v) * uz;
}
function fbm3(px, py, pz, octaves = 5) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += amp * valueNoise3(px * freq, py * freq, pz * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
    }
    return sum / (norm || 1);
}
/**
 * Heavily deformed “asteroid”: base sphere + deep lobes + digs so it does
 * **not** read as a plain sphere (span ≫ small-sphere variation).
 */
function radiusAsteroid(x, y, z) {
    const len = hypot3(x, y, z);
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    // Low-frequency lobes (potato) + mid digs + high grit
    const lobe = 0.38 * fbm3(nx * 1.7 + 2.1, ny * 1.7 - 0.4, nz * 1.7 + 5.2, 4) +
        0.28 * fbm3(nx * 3.4 - 1.2, ny * 3.4 + 3.8, nz * 3.4, 3) +
        0.12 * fbm3(nx * 8.0, ny * 8.0, nz * 8.0, 2);
    // Directional gouge (crater-like flat)
    const crater = Math.max(0, nx * 0.55 + ny * 0.35 + 0.15);
    const dig = crater * crater * 0.42;
    // Spike / mountain
    const spike = Math.pow(Math.max(0, -nx * 0.4 + ny * 0.85 - 0.15), 2) * 0.35;
    let r = 0.48 + lobe * 0.55 + spike - dig;
    // Hard non-sphere floor/ceil
    r = Math.min(0.98, Math.max(0.12, r));
    return r;
}
/**
 * Disc impostor bound is the unit sphere / unit disc. Shells that reach r≈1
 * look “cut” by the circular limb. Keep max shell radius under this margin.
 */
export const SHAPE_FIT_RADIUS = 0.86;
/** 3D cross = union of three orthogonal boxes through origin.
 *  Arm length/thickness sized so arm-end corners stay ≤ SHAPE_FIT_RADIUS.
 *  (corner r = √(L²+2t²) ≤ 0.86 ⇒ L≈0.78, t≈0.15)
 */
const CROSS_ARM_LEN = 0.78;
const CROSS_ARM_HALF = 0.15;
function armRadius(ax, ay, az, along) {
    // Axis “along” has extent CROSS_ARM_LEN; other two have CROSS_ARM_HALF
    const comps = [Math.abs(ax), Math.abs(ay), Math.abs(az)];
    const alongC = comps[along];
    const b0 = comps[(along + 1) % 3];
    const b1 = comps[(along + 2) % 3];
    // r limited by cross-section and length
    let r = CROSS_ARM_LEN / Math.max(alongC, EPS);
    if (b0 > EPS)
        r = Math.min(r, CROSS_ARM_HALF / b0);
    if (b1 > EPS)
        r = Math.min(r, CROSS_ARM_HALF / b1);
    return r;
}
function radiusCross3d(x, y, z) {
    const len = hypot3(x, y, z);
    const ax = x / len;
    const ay = y / len;
    const az = z / len;
    const r = Math.max(armRadius(ax, ay, az, 0), armRadius(ax, ay, az, 1), armRadius(ax, ay, az, 2));
    // Never press against unit limb (would clip against disc edge)
    return Math.min(SHAPE_FIT_RADIUS, r);
}
/**
 * Classic algebraic heart, upright (+Y).
 * (x²+9/4 y²+z²−1)³ − x²z³ − 9/80 y²z³ ≤ 0
 *
 * The unscaled solid spills past the unit sphere (lobes cut by the disc).
 * We evaluate the field in a dilated coord frame (s > 1) so the physical shell
 * sits fully inside SHAPE_FIT_RADIUS with a visible margin to the billboard rim.
 */
const HEART_FIELD_SCALE = 1.55; // larger → smaller physical heart
function insideHeart(x, y, z) {
    // Rotate so heart stands upright (cleft toward +Y): classic (x, y_horiz, z_vert)
    // Map world (x,y,z) → formula (X, Y_horiz, Z_up) = (x, z, y)
    const s = HEART_FIELD_SCALE;
    const X = x * s;
    const Y = z * s;
    const Z = y * s;
    const a = X * X + (9 / 4) * Y * Y + Z * Z - 1;
    const f = a * a * a - X * X * Z * Z * Z - (9 / 80) * Y * Y * Z * Z * Z;
    return f <= 0;
}
function radiusHeart3d(x, y, z) {
    // Cap search to fit radius so a too-large solid cannot report r=1 (disc cut)
    return radialFromInside(x, y, z, insideHeart, SHAPE_FIT_RADIUS);
}
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const TEST_SHAPES = [
    {
        id: "cube",
        label: "cube",
        short: "Cube",
        radius: radiusCube,
        tint: [0.55, 0.62, 0.85],
    },
    {
        id: "pyramid",
        label: "pyramid",
        short: "Pyramid",
        radius: radiusPyramid,
        tint: [0.85, 0.7, 0.35],
    },
    {
        id: "smaller-sphere",
        label: "smaller sphere",
        short: "Small sphere",
        radius: radiusSmallerSphere,
        tint: [0.45, 0.75, 0.55],
    },
    {
        id: "asteroid",
        label: "asteroid",
        short: "Asteroid",
        radius: radiusAsteroid,
        tint: [0.62, 0.48, 0.38],
    },
    {
        id: "cross-3d",
        label: "3D cross",
        short: "3D cross",
        radius: radiusCross3d,
        tint: [0.75, 0.4, 0.55],
    },
    {
        id: "heart-3d",
        label: "3D heart",
        short: "3D heart",
        radius: radiusHeart3d,
        tint: [0.85, 0.28, 0.4],
    },
];
export function getTestShape(id) {
    const s = TEST_SHAPES.find((t) => t.id === id);
    if (!s)
        throw new Error(`Unknown test shape: ${id}`);
    return s;
}
/** Sample radial radius at equirect UV (same convention as heightfield). */
export function sampleShapeRadiusUV(shape, u, v) {
    const uu = ((u % 1) + 1) % 1;
    const vv = Math.min(1, Math.max(0, v));
    const phi = uu * Math.PI * 2;
    const theta = (1 - vv) * Math.PI;
    const st = Math.sin(theta);
    const x = st * Math.cos(phi);
    const y = Math.cos(theta);
    const z = st * Math.sin(phi);
    return shape.radius(x, y, z);
}
/**
 * Bake a float radius (= height when heightScale=1) atlas for a shape.
 * Smoke uses this for min/max/span and cross-shape difference.
 */
export function bakeShapeRadiusAtlas(shape, width = HEIGHT_TEX_SIZE, height = HEIGHT_TEX_SIZE) {
    const data = new Float32Array(width * height);
    let min = 1;
    let max = 0;
    let sum = 0;
    for (let y = 0; y < height; y++) {
        const v = y / (height - 1);
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const r = sampleShapeRadiusUV(shape, u, v);
            data[y * width + x] = r;
            if (r < min)
                min = r;
            if (r > max)
                max = r;
            sum += r;
        }
    }
    const n = width * height;
    return {
        id: shape.id,
        min,
        max,
        mean: sum / n,
        span: max - min,
        data,
        width,
        height,
    };
}
/** Mean absolute difference between two same-size radius atlases. */
export function meanAbsDiff(a, b) {
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++)
        s += Math.abs(a[i] - b[i]);
    return s / (n || 1);
}
function sampleGrit(u, v) {
    // Lightweight 2D grit for albedo (not shape)
    const n = Math.sin(u * 47.2 + v * 31.1) * Math.cos(u * 19.7 - v * 23.3) * 0.5 + 0.5;
    return n;
}
/**
 * Bake full SurfaceMaps for a hard test shape.
 * R/B height channels = radial radius; heightScale should be TEST_RUN_HEIGHT_SCALE (1).
 */
export function bakeShapeSurfaceMaps(shapeId, width = HEIGHT_TEX_SIZE, height = HEIGHT_TEX_SIZE) {
    const shape = getTestShape(shapeId);
    const stats = bakeShapeRadiusAtlas(shape, width, height);
    const heightFloat = stats.data;
    const parallaxFloat = heightFloat.slice();
    // Cone: local empty-space proxy from radius gradient (cheap, stable)
    const coneFloat = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const h0 = heightFloat[i];
            const x1 = (x + 1) % width;
            const y1 = Math.min(height - 1, y + 1);
            const dh = Math.abs(heightFloat[y * width + x1] - h0) +
                Math.abs(heightFloat[y1 * width + x] - h0);
            // Steep slopes → smaller cone step (more careful)
            coneFloat[i] = clamp01(0.15 + 0.85 * (1 - Math.min(1, dh * 8)));
        }
    }
    const albedo = new Uint8Array(width * height * 4);
    const normal = new Uint8Array(width * height * 4);
    const heightCone = new Uint8Array(width * height * 4);
    const [tr, tg, tb] = shape.tint;
    for (let y = 0; y < height; y++) {
        const v = y / (height - 1);
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const i = y * width + x;
            const h = heightFloat[i];
            const o = i * 4;
            const grit = sampleGrit(u * 3, v * 3);
            const shade = 0.55 + 0.45 * h;
            const g2 = 0.85 + 0.15 * grit;
            albedo[o] = Math.min(255, ((tr * shade * g2) * 255) | 0);
            albedo[o + 1] = Math.min(255, ((tg * shade * g2) * 255) | 0);
            albedo[o + 2] = Math.min(255, ((tb * shade * g2) * 255) | 0);
            albedo[o + 3] = 255;
            const n = heightToNormal(heightFloat, width, height, x, y, NORMAL_MAP_STRENGTH * 1.4);
            normal[o] = ((n.nx * 0.5 + 0.5) * 255) | 0;
            normal[o + 1] = ((n.ny * 0.5 + 0.5) * 255) | 0;
            normal[o + 2] = ((n.nz * 0.5 + 0.5) * 255) | 0;
            normal[o + 3] = 255;
            heightCone[o] = (h * 255) | 0;
            heightCone[o + 1] = (coneFloat[i] * 255) | 0;
            // B = parallax/radial height used by ray walkers
            heightCone[o + 2] = (h * 255) | 0;
            heightCone[o + 3] = 255;
        }
    }
    return {
        width,
        height,
        albedo,
        normal,
        heightCone,
        heightFloat,
        parallaxFloat,
        coneFloat,
        shapeId: shape.id,
        heightScale: TEST_RUN_HEIGHT_SCALE,
    };
}
//# sourceMappingURL=shapes.js.map