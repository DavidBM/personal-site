/**
 * Planet texture batch baker — types.
 *
 * Maps are equirectangular belly (U wraps at 0/1 longitude) plus optional
 * north/south pole caps with alpha gradients (EVE-style dual UV, but offline).
 *
 * Methods notes (research-backed):
 * - Equirect: lon = 2π(u−0.5), lat = π(0.5−v); sample 3D noise on unit sphere.
 * - Poles: planar polar projection + radial alpha falloff (user blend strategy).
 * - Terrain: fBm height → thermal talus + particle hydraulic erosion (Beyer/Lague family).
 * - Gas: latitude-stretched 3D noise + domain warp + storm vortices (Astrographer-style).
 * - EVE Dominion: runtime GPU preprocess of height→normal packs + dual UV;
 *   this tool batches offline and exports belly + pole alpha caps instead.
 */
/** Allowed equirect long-edge sizes (8K supported). */
export const RESOLUTION_OPTIONS = [
    256, 512, 1024, 2048, 4096, 8192,
];
export const MAX_RESOLUTION = 8192;
export const MIN_RESOLUTION = 64;
//# sourceMappingURL=types.js.map