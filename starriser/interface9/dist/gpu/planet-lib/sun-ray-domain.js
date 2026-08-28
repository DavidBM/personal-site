/**
 * Pure corona limb-direction domain + streamer field (unit-testable).
 *
 * Streamer intensity is a function of the **body-frame limb direction**:
 * the sky-plane azimuth of a disc fragment, rotated into the sun body frame
 * (same inverse spin/obliquity as photosphere nBody).
 *
 * Angular structure is a **seamless soft-fade sphere field**: wide body-frame
 * cones + continuous noise base — NOT multi-lobe sin(k · bodyLongitude) and
 * not footpoint ribbons. Longitude lobes compress under pitch; hard needles
 * pop when the limb sweeps an axis; soft-fade keeps angular energy continuous.
 *
 * Properties:
 *  - Disc-centered: collinear locals (same spoke) → same edgeBody
 *  - Orbit-sensitive: camera right/up change → different edgeBody at fixed local
 *  - Pitch-stable: equal disc azimuth steps do not map to bunched longitudes
 *  - Soft-fade: mean/max and coverage stay high (energy not only needle spikes)
 *  - Never body-plane projection of the sphere normal (bodyDir2 / bodyPlaneDirXZ)
 *
 * Match sun-impostor.wgsl.ts: rotateX(-obl) then rotateY(-spin).
 */
export function rotateX(v, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return {
        x: v.x,
        y: c * v.y - s * v.z,
        z: s * v.y + c * v.z,
    };
}
export function rotateY(v, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return {
        x: c * v.x + s * v.z,
        y: v.y,
        z: -s * v.x + c * v.z,
    };
}
function normalize3(v) {
    const len = Math.hypot(v.x, v.y, v.z);
    if (!(len > 1e-12))
        return { x: 1, y: 0, z: 0 };
    const inv = 1 / len;
    return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
}
function dot3(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
/**
 * Edge direction in world: pure sky-plane from disc center (perpendicular to view).
 * Unit local when r > 0; fallback camRight when r ≈ 0.
 */
export function limbDirWorld(localX, localY, camRight, camUp) {
    const r = Math.hypot(localX, localY);
    const invR = r > 1e-6 ? 1 / r : 0;
    const lx = r > 1e-6 ? localX * invR : 1;
    const ly = r > 1e-6 ? localY * invR : 0;
    return normalize3({
        x: camRight.x * lx + camUp.x * ly,
        y: camRight.y * lx + camUp.y * ly,
        z: camRight.z * lx + camUp.z * ly,
    });
}
/**
 * Body-frame limb dir for corona angular sampling.
 * Matches WGSL coronaLimbDirBody: rotateX(-obl) then rotateY(-spin).
 */
export function coronaLimbDirBody(localX, localY, camRight, camUp, spin, obl) {
    const edgeWorld = limbDirWorld(localX, localY, camRight, camUp);
    let edgeBody = rotateX(edgeWorld, -obl);
    edgeBody = rotateY(edgeBody, -spin);
    return normalize3(edgeBody);
}
/** Two collinear locals (same radial spoke) share the same body-frame limb dir. */
export function isDiscCenteredSpoke(localAx, localAy, localBx, localBy, camRight, camUp, spin, obl, eps = 1e-5) {
    const a = coronaLimbDirBody(localAx, localAy, camRight, camUp, spin, obl);
    const b = coronaLimbDirBody(localBx, localBy, camRight, camUp, spin, obl);
    const d = a.x * b.x + a.y * b.y + a.z * b.z;
    return Math.abs(d - 1) <= eps;
}
/**
 * Body-plane projection of a 3D unit vector onto XZ (the broken corona path).
 * Exposed only so tests prove it is **not** the limb domain.
 */
export function bodyPlaneDirXZ(nx, ny, nz) {
    const len2 = nx * nx + nz * nz;
    if (len2 > 1e-12) {
        const inv = 1 / Math.sqrt(len2);
        return { x: nx * inv, y: nz * inv };
    }
    const l2 = Math.max(nx * nx + ny * ny, 1e-12);
    const inv = 1 / Math.sqrt(l2);
    return { x: nx * inv, y: ny * inv };
}
/** Body longitude in (−π, π] — the broken primary angular coordinate. */
export function bodyLongitude(dir) {
    return Math.atan2(dir.z, dir.x);
}
/**
 * Coefficient of variation of consecutive body-longitude steps around the disc.
 * High values ⇒ longitudes bunch vs equal screen azimuth (pitch compression of
 * any field that uses lon as multi-lobe phase).
 */
export function longitudeStepCv(camRight, camUp, spin, obl, n = 128) {
    const lons = [];
    for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const d = coronaLimbDirBody(Math.cos(th), Math.sin(th), camRight, camUp, spin, obl);
        lons.push(bodyLongitude(d));
    }
    const steps = [];
    for (let i = 0; i < n; i++) {
        let d = lons[(i + 1) % n] - lons[i];
        while (d > Math.PI)
            d -= Math.PI * 2;
        while (d < -Math.PI)
            d += Math.PI * 2;
        steps.push(Math.abs(d));
    }
    const mean = steps.reduce((a, b) => a + b, 0) / n;
    let acc = 0;
    for (const s of steps)
        acc += (s - mean) * (s - mean);
    const std = Math.sqrt(acc / n);
    return std / Math.max(mean, 1e-12);
}
/**
 * Broken reference field: multi-lobe sin(k · bodyLongitude).
 * Used only to prove pitch compression of the old angular domain.
 */
export function streamerIntensityLonLobes(dir, time = 0) {
    const a = bodyLongitude(dir);
    const elevW = 0.75 + 0.25 * (1 - dir.y * dir.y);
    const lobes = 0.55 * Math.pow(Math.max(0.5 + 0.5 * Math.sin(a * 3 + time * 0.11), 0), 3) +
        0.35 *
            Math.pow(Math.max(0.5 + 0.5 * Math.sin(a * 7 - time * 0.07 + 1.3), 0), 4.5) +
        0.22 *
            Math.pow(Math.max(0.5 + 0.5 * Math.sin(a * 13 + time * 0.15 + 0.4), 0), 6) +
        0.12 * Math.pow(Math.max(0.5 + 0.5 * Math.sin(a * 23 - time * 0.09), 0), 8);
    return Math.min(2.2, Math.max(0, lobes * elevW));
}
/** fract for pure noise (match WGSL). */
function fract(x) {
    return x - Math.floor(x);
}
/** Match WGSL hash31. */
function hash31(px, py, pz) {
    let x = fract(px * 0.1031);
    let y = fract(py * 0.1031);
    let z = fract(pz * 0.1031);
    const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
    x = fract(x + d);
    y = fract(y + d);
    z = fract(z + d);
    return fract((x + y) * z);
}
/** Match WGSL noise3 (value noise). */
function noise3(p) {
    const ix = Math.floor(p.x);
    const iy = Math.floor(p.y);
    const iz = Math.floor(p.z);
    const fx = p.x - ix;
    const fy = p.y - iy;
    const fz = p.z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const n000 = hash31(ix, iy, iz);
    const n100 = hash31(ix + 1, iy, iz);
    const n010 = hash31(ix, iy + 1, iz);
    const n110 = hash31(ix + 1, iy + 1, iz);
    const n001 = hash31(ix, iy, iz + 1);
    const n101 = hash31(ix + 1, iy, iz + 1);
    const n011 = hash31(ix, iy + 1, iz + 1);
    const n111 = hash31(ix + 1, iy + 1, iz + 1);
    const nx00 = n000 * (1 - ux) + n100 * ux;
    const nx10 = n010 * (1 - ux) + n110 * ux;
    const nx01 = n001 * (1 - ux) + n101 * ux;
    const nx11 = n011 * (1 - ux) + n111 * ux;
    const nxy0 = nx00 * (1 - uy) + nx10 * uy;
    const nxy1 = nx01 * (1 - uy) + nx11 * uy;
    return nxy0 * (1 - uz) + nxy1 * uz;
}
function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
/**
 * Pre-soft hard-needle reference (high cone powers, no continuous veil).
 * Used only to prove soft-fade has higher angular continuity.
 */
export function streamerIntensitySphereHard(dir, time = 0) {
    const tw = time * 0.08;
    const c0 = Math.cos(tw * 0.11);
    const s0 = Math.sin(tw * 0.11);
    const c1 = Math.cos(tw * 0.07 + 2.094);
    const s1 = Math.sin(tw * 0.07 + 2.094);
    const ax0 = normalize3({ x: c0, y: 0.22, z: s0 });
    const ax1 = normalize3({ x: c1, y: -0.18, z: s1 });
    let lobes = 0;
    lobes += 0.55 * Math.pow(Math.max(dot3(dir, ax0), 0), 10);
    lobes += 0.45 * Math.pow(Math.max(dot3(dir, ax1), 0), 14);
    lobes += 0.4 * Math.pow(Math.max(dot3(dir, { x: -ax0.x, y: -ax0.y, z: -ax0.z }), 0), 11);
    lobes += 0.3 * Math.pow(Math.max(dot3(dir, { x: -ax1.x, y: -ax1.y, z: -ax1.z }), 0), 13);
    const elevW = 0.78 + 0.22 * (1 - dir.y * dir.y);
    return Math.min(2.2, Math.max(0, lobes * elevW));
}
/**
 * Shipped soft-fade streamer field (matches WGSL angularRays3d spirit):
 * wide body-frame cones + continuous sphere-noise veil. No longitude.
 */
export function streamerIntensitySphere(dir, time = 0) {
    const tw = time * 0.045;
    const c0 = Math.cos(tw * 0.11);
    const s0 = Math.sin(tw * 0.11);
    const c1 = Math.cos(tw * 0.07 + 2.094);
    const s1 = Math.sin(tw * 0.07 + 2.094);
    const c2 = Math.cos(tw * 0.13 + 4.189);
    const s2 = Math.sin(tw * 0.13 + 4.189);
    const c3 = Math.cos(tw * 0.09 + 1.0);
    const s3 = Math.sin(tw * 0.09 + 1.0);
    const c4 = Math.cos(tw * 0.05 + 3.4);
    const s4 = Math.sin(tw * 0.05 + 3.4);
    const ax0 = normalize3({ x: c0, y: 0.22, z: s0 });
    const ax1 = normalize3({ x: c1, y: -0.18, z: s1 });
    const ax2 = normalize3({ x: c2, y: 0.35, z: s2 });
    const ax3 = normalize3({ x: s0 * 0.7, y: 0.55, z: c0 * 0.7 });
    const ax4 = normalize3({ x: c3 * 0.55, y: -0.48, z: s3 * 0.55 });
    const ax5 = normalize3({ x: s1 * 0.6, y: 0.12, z: c1 * 0.6 });
    const ax6 = normalize3({ x: c4, y: 0.08, z: s4 });
    const ax7 = normalize3({ x: s2 * 0.5, y: -0.62, z: c2 * 0.5 });
    let lobes = 0;
    // Wide soft cones (low powers) — match WGSL soft-fade
    lobes += 0.5 * Math.pow(Math.max(dot3(dir, ax0), 0), 3.5);
    lobes += 0.42 * Math.pow(Math.max(dot3(dir, ax1), 0), 4.0);
    lobes += 0.38 * Math.pow(Math.max(dot3(dir, ax2), 0), 3.8);
    lobes += 0.32 * Math.pow(Math.max(dot3(dir, ax3), 0), 4.2);
    lobes += 0.3 * Math.pow(Math.max(dot3(dir, ax4), 0), 4.0);
    lobes += 0.28 * Math.pow(Math.max(dot3(dir, ax5), 0), 3.6);
    lobes += 0.26 * Math.pow(Math.max(dot3(dir, ax6), 0), 3.5);
    lobes += 0.24 * Math.pow(Math.max(dot3(dir, ax7), 0), 4.5);
    lobes += 0.38 * Math.pow(Math.max(dot3(dir, { x: -ax0.x, y: -ax0.y, z: -ax0.z }), 0), 3.6);
    lobes += 0.3 * Math.pow(Math.max(dot3(dir, { x: -ax1.x, y: -ax1.y, z: -ax1.z }), 0), 4.0);
    lobes += 0.24 * Math.pow(Math.max(dot3(dir, { x: -ax2.x, y: -ax2.y, z: -ax2.z }), 0), 4.2);
    lobes += 0.22 * Math.pow(Math.max(dot3(dir, { x: -ax5.x, y: -ax5.y, z: -ax5.z }), 0), 3.8);
    lobes += 0.2 * Math.pow(Math.max(dot3(dir, { x: -ax6.x, y: -ax6.y, z: -ax6.z }), 0), 3.5);
    const nBase = noise3({
        x: dir.x * 2.6 + time * 0.03,
        y: dir.y * 2.6 + 0.4,
        z: dir.z * 2.6 + time * 0.02,
    });
    const nMid = noise3({
        x: dir.x * 5.5 + time * 0.04,
        y: dir.y * 5.5 - 0.2,
        z: dir.z * 5.5 + 1.1,
    });
    const nFine = noise3({
        x: dir.x * 11.0 - time * 0.08,
        y: dir.y * 11.0 + time * 0.03,
        z: dir.z * 11.0 + 1.7,
    });
    const veil = 0.22 * smoothstep(0.28, 0.72, nBase) +
        0.16 * smoothstep(0.35, 0.78, nMid) +
        0.1 * Math.pow(Math.max(nFine * nMid, 0), 2.2);
    const elevW = 0.8 + 0.2 * (1 - dir.y * dir.y);
    let m = lobes * elevW * (0.55 + 0.55 * nMid);
    m += veil * elevW;
    m += lobes * Math.pow(Math.max(nFine, 0), 2.5) * 0.28;
    m += Math.pow(Math.max(nFine * nBase, 0), 2.8) * 0.18 * elevW;
    return Math.min(2.2, Math.max(0, m));
}
/** mean(I) / max(I) — higher ⇒ energy spread, not only needle spikes. */
export function intensityMeanMaxRatio(samples) {
    if (samples.length === 0)
        return 0;
    let maxV = 0;
    let sum = 0;
    for (const s of samples) {
        const v = Math.max(s, 0);
        sum += v;
        if (v > maxV)
            maxV = v;
    }
    if (!(maxV > 1e-12))
        return 0;
    return sum / samples.length / maxV;
}
/**
 * Fraction of samples ≥ threshRel · max(I).
 * Soft-fade should keep a large fraction of the limb above a low threshold.
 */
export function intensityCoverageFraction(samples, threshRel = 0.12) {
    if (samples.length === 0)
        return 0;
    let maxV = 0;
    for (const s of samples)
        if (s > maxV)
            maxV = s;
    if (!(maxV > 1e-12))
        return 0;
    const thr = maxV * threshRel;
    let n = 0;
    for (const s of samples)
        if (s >= thr)
            n++;
    return n / samples.length;
}
/**
 * Max |ΔI| at a fixed disc local across small orbit steps of cam axes.
 * Soft field should change gradually (relative step << full range).
 */
export function orbitStepMaxDelta(field, localX, localY, spin, obl, yawSteps = [0, 0.08, 0.16, 0.24, 0.32]) {
    const vals = [];
    for (const yaw of yawSteps) {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        // Yaw cam around world Y: right = (c,0,-s), up = (0,1,0)
        const camRight = { x: c, y: 0, z: -s };
        const camUp = { x: 0, y: 1, z: 0 };
        const d = coronaLimbDirBody(localX, localY, camRight, camUp, spin, obl);
        vals.push(field(d));
    }
    let maxD = 0;
    for (let i = 1; i < vals.length; i++) {
        const d = Math.abs(vals[i] - vals[i - 1]);
        if (d > maxD)
            maxD = d;
    }
    return maxD;
}
/** Sample a limb scalar field at N equal disc azimuths. */
export function sampleDiscField(field, camRight, camUp, spin, obl, n = 128) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const d = coronaLimbDirBody(Math.cos(th), Math.sin(th), camRight, camUp, spin, obl);
        out.push(field(d));
    }
    return out;
}
/**
 * |Σ I e^{iθ} / Σ I| — 0 ≈ even around the disc, 1 ≈ all mass on one side.
 * Useful to detect pathological collapse under pitch.
 */
export function intensityCircularConcentration(samples) {
    const n = samples.length;
    if (n < 2)
        return 1;
    let cx = 0;
    let cy = 0;
    let w = 0;
    for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const I = Math.max(samples[i], 0);
        cx += I * Math.cos(th);
        cy += I * Math.sin(th);
        w += I;
    }
    if (!(w > 1e-12))
        return 1;
    return Math.hypot(cx, cy) / w;
}
/** Count local maxima of a periodic sample ring. */
export function countLocalMaxima(samples, minRel = 0.12) {
    const n = samples.length;
    if (n < 3)
        return 0;
    const maxV = Math.max(...samples, 1e-12);
    let count = 0;
    for (let i = 0; i < n; i++) {
        const prev = samples[(i - 1 + n) % n];
        const cur = samples[i];
        const next = samples[(i + 1) % n];
        if (cur >= prev && cur >= next && cur >= maxV * minRel)
            count++;
    }
    return count;
}
/**
 * Coefficient of variation of angular gaps between consecutive local maxima
 * on a periodic sample ring (indices → radians). High ⇒ peaks bunch (compressed).
 */
export function peakSpacingCv(samples, minRel = 0.12) {
    const n = samples.length;
    if (n < 4)
        return 0;
    const maxV = Math.max(...samples, 1e-12);
    const peaks = [];
    for (let i = 0; i < n; i++) {
        const prev = samples[(i - 1 + n) % n];
        const cur = samples[i];
        const next = samples[(i + 1) % n];
        if (cur >= prev && cur >= next && cur >= maxV * minRel)
            peaks.push(i);
    }
    if (peaks.length < 2)
        return 99; // collapsed / single blob
    const gaps = [];
    for (let i = 0; i < peaks.length; i++) {
        let di = peaks[(i + 1) % peaks.length] - peaks[i];
        if (di <= 0)
            di += n;
        gaps.push((di / n) * Math.PI * 2);
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    let acc = 0;
    for (const g of gaps)
        acc += (g - mean) * (g - mean);
    const std = Math.sqrt(acc / gaps.length);
    return std / Math.max(mean, 1e-12);
}
/**
 * Pitch-stable camera pair: equatorial view vs high pitch (same yaw).
 * camRight stays world +X; camUp tilts from +Y toward −Z.
 */
export function cameraPairEquatorVsPitch(pitchRad) {
    const equator = {
        camRight: { x: 1, y: 0, z: 0 },
        camUp: { x: 0, y: 1, z: 0 },
    };
    const c = Math.cos(pitchRad);
    const s = Math.sin(pitchRad);
    // Pitch camera up: up vector leans from +Y toward −Z (look from above-ish)
    const pitched = {
        camRight: { x: 1, y: 0, z: 0 },
        camUp: normalize3({ x: 0, y: c, z: -s }),
    };
    return { equator, pitched };
}
//# sourceMappingURL=sun-ray-domain.js.map