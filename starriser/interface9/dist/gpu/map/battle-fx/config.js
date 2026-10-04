/** Bounded cosmetic work. High FX changes admission, never shader variants. */
export const FX_FLEETS = 128;
export const FX_SOURCE_WORDS = 52;
export const FX_RECORD_BYTES = 96;
export const FX_NORMAL = Object.freeze({ emitters: 512, tracers: 16384, torpedoes: 512, beams: 1024, explosions: 128, lenses: 4 });
export function fxBudget(high = false, low = false) {
    const scale = low ? .25 : high ? 10 : 1;
    return { emitters: FX_NORMAL.emitters * scale, tracers: FX_NORMAL.tracers * scale,
        torpedoes: FX_NORMAL.torpedoes * scale, beams: FX_NORMAL.beams * scale,
        explosions: FX_NORMAL.explosions * scale, lenses: Math.max(1, FX_NORMAL.lenses * scale) };
}
export function fxLayout(b) {
    const torpedoes = b.tracers, beams = torpedoes + b.torpedoes, explosions = beams + b.beams;
    return { torpedoes, beams, explosions, count: explosions + b.explosions,
        // Each explosion gets a flash, four lobes and 32 deterministic fragments.
        draws: b.tracers * 2 + b.torpedoes * 5 + b.beams + b.explosions * 37 };
}
//# sourceMappingURL=config.js.map