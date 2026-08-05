/**
 * Approximate land-driven wind field for cloud stamp steering.
 *
 * Inspired by Mapbox webgl-wind (velocity texture → particles), but the field
 * here is **procedural from land/ocean/height**, not GFS tiles.
 *
 * Approximation (stable, not a GCM):
 * 1. Latitude base jets (easterlies tropics / westerlies mid-lat).
 * 2. Land–sea breeze from liquid-mask gradient (coast-normal flow).
 * 3. Orographic deflection from height gradient (flow turns along slopes).
 * 4. Mild 3D noise swirl for regional variation.
 * 5. Vorticity = finite-difference curl of the equirect velocity (turn score).
 *
 * Cloud policy (see pickCloudCategoryFromWind):
 * - low speed → spread-out-small-cluster-of-clouds | huge-clouds
 * - high speed + low turn → long-and-sharp
 * - high vorticity/turn → cyclones | unique-shapes
 */
import { fbm3 } from "./noise.js";
import { equirectToDir } from "./sphere-map.js";
/** Below this → prefer scattered small clusters. */
export const WIND_SPEED_LOW = 0.34;
/** Above this + low turn → prefer long-and-sharp. */
export const WIND_SPEED_HIGH = 0.52;
/** Above this → prefer cyclones / unique-shapes; suppress long stretch. */
export const WIND_VORTICITY_HIGH = 0.42;
/** Max additional yaw (rad) allowed when bending long-and-sharp. */
export const WIND_LONG_MAX_BEND = 0.32;
function sampleMaskR(rgba, mw, mh, u, v) {
    if (!rgba || mw < 1 || mh < 1)
        return 0.5;
    const x = ((u % 1) + 1) % 1;
    const y = Math.max(0, Math.min(1, v));
    const fx = x * mw - 0.5;
    const fy = y * mh - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (ix, iy) => {
        const xx = ((ix % mw) + mw) % mw;
        const yy = Math.max(0, Math.min(mh - 1, iy));
        return rgba[(yy * mw + xx) * 4] / 255;
    };
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return a * (1 - ty) + b * ty;
}
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
/**
 * Build a seedable equirect wind field from optional land/ocean/height.
 * Pure: no GPU, no DOM.
 */
export function buildLandWindField(input) {
    const W = Math.max(8, input.width | 0);
    const H = Math.max(4, input.height | 0);
    const seed = input.seed | 0;
    const n = W * H;
    const speed = new Float32Array(n);
    const dirEast = new Float32Array(n);
    const dirNorth = new Float32Array(n);
    const vorticity = new Float32Array(n);
    const liq = input.liquidRgba ?? null;
    const lW = input.liquidW ?? W;
    const lH = input.liquidH ?? H;
    const hgt = input.heightRgba ?? null;
    const hW = input.heightW ?? W;
    const hH = input.heightH ?? H;
    // Pass 1: velocity components (east, north) in tangent frame
    const ve = new Float32Array(n);
    const vn = new Float32Array(n);
    for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        // lat ∈ [-π/2, π/2]
        const lat = Math.PI * (0.5 - v);
        const cosLat = Math.max(0.12, Math.cos(lat));
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W;
            const i = y * W + x;
            const d = equirectToDir(u, v);
            // --- 1) Latitude jets (Hadley / Ferrel sketch) ---
            // Easterlies near equator, westerlies mid-lat, weak poles
            let e = -0.55 * Math.cos(lat * 2.2) * (1 - Math.abs(lat) / (Math.PI * 0.5) * 0.35);
            let nComp = 0.12 * Math.sin(lat * 3.1) * cosLat;
            // --- 2) Land–sea breeze from ocean mask gradient ---
            const ocean = sampleMaskR(liq, lW, lH, u, v);
            const du = 1.5 / W;
            const dv = 1.5 / H;
            const oE = sampleMaskR(liq, lW, lH, u + du, v);
            const oW = sampleMaskR(liq, lW, lH, u - du, v);
            const oN = sampleMaskR(liq, lW, lH, u, v - dv);
            const oS = sampleMaskR(liq, lW, lH, u, v + dv);
            // grad(ocean): points toward more ocean → breeze from sea to land = -grad
            const gOu = (oE - oW) * 0.5;
            const gOv = (oS - oN) * 0.5;
            const breeze = 0.85;
            e += -gOu * breeze;
            nComp += -gOv * breeze;
            // --- 3) Orographic deflection from height gradient ---
            const hC = sampleMaskR(hgt, hW, hH, u, v);
            const hE = sampleMaskR(hgt, hW, hH, u + du, v);
            const hWgt = sampleMaskR(hgt, hW, hH, u - du, v);
            const hN = sampleMaskR(hgt, hW, hH, u, v - dv);
            const hS = sampleMaskR(hgt, hW, hH, u, v + dv);
            const gHu = (hE - hWgt) * 0.5;
            const gHv = (hS - hN) * 0.5;
            // Flow tends to turn around high terrain: rotate grad 90°
            const oro = 0.55 * (0.35 + hC);
            e += -gHv * oro;
            nComp += gHu * oro;
            // --- 4) Mild noise swirl (regional weather) ---
            const nsw = fbm3(d.x * 1.8, d.y * 1.4, d.z * 1.8, seed + 91, 3) * 0.28;
            const nsn = fbm3(d.x * 1.8 + 3, d.y * 1.4, d.z * 1.8 - 2, seed + 17, 3) * 0.22;
            e += nsw;
            nComp += nsn;
            // Land slows mean wind slightly (roughness)
            const land = 1 - ocean;
            const rough = 1 - land * 0.28;
            e *= rough;
            nComp *= rough;
            ve[i] = e;
            vn[i] = nComp;
        }
    }
    // Pass 2: speed, normalize dir, vorticity (curl ∂vn/∂u − ∂ve/∂v) scaled
    let maxSp = 1e-6;
    let maxVo = 1e-6;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const e = ve[i];
            const nn = vn[i];
            const sp = Math.hypot(e, nn);
            speed[i] = sp;
            if (sp > maxSp)
                maxSp = sp;
            if (sp > 1e-6) {
                dirEast[i] = e / sp;
                dirNorth[i] = nn / sp;
            }
            else {
                dirEast[i] = 1;
                dirNorth[i] = 0;
            }
            const eE = ve[y * W + ((x + 1) % W)];
            const eW = ve[y * W + ((x - 1 + W) % W)];
            const nN = vn[Math.max(0, y - 1) * W + x];
            const nS = vn[Math.min(H - 1, y + 1) * W + x];
            // curl in equirect (not sphere-metric exact — good enough turn score)
            const curl = (eE - eW) * 0.5 - (nS - nN) * 0.5;
            const vo = Math.abs(curl);
            vorticity[i] = vo;
            if (vo > maxVo)
                maxVo = vo;
        }
    }
    for (let i = 0; i < n; i++) {
        speed[i] = clamp01(speed[i] / maxSp);
        vorticity[i] = clamp01(vorticity[i] / maxVo);
    }
    return { width: W, height: H, speed, dirEast, dirNorth, vorticity };
}
/** Bilinear sample of a built wind field at equirect u,v ∈ [0,1]. */
export function sampleWindField(field, u, v) {
    const W = field.width;
    const H = field.height;
    const x = ((((u % 1) + 1) % 1) * W - 0.5);
    const y = Math.max(0, Math.min(H - 1, v * H - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const at = (arr, ix, iy) => {
        const xx = ((ix % W) + W) % W;
        const yy = Math.max(0, Math.min(H - 1, iy));
        return arr[yy * W + xx];
    };
    const bilerp = (arr) => {
        const a = at(arr, x0, y0) * (1 - tx) + at(arr, x0 + 1, y0) * tx;
        const b = at(arr, x0, y0 + 1) * (1 - tx) + at(arr, x0 + 1, y0 + 1) * tx;
        return a * (1 - ty) + b * ty;
    };
    const sp = bilerp(field.speed);
    let de = bilerp(field.dirEast);
    let dn = bilerp(field.dirNorth);
    const len = Math.hypot(de, dn) || 1;
    de /= len;
    dn /= len;
    const vo = bilerp(field.vorticity);
    return {
        speed: clamp01(sp),
        dirEast: de,
        dirNorth: dn,
        angle: Math.atan2(dn, de),
        vorticity: clamp01(vo),
    };
}
/**
 * Map a wind sample to a cloud bank category + orientation policy.
 * Pure — used by stamp placement and unit tests.
 */
export function pickCloudCategoryFromWind(w) {
    const highTurn = w.vorticity >= WIND_VORTICITY_HIGH;
    const highSpeed = w.speed >= WIND_SPEED_HIGH;
    const lowSpeed = w.speed <= WIND_SPEED_LOW;
    if (highTurn) {
        // Strong shear / curl → cyclones or unique shapes (not long streaks)
        const useCyclone = w.vorticity > 0.62 || w.speed < 0.45;
        return {
            category: useCyclone ? "cyclones" : "unique-shapes",
            suppressLong: true,
            maxBend: 0,
            freeSpin: true,
        };
    }
    if (highSpeed && !highTurn) {
        return {
            category: "long-and-sharp",
            suppressLong: false,
            maxBend: WIND_LONG_MAX_BEND * Math.min(1, w.vorticity / WIND_VORTICITY_HIGH),
            freeSpin: false,
        };
    }
    if (lowSpeed) {
        // Calm cells: sparse clusters, with a share of soft huge haze decks
        // (hash on speed/vorticity — pure, no extra RNG)
        const useHuge = w.speed < 0.18 && (w.speed * 17.3 + w.vorticity * 11.1) % 1 < 0.35;
        return {
            category: useHuge
                ? "huge-clouds"
                : "spread-out-small-cluster-of-clouds",
            suppressLong: false,
            maxBend: 0.15,
            freeSpin: false,
        };
    }
    // Moderate speed / turn → mixed decks; mild calm-adjacent → occasional huge
    const useHugeMod = w.speed < 0.38 && (w.speed * 13.7 + w.vorticity * 9.3) % 1 < 0.12;
    return {
        category: useHugeMod ? "huge-clouds" : "mixed",
        suppressLong: false,
        maxBend: 0.4 * (w.vorticity / Math.max(1e-4, WIND_VORTICITY_HIGH)),
        freeSpin: false,
    };
}
/**
 * Mild yaw for long-and-sharp: align to wind, optional small bend if turn moderate.
 * Returns final stamp yaw in radians (tangent-plane).
 */
export function longStampYawFromWind(w, maxBend) {
    const base = w.angle;
    if (maxBend <= 1e-4 || w.vorticity < 0.08)
        return base;
    // Bend proportional to vorticity but clamped
    const bend = Math.max(-maxBend, Math.min(maxBend, (w.vorticity - 0.08) * 0.55));
    // Sign from curl proxy: use dirNorth * dirEast imbalance as weak chirality
    const sign = w.dirEast * w.dirNorth >= 0 ? 1 : -1;
    return base + bend * sign;
}
//# sourceMappingURL=wind-field.js.map