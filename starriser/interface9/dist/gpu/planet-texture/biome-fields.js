import { generatePureBiomeMap } from './climate.js';
import { PURE_BIOME_LABELS } from './biome-palette.js';
import { planetMapCapabilities } from './map-capabilities.js';
import { poleIceExtentScale } from './pole-cap.js';
import { retainPlanetSurface } from './surface-fields.js';
/** Offline authoring only. Capture the existing pure-biome classifier at every
 * master pixel, using the same final grayscale height and parameters as the lab.
 * No RGB decoding, capped preview upscaling or second biome algorithm. */
export function retainBakedPlanetSurface(height, set) {
    const surface = retainPlanetSurface(height, set.params.planetClass);
    if (!planetMapCapabilities(set.params.planetClass).biome)
        return surface;
    const map = generatePureBiomeMap(set.height.rgba, height.width, height.height, set.params.liquidLevel, set.params.seed, poleIceExtentScale(set.params.poleSize), height.width);
    return { ...surface, fields: { ...surface.fields,
            biome: { kind: 'category', labels: Object.values(PURE_BIOME_LABELS), values: map.values },
        } };
}
//# sourceMappingURL=biome-fields.js.map