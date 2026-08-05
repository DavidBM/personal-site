/**
 * CPU golden for fidelity comparisons: full sequential bakePlanetTextures.
 */
import { bakePlanetTextures } from "./bake.js";
export function bakePlanetTexturesGpuCpuRef(input, onProgress) {
    return bakePlanetTextures(input, onProgress);
}
//# sourceMappingURL=bake-gpu-cpu-ref.js.map