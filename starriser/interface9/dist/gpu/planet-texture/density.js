/**
 * Planet-scale density metrics on shipped height / bake products.
 *
 * Local maxima = 8-neighbor strict peak on land (height > seaLevel).
 * Effective layers = documented generative stack (fields × octaves).
 */
import { PLANET_HEIGHT_LAYER_STACK } from "./heightfield.js";
/**
 * Count 8-neighbor strict local maxima on land pixels.
 * U-wraps longitude; clamps latitude. Sea = liquidLevel threshold on [0,1] height.
 */
export function countLandLocalMaxima(height, seaLevel) {
    const { width: W, height: H, data } = height;
    const sea = Math.max(0, Math.min(1, seaLevel));
    let count = 0;
    for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const h = data[i];
            if (h <= sea)
                continue;
            let isMax = true;
            for (let dy = -1; dy <= 1 && isMax; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    const xx = (x + dx + W) % W;
                    const yy = y + dy;
                    if (data[yy * W + xx] >= h) {
                        isMax = false;
                        break;
                    }
                }
            }
            if (isMax)
                count++;
        }
    }
    return count;
}
/**
 * Count local maxima on grayscale height RGBA (R channel / 255).
 * Same rule as float height map — used when only bake product is available.
 */
export function countLandLocalMaximaRgba(heightRgba, width, height, seaLevel) {
    const sea = Math.max(0, Math.min(1, seaLevel));
    const seaByte = sea * 255;
    let count = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 0; x < width; x++) {
            const h = heightRgba[(y * width + x) * 4];
            if (h <= seaByte)
                continue;
            let isMax = true;
            for (let dy = -1; dy <= 1 && isMax; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    const xx = (x + dx + width) % width;
                    const yy = y + dy;
                    const n = heightRgba[(yy * width + xx) * 4];
                    if (n >= h) {
                        isMax = false;
                        break;
                    }
                }
            }
            if (isMax)
                count++;
        }
    }
    return count;
}
/**
 * Effective generative composition layers = sum of (octaves) over independent
 * spherical field evaluations in the planet height + climate stack.
 * Criterion: ≥ 80 for planet-scale (not a 3–4 band terrain patch).
 */
export function effectiveLayerTally(_params) {
    let n = 0;
    for (const layer of PLANET_HEIGHT_LAYER_STACK) {
        n += layer.octaves;
    }
    return n;
}
/** Named stack for diagnostics / UI. */
export function layerStackDescription() {
    return PLANET_HEIGHT_LAYER_STACK.map((L) => `${L.name}×${L.octaves}`).join(", ");
}
//# sourceMappingURL=density.js.map