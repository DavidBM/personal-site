/**
 * Gas-giant banded / vortical flow field on equirect.
 *
 * Method (Astrographer / common gas-giant procedural practice):
 * 1. Latitude-stretched 3D noise: high frequency along polar axis (Y),
 *    low along equator plane → horizontal bands.
 * 2. Domain warp with anisotropic noise for swirl.
 * 3. Sparse storm cells (Great Red Spot style) via clamped low-freq peaks
 *    that locally re-warp and recolor.
 *
 * Also builds a UV velocity field for bake-time advection of baseline albedo
 * so painted/stamped colors are carried by currents and vortices.
 *
 * Output: flow scalar field [0,1] + storm mask + optional UV velocity.
 */
import { fbm3, valueNoise3, warpedFbm3 } from "./noise.js";
import { equirectToDir } from "./sphere-map.js";
import { allocateHeightMap } from "./heightfield.js";
export function generateGasField(seed, width, height, bandStrength, stormDensity, warp) {
    const flow = allocateHeightMap(width, height);
    const storms = allocateHeightMap(width, height);
    const s = seed | 0;
    const bands = Math.max(0, Math.min(2, bandStrength));
    const stormD = Math.max(0, Math.min(1, stormDensity));
    let fMin = Infinity;
    let fMax = -Infinity;
    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            const u = (x + 0.5) / width;
            const d = equirectToDir(u, v);
            // Stretch Y for banding: sample with anisotropic scale
            const bx = d.x * 1.2;
            const by = d.y * (2.5 + bands * 4); // more stretch → tighter bands
            const bz = d.z * 1.2;
            // Domain warp for swirl
            const wAmt = 0.15 + warp * 0.55;
            const wx = fbm3(bx * 0.8, by * 0.4, bz * 0.8, s + 11, 3) * wAmt;
            const wy = fbm3(bx * 0.8 + 4, by * 0.4, bz * 0.8 - 2, s + 22, 3) * wAmt * 0.35;
            const wz = fbm3(bx * 0.8 - 3, by * 0.4 + 1, bz * 0.8, s + 33, 3) * wAmt;
            let band = fbm3(bx + wx, by + wy, bz + wz, s, 5, 2.1, 0.55) * 0.5 + 0.5;
            // Extra latitude sine for classic striped giants
            const latStripe = 0.5 + 0.5 * Math.sin(d.y * Math.PI * (3 + bands * 5) + band * 2.5);
            band = band * (0.55 + 0.45 * bands) + latStripe * (0.45 * (1 - bands * 0.3));
            // Storm mask: sparse peaks mid-latitudes
            const stormNoise = valueNoise3(d.x * 2.5 + 10, d.y * 1.2, d.z * 2.5 - 7, s + 77);
            const midLat = 1 - Math.abs(d.y); // stronger off poles
            let storm = Math.max(0, stormNoise - (1 - stormD * 0.55)) * midLat;
            storm = Math.pow(storm * 2.2, 1.6);
            // Local vortex warp of band field
            if (storm > 0.02) {
                const vortex = Math.atan2(d.z, d.x) * storm * 3;
                const vx = Math.cos(vortex) * storm * 0.25;
                const vz = Math.sin(vortex) * storm * 0.25;
                const swirl = warpedFbm3(d.x + vx, d.y, d.z + vz, s + 90, 4, 0.4, 2.5) * 0.5 +
                    0.5;
                band = band * (1 - storm * 0.7) + swirl * storm * 0.7 + storm * 0.15;
            }
            const i = y * width + x;
            flow.data[i] = band;
            storms.data[i] = Math.min(1, storm);
            if (band < fMin)
                fMin = band;
            if (band > fMax)
                fMax = band;
        }
    }
    const span = Math.max(1e-8, fMax - fMin);
    for (let i = 0; i < flow.data.length; i++) {
        flow.data[i] = (flow.data[i] - fMin) / span;
    }
    return { flow, storms };
}
/**
 * Sphere-surface velocity in equirect UV texels: zonal jets + vortex swirl.
 * Pure — same seed/params → same field. Res-scalable for iteration vs quality.
 */
export function generateGasVelocityField(seed, width, height, bandStrength, stormDensity, warp) {
    const w = Math.max(8, width | 0);
    const h = Math.max(4, height | 0);
    const du = new Float32Array(w * h);
    const dv = new Float32Array(w * h);
    const s = seed | 0;
    const bands = Math.max(0, Math.min(2, bandStrength));
    const stormD = Math.max(0, Math.min(1, stormDensity));
    const wAmt = 0.15 + warp * 0.55;
    // Sparse vortex seeds (deterministic from hash, not RNG stream)
    const nVort = 4 + ((s >>> 3) % 5);
    const vortices = [];
    for (let vi = 0; vi < nVort; vi++) {
        const n1 = valueNoise3(vi * 1.7 + 2, s * 0.01, vi * 0.3, s + 200 + vi);
        const n2 = valueNoise3(vi * 2.1 - 1, s * 0.02 + 3, vi * 0.5, s + 300 + vi);
        const lat = (n1 * 2 - 1) * 0.65; // mid-lat bias
        const lon = n2 * Math.PI * 2;
        const cl = Math.cos(lat);
        vortices.push({
            cx: cl * Math.cos(lon),
            cy: Math.sin(lat),
            cz: cl * Math.sin(lon),
            str: 0.5 + valueNoise3(vi, 4, s, s + 400 + vi) * 0.6,
            rad: 0.12 + valueNoise3(vi, 7, s, s + 500 + vi) * 0.2,
        });
    }
    for (let y = 0; y < h; y++) {
        const v = (y + 0.5) / h;
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            const d = equirectToDir(u, v);
            // Local east / north on sphere (tangent)
            // e_lon ~ (-sin lon * cl, 0, cos lon * cl) but from dir:
            const lon = Math.atan2(d.z, d.x);
            const cl = Math.max(1e-4, Math.hypot(d.x, d.z));
            let elx = -d.z / cl;
            let ely = 0;
            let elz = d.x / cl;
            // e_lat = n × e_lon? north = cross(e_lon? actually ∂pos/∂lat)
            // pos = (cl cos lon, sin lat, cl sin lon); e_lat = (-sl cos lon, cl, -sl sin lon)
            const sl = d.y;
            let nlx = -sl * (d.x / cl);
            let nly = cl;
            let nlz = -sl * (d.z / cl);
            const nlen = Math.hypot(nlx, nly, nlz) || 1;
            nlx /= nlen;
            nly /= nlen;
            nlz /= nlen;
            // Zonal jet (eastward) modulated by lat
            const jetN = 3 + (s % 5);
            const phase = (s * 0.37) % (Math.PI * 2);
            let jet = Math.sin(d.y * jetN * 2 + phase) *
                (0.55 + 0.45 * Math.cos(d.y * 2.2)) *
                Math.pow(cl, 1.1);
            jet *= 0.75 + 0.35 * fbm3(d.x * 2, d.y, d.z * 2, s + 11, 3) * wAmt;
            // mild meridional meander
            const mer = 0.12 *
                Math.sin(lon * (2 + (s % 3)) + d.y * 4 + s * 0.2) *
                cl *
                (0.5 + bands * 0.25);
            let vx = jet * elx + mer * nlx;
            let vy = jet * ely + mer * nly;
            let vz = jet * elz + mer * nlz;
            // Vortex swirl (ω × r) with stormDensity
            for (let vi = 0; vi < vortices.length; vi++) {
                const vo = vortices[vi];
                const dot = d.x * vo.cx + d.y * vo.cy + d.z * vo.cz;
                const dist = Math.acos(Math.max(-1, Math.min(1, dot)));
                const fall = Math.exp(-((dist / vo.rad) ** 2)) * vo.str * (0.5 + stormD);
                // ω = center, v = ω × pos
                let sx = (vo.cy * d.z - vo.cz * d.y) * fall;
                let sy = (vo.cz * d.x - vo.cx * d.z) * fall;
                let sz = (vo.cx * d.y - vo.cy * d.x) * fall;
                const rad = sx * d.x + sy * d.y + sz * d.z;
                sx -= rad * d.x;
                sy -= rad * d.y;
                sz -= rad * d.z;
                vx += sx;
                vy += sy;
                vz += sz;
            }
            // Project 3D tangent vel into UV: move along e_lon → du, e_lat → -dv
            // (v increases southward in equirect)
            const vLon = vx * elx + vy * ely + vz * elz;
            const vLat = vx * nlx + vy * nly + vz * nlz;
            // Vel-grid texels/step. Physical UV step = du/w, dv/h (see advect).
            // Scaling by w/h here so denser sims keep the same UV motion for same vLon.
            const i = y * w + x;
            // Stronger jets so bake advection is visible over base paint
            du[i] = vLon * w * 0.0065;
            dv[i] = -vLat * h * 0.0065;
        }
    }
    return { width: w, height: h, du, dv };
}
/**
 * Semi-Lagrangian advection of RGBA equirect by gas UV velocity.
 * Mutates `rgba` in place. Pure aside from buffer mutation.
 * Returns mean absolute RGB delta (for tests / logs).
 */
export function advectAlbedoByGasVelocity(rgba, width, height, vel, steps, strength = 1) {
    const W = width | 0;
    const H = height | 0;
    const nSteps = Math.max(0, Math.min(64, Math.floor(steps)));
    if (nSteps === 0 || W < 2 || H < 2)
        return 0;
    const str = Math.max(0, Math.min(2, strength));
    const N = W * H * 4;
    const src = new Uint8Array(N);
    src.set(rgba.subarray(0, N));
    const dst = new Uint8Array(N);
    const sample = (buf, uf, vf, out) => {
        let u = uf % 1;
        if (u < 0)
            u += 1;
        const v = Math.max(0, Math.min(1 - 1e-6, vf));
        const x = u * W - 0.5;
        const y = v * H - 0.5;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const x1 = x0 + 1;
        const y1 = Math.min(H - 1, y0 + 1);
        const y0c = Math.max(0, Math.min(H - 1, y0));
        const wrap = (xi) => ((xi % W) + W) % W;
        const idx = (xi, yi) => (yi * W + wrap(xi)) * 4;
        const i00 = idx(x0, y0c);
        const i10 = idx(x1, y0c);
        const i01 = idx(x0, y1);
        const i11 = idx(x1, y1);
        for (let c = 0; c < 4; c++) {
            const a = buf[i00 + c] * (1 - fx) + buf[i10 + c] * fx;
            const b = buf[i01 + c] * (1 - fx) + buf[i11 + c] * fx;
            out[c] = a * (1 - fy) + b * fy;
        }
    };
    const sampleVel = (uf, vf) => {
        // Nearest on velocity grid (may differ res)
        let u = uf % 1;
        if (u < 0)
            u += 1;
        const v = Math.max(0, Math.min(1 - 1e-6, vf));
        const vx = Math.min(vel.width - 1, Math.floor(u * vel.width));
        const vy = Math.min(vel.height - 1, Math.floor(v * vel.height));
        const i = vy * vel.width + vx;
        return { du: vel.du[i] * str, dv: vel.dv[i] * str };
    };
    const tmp = [0, 0, 0, 0];
    let cur = src;
    let next = dst;
    for (let step = 0; step < nSteps; step++) {
        for (let y = 0; y < H; y++) {
            const v0 = (y + 0.5) / H;
            for (let x = 0; x < W; x++) {
                const u0 = (x + 0.5) / W;
                // backtrace in UV: vel is in sim-grid texels, not albedo texels
                const vel0 = sampleVel(u0, v0);
                const uB = u0 - vel0.du / vel.width;
                const vB = v0 - vel0.dv / vel.height;
                sample(cur, uB, vB, tmp);
                const o = (y * W + x) * 4;
                next[o] = tmp[0] | 0;
                next[o + 1] = tmp[1] | 0;
                next[o + 2] = tmp[2] | 0;
                next[o + 3] = tmp[3] | 0;
            }
        }
        const t = cur;
        cur = next;
        next = t;
    }
    // rgba is still pre-advection original; cur is the final frame.
    const nPix = W * H;
    let sum = 0;
    for (let p = 0; p < nPix; p++) {
        const o = p * 4;
        sum +=
            Math.abs(cur[o] - rgba[o]) +
                Math.abs(cur[o + 1] - rgba[o + 1]) +
                Math.abs(cur[o + 2] - rgba[o + 2]);
    }
    for (let i = 0; i < N; i++) {
        rgba[i] = cur[i];
    }
    return sum / (nPix * 3);
}
//# sourceMappingURL=gas-flow.js.map