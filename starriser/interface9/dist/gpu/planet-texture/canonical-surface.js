import { bakePlanetTexturesAuto } from "./bake-gpu.js";
import { cloneParams } from "./presets.js";
import { derivePlanetSurface } from "./surface-fields.js";
export const CANONICAL_PLANET_WIDTH = 8192;
export const CANONICAL_PLANET_HEIGHT = 4096;
/** Separate authoring entry: previews keep their own resolution; authority does not. */
export function canonicalPlanetParams(input) {
    return { ...cloneParams(input), resolution: CANONICAL_PLANET_WIDTH };
}
/**
 * Runs the real baker once at 8K. No seed-only cross-backend identity is promised.
 * artifact-source.ts streams this captured master into the offline persisted format.
 * This call itself does not publish an artifact or import it into the BE.
 */
export async function bakeCanonicalPlanetMaster(input, options, device) {
    let surface;
    const baked = await bakePlanetTexturesAuto(canonicalPlanetParams(input), {
        ...options,
        onNumericSurface(value) { surface = value; },
    }, device);
    if (!surface || surface.width !== CANONICAL_PLANET_WIDTH || surface.height !== CANONICAL_PLANET_HEIGHT) {
        throw new Error("Canonical baker did not produce an 8192x4096 numeric surface");
    }
    return {
        master: {
            schemaVersion: 1,
            generator: baked.set.params.planetClass === "gas" ? "cpu-gas-v1"
                : baked.backend === "gpu-cpu-ref" ? "cpu-reference-v1" : "webgpu-product-v1",
            params: cloneParams(baked.set.params), surface,
        },
        textures: baked.set,
    };
}
export function deriveCanonicalPlanetSurface(master, width) {
    if (master.schemaVersion !== 1 || master.params.resolution !== CANONICAL_PLANET_WIDTH
        || master.surface.width !== CANONICAL_PLANET_WIDTH || master.surface.height !== CANONICAL_PLANET_HEIGHT) {
        throw new Error("Invalid canonical planet master");
    }
    return derivePlanetSurface(master.surface, width);
}
//# sourceMappingURL=canonical-surface.js.map