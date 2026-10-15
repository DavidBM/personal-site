/**
 * CPU golden for fidelity comparisons: full sequential bakePlanetTextures.
 */
import { bakePlanetTextures } from "./bake.js";
export function bakePlanetTexturesGpuCpuRef(input, onProgress, onNumericSurface) {
    return bakePlanetTextures(input, onProgress, onNumericSurface);
}
//# sourceMappingURL=bake-gpu-cpu-ref.js.map