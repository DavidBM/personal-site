/**
 * Pure UI state for Earth+crack shader layers + parallax depth.
 * Bus-free — host packs into body uniforms; smoke asserts defaults/clamp.
 */
import { CRACK_CLASSIC_HEIGHT_SCALE } from "./crack-relief.js";
export const EARTH_CRACK_LAYER_IDS = [
    "land",
    "night",
    "atmosphere",
    "parallax",
    "clouds",
];
/** Default product look: all layers on, depth = relief default. */
export const EARTH_CRACK_LAYER_DEFAULTS = Object.freeze({
    land: true,
    night: true,
    atmosphere: true,
    parallax: true,
    clouds: true,
    parallaxDepth: CRACK_CLASSIC_HEIGHT_SCALE,
});
export const PARALLAX_DEPTH_MIN = 0;
export const PARALLAX_DEPTH_MAX = 0.45;
export function clampParallaxDepth(v) {
    if (!Number.isFinite(v))
        return EARTH_CRACK_LAYER_DEFAULTS.parallaxDepth;
    return Math.min(PARALLAX_DEPTH_MAX, Math.max(PARALLAX_DEPTH_MIN, v));
}
export function createLayerState(partial) {
    return {
        land: partial?.land ?? EARTH_CRACK_LAYER_DEFAULTS.land,
        night: partial?.night ?? EARTH_CRACK_LAYER_DEFAULTS.night,
        atmosphere: partial?.atmosphere ?? EARTH_CRACK_LAYER_DEFAULTS.atmosphere,
        parallax: partial?.parallax ?? EARTH_CRACK_LAYER_DEFAULTS.parallax,
        clouds: partial?.clouds ?? EARTH_CRACK_LAYER_DEFAULTS.clouds,
        parallaxDepth: clampParallaxDepth(partial?.parallaxDepth ?? EARTH_CRACK_LAYER_DEFAULTS.parallaxDepth),
    };
}
export function setLayerEnabled(state, id, on) {
    return { ...state, [id]: !!on };
}
export function setParallaxDepth(state, depth) {
    return { ...state, parallaxDepth: clampParallaxDepth(depth) };
}
/**
 * Pack into body uniform floats @48.. (after look0–look5).
 * layers0: land, night, atm, parallax (0/1)
 * layers1: clouds, parallaxDepth, pad, pad
 */
export function packLayerUniforms(state) {
    const f = (b) => (b ? 1 : 0);
    return {
        layers0: [
            f(state.land),
            f(state.night),
            f(state.atmosphere),
            f(state.parallax),
        ],
        layers1: [f(state.clouds), clampParallaxDepth(state.parallaxDepth), 0, 0],
    };
}
/** Float base index in body uniform Float32Array for layers0.x */
export const LAYER_UNIFORM_FLOAT_BASE = 48;
//# sourceMappingURL=layer-ui.js.map