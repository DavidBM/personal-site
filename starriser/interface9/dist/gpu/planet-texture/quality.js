/**
 * Quality metrics on **baked** albedo / liquid masks (no biome reimplementation).
 * Used by smoke tests to gate minimap-green / structure / class separation.
 */
function lum(r, g, b) {
    return (r + g + b) / 3;
}
/**
 * Analyze albedo + liquid mask from the shipped bake.
 * liquidMask.R > 127 → ocean.
 */
export function analyzeAlbedoQuality(albedo, liquidMask, width, height) {
    const n = width * height;
    let landCount = 0;
    let oceanCount = 0;
    let greenDom = 0;
    let sumRg = 0;
    let sumRg2 = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    // Ocean depth proxy: among liquid pixels, use albedo luminance —
    // deep should be darker/cooler blue.
    let deepB = 0;
    let deepLum = 0;
    let deepN = 0;
    let shallowB = 0;
    let shallowLum = 0;
    let shallowN = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const r = albedo[o];
        const g = albedo[o + 1];
        const b = albedo[o + 2];
        const isLiq = liquidMask[o] > 127;
        sumR += r;
        sumG += g;
        sumB += b;
        if (isLiq) {
            oceanCount++;
            const L = lum(r, g, b);
            // Spec channel unused; classify deep vs shallow by luminance terciles later
            if (L < 55) {
                deepB += b;
                deepLum += L;
                deepN++;
            }
            else if (L > 70) {
                shallowB += b;
                shallowLum += L;
                shallowN++;
            }
        }
        else {
            landCount++;
            if (g >= r + 15 && g >= b + 15)
                greenDom++;
            const rg = r - g;
            sumRg += rg;
            sumRg2 += rg * rg;
        }
    }
    const landGreenDominantFrac = landCount > 0 ? greenDom / landCount : 0;
    const meanRg = landCount > 0 ? sumRg / landCount : 0;
    const landRgDiffStd = landCount > 1
        ? Math.sqrt(Math.max(0, sumRg2 / landCount - meanRg * meanRg))
        : 0;
    // Local fine variance (sample every 2nd pixel for speed)
    let landVarSum = 0;
    let landVarN = 0;
    let oceanVarSum = 0;
    let oceanVarN = 0;
    for (let y = 1; y < height - 1; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const i = y * width + x;
            const o = i * 4;
            const isLiq = liquidMask[o] > 127;
            // 3×3 mean abs deviation of luminance
            let m = 0;
            let c = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = (x + dx + width) % width;
                    const yy = y + dy;
                    const j = (yy * width + xx) * 4;
                    m += lum(albedo[j], albedo[j + 1], albedo[j + 2]);
                    c++;
                }
            }
            m /= c;
            let v = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = (x + dx + width) % width;
                    const yy = y + dy;
                    const j = (yy * width + xx) * 4;
                    const d = lum(albedo[j], albedo[j + 1], albedo[j + 2]) - m;
                    v += d * d;
                }
            }
            v /= c;
            if (isLiq) {
                oceanVarSum += v;
                oceanVarN++;
            }
            else {
                landVarSum += v;
                landVarN++;
            }
        }
    }
    // Connected land components (4-connected, U-wrap) — mean size
    const visited = new Uint8Array(n);
    const sizes = [];
    for (let i = 0; i < n; i++) {
        if (visited[i] || liquidMask[i * 4] > 127)
            continue;
        // BFS
        let sz = 0;
        const stack = [i];
        visited[i] = 1;
        while (stack.length) {
            const cur = stack.pop();
            sz++;
            const cx = cur % width;
            const cy = (cur / width) | 0;
            const neigh = [
                cy * width + ((cx + 1) % width),
                cy * width + ((cx - 1 + width) % width),
                cy > 0 ? (cy - 1) * width + cx : -1,
                cy < height - 1 ? (cy + 1) * width + cx : -1,
            ];
            for (const nb of neigh) {
                if (nb < 0 || visited[nb])
                    continue;
                if (liquidMask[nb * 4] > 127)
                    continue;
                visited[nb] = 1;
                stack.push(nb);
            }
        }
        if (sz > 0)
            sizes.push(sz);
    }
    let meanLandBlobSize = 0;
    if (sizes.length) {
        let s = 0;
        for (const z of sizes)
            s += z;
        meanLandBlobSize = s / sizes.length;
    }
    return {
        landCount,
        oceanCount,
        landGreenDominantFrac,
        landRgDiffStd,
        deepOceanMeanB: deepN > 0 ? deepB / deepN : 0,
        shallowOceanMeanB: shallowN > 0 ? shallowB / shallowN : 0,
        deepOceanMeanLum: deepN > 0 ? deepLum / deepN : 0,
        shallowOceanMeanLum: shallowN > 0 ? shallowLum / shallowN : 0,
        landFineVariance: landVarN > 0 ? landVarSum / landVarN : 0,
        oceanFineVariance: oceanVarN > 0 ? oceanVarSum / oceanVarN : 0,
        meanLandBlobSize,
        meanRgb: {
            r: sumR / n,
            g: sumG / n,
            b: sumB / n,
        },
    };
}
/** Euclidean distance between two mean RGB vectors. */
export function meanRgbDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}
export function analyzeMinimapAntiPatterns(albedo, liquidMask, width, height) {
    const n = width * height;
    let land = 0;
    let greyHigh = 0;
    let arid = 0;
    let veg = 0;
    const oceanBands = [0, 0, 0, 0];
    let ocean = 0;
    const landBins = new Map();
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const r = albedo[o];
        const g = albedo[o + 1];
        const b = albedo[o + 2];
        const isLiq = liquidMask[o] > 127;
        const L = (r + g + b) / 3;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        // Equirect row → exclude polar ice caps from "grey elev ramp" anti-pattern
        const row = Math.floor(i / width);
        const v = (row + 0.5) / height;
        // Wider band: irregular polar ice extends past a hard latitude ring
        const polarCap = v < 0.16 || v > 0.84;
        if (isLiq) {
            ocean++;
            // 4 luminance bands
            const bi = L < 40 ? 0 : L < 70 ? 1 : L < 110 ? 2 : 3;
            oceanBands[bi]++;
        }
        else {
            land++;
            // High-luma low-chroma mid-lat = white/grey elevation ramp (not polar ice)
            if (L > 175 && chroma < 28 && !polarCap)
                greyHigh++;
            // Arid tan/brown
            if (r > g + 8 && r > b + 8 && r > 90 && L > 70 && L < 220)
                arid++;
            // Vegetation
            if (g > r + 8 && g > b + 5 && L < 160)
                veg++;
            // Quantize to 32-step bins for color richness
            const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
            landBins.set(key, (landBins.get(key) ?? 0) + 1);
        }
    }
    const occ = [0, 0, 0, 0];
    let active = 0;
    if (ocean > 0) {
        for (let i = 0; i < 4; i++) {
            occ[i] = oceanBands[i] / ocean;
            if (occ[i] >= 0.05)
                active++;
        }
    }
    return {
        landGreyHighFrac: land > 0 ? greyHigh / land : 0,
        landAridFrac: land > 0 ? arid / land : 0,
        landVegFrac: land > 0 ? veg / land : 0,
        oceanBandOccupancy: occ,
        oceanActiveBands: active,
        landColorBins: landBins.size,
    };
}
//# sourceMappingURL=quality.js.map