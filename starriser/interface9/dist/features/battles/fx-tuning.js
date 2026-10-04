/** Ordered FX-only uniform ABI: eight vec4s per class; validate only on ingress. */
export const FX_FIELDS = [
    'guns', 'torpedoes', 'lasers', 'gunRate',
    'shotSpeed', 'shotLife', 'shotWidth', 'salvo',
    'reload', 'missileSpeed', 'homing', 'beamSeconds',
    'beamWidth', 'brightness', 'shotRange', 'missileLife',
    'beamRest', 'mountSpread', 'laserImpactRate', 'laserImpactSize',
    'laserImpactLife', 'laserImpactBrightness', 'laserImpactLobes', 'laserImpactSparks',
    'laserImpactLens', 'torpedoImpactChance', 'torpedoImpactSize', 'torpedoImpactLife',
    'torpedoImpactBrightness', 'torpedoImpactLobes', 'torpedoImpactSparks', 'torpedoImpactLens',
];
export const FX_PROFILE_FLOATS = FX_FIELDS.length;
export const FX_LIMITS = [
    [0, 32, 1], [0, 32, 1], [0, 32, 1], [1, 40, 1],
    [.2, 5, .1], [.05, 1, .05], [.2, 8, .1], [1, 20, 1],
    [2, 30, 1], [.2, 4, .1], [.2, 10, .2], [.2, 5, .1],
    [.5, 8, .1], [0, 3, .1], [.1, 1.5, .05], [.5, 8, .5],
    [.1, 10, .1], [0, 2, .1], [0, 20, .1], [0, 5, .05],
    [.1, 4, .1], [0, 3, .05], [0, 4, 1], [0, 32, 1],
    [0, 1, .05], [0, 1, .05], [0, 5, .05], [.1, 4, .1],
    [0, 3, .05], [0, 4, 1], [0, 32, 1], [0, 1, .05],
];
export function defaultFxProfiles() {
    return Array.from({ length: 6 }, (_, i) => ({
        guns: [1, 2, 2, 6, 12, 20][i], torpedoes: [0, 1, 2, 2, 4, 6][i], lasers: [0, 0, 0, 2, 6, 10][i],
        gunRate: 12, shotSpeed: 1, shotLife: .3, shotWidth: 1.1, salvo: i < 2 ? 3 : 20, reload: 9,
        missileSpeed: 1, homing: 3, beamSeconds: 2, beamWidth: i < 3 ? 1.2 : 2, brightness: 1, shotRange: .65, missileLife: 4, beamRest: 2.5, mountSpread: 1,
        laserImpactRate: 1.5, laserImpactSize: .6, laserImpactLife: 1.8, laserImpactBrightness: 1, laserImpactLobes: 4, laserImpactSparks: 32, laserImpactLens: .2,
        torpedoImpactChance: 1, torpedoImpactSize: .6, torpedoImpactLife: 1.8, torpedoImpactBrightness: 1, torpedoImpactLobes: 4, torpedoImpactSparks: 32, torpedoImpactLens: .2,
    }));
}
const rows = defaultFxProfiles();
const data = new Float32Array(6 * FX_PROFILE_FLOATS);
const state = { version: 1, data, enabled: true };
function pack() { for (let k = 0; k < 6; k++)
    for (let f = 0; f < FX_FIELDS.length; f++)
        data[k * FX_PROFILE_FLOATS + f] = rows[k][FX_FIELDS[f]]; }
pack();
export function fxTuningState() { return state; }
export function fxProfiles() { return rows.map(r => ({ ...r })); }
const integerFields = new Set(['guns', 'torpedoes', 'lasers', 'salvo', 'laserImpactLobes', 'laserImpactSparks', 'torpedoImpactLobes', 'torpedoImpactSparks']);
function applyPatch(p) {
    if (!Number.isInteger(p?.index) || p.index < 0 || p.index > 5)
        return false;
    let changed = false;
    for (let i = 0; i < FX_FIELDS.length; i++) {
        const key = FX_FIELDS[i], n = p[key];
        if (!Number.isFinite(n))
            continue;
        const [lo, hi] = FX_LIMITS[i];
        let v = Math.max(lo, Math.min(hi, n));
        if (integerFields.has(key))
            v = Math.round(v);
        if (rows[p.index][key] !== v) {
            rows[p.index][key] = v;
            changed = true;
        }
    }
    return changed;
}
export function scheduleFxTuning(patches) {
    if (!Array.isArray(patches) || patches.length > 6)
        return false;
    let changed = false;
    for (const p of patches)
        changed = applyPatch(p) || changed;
    if (changed) {
        state.version++;
        pack();
    }
    return changed;
}
export function setFxEnabled(enabled) { state.enabled = enabled === true; }
//# sourceMappingURL=fx-tuning.js.map