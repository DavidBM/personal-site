/**
 * Single-planet showcase: full Azure multi-map disc + classic ray-heightfield crack.
 * Pure constants — Node smoke imports shipped dist without GPU.
 */
import { SOLAR_ASSET } from "../solar-system/planet-textures.js";
import { CRACK_HEIGHT_SOURCE, CRACK_WIDTH_SCALE, } from "./crack-height.js";
import { CRACK_CLASSIC_HEIGHT_SCALE, CRACK_LAND_METHOD, CRACK_LAND_METHOD_ID, } from "./crack-relief.js";
/** Shipped Azure/solar day albedo (repo-root relative). */
export const EARTH_CRACK_ALBEDO_PATH = SOLAR_ASSET.earthAlbedo;
export const EARTH_CRACK_NORMAL_PATH = SOLAR_ASSET.earthNormal;
export const EARTH_CRACK_SPEC_PATH = SOLAR_ASSET.earthSpec;
export const EARTH_CRACK_NIGHT_PATH = SOLAR_ASSET.earthNight;
export const EARTH_CRACK_CLOUD_PATH = SOLAR_ASSET.cloud;
/**
 * Height / displacement: crack-only fissure (no polar hole / grit).
 * Planar width scale ≈ ⅓ of educational belly fissure.
 */
export const EARTH_CRACK_HEIGHT_SOURCE = CRACK_HEIGHT_SOURCE;
export const EARTH_CRACK_WIDTH_SCALE = CRACK_WIDTH_SCALE;
/** Land technique: sphere-surface classic-parallax (ray vs radial heightfield). */
export const EARTH_CRACK_METHOD_LABEL = CRACK_LAND_METHOD;
export const EARTH_CRACK_METHOD_ID = CRACK_LAND_METHOD_ID;
/** Classic radial height scale (WGSL CRACK_HEIGHT_SCALE). */
export const EARTH_CRACK_HEIGHT_SCALE = CRACK_CLASSIC_HEIGHT_SCALE;
/** Crack height atlas resolution. */
export const EARTH_CRACK_MAP_SIZE = 512;
/** Default camera distance (planet radius ≈ 0.85 Azure). */
export const EARTH_CRACK_CAM_DIST = 3.2;
/**
 * Pack used by the page entry for status / smoke path checks.
 */
export function getEarthCrackPlanetConfig() {
    return {
        albedoPath: EARTH_CRACK_ALBEDO_PATH,
        normalPath: EARTH_CRACK_NORMAL_PATH,
        specPath: EARTH_CRACK_SPEC_PATH,
        nightPath: EARTH_CRACK_NIGHT_PATH,
        cloudPath: EARTH_CRACK_CLOUD_PATH,
        heightSource: EARTH_CRACK_HEIGHT_SOURCE,
        widthScale: EARTH_CRACK_WIDTH_SCALE,
        methodLabel: EARTH_CRACK_METHOD_LABEL,
        methodId: EARTH_CRACK_METHOD_ID,
        heightScale: EARTH_CRACK_HEIGHT_SCALE,
        mapSize: EARTH_CRACK_MAP_SIZE,
        shader: "planet-crack-disc",
        cloudsFollowCrack: false,
        landMethod: "classic-parallax",
    };
}
//# sourceMappingURL=config.js.map