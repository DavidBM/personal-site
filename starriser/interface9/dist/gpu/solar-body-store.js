/**
 * CPU SoA for one compact Kepler SCENE (sun + ≤8).
 *
 * Phase / showcase orbit / visual radius / catalogId are source of truth.
 * No abs-f32 composed world centers — the layer host-composes with
 * keplerOrbitLocalF32 + discWorldRelativeF32 each encode (centerRel.y =
 * localY − origin.y, never forced 0). Planets carry hashed inclination.
 */
import { DIRTY_CLEAN, expandDirtyRange, markDirtyFull, } from "../math/dirty-range.js";
import { MAX_COMPACT_PLANETS } from "./compact-kepler.js";
export const SOLAR_BODY_MAX = 1 + MAX_COMPACT_PLANETS;
export class SolarBodyStore {
    constructor() {
        this.maxCount = SOLAR_BODY_MAX;
        this.phase0 = new Float32Array(SOLAR_BODY_MAX);
        this.orbitRadius = new Float32Array(SOLAR_BODY_MAX);
        this.orbitPeriod = new Float32Array(SOLAR_BODY_MAX);
        this.radius = new Float32Array(SOLAR_BODY_MAX);
        this.spinRadPerSec = new Float32Array(SOLAR_BODY_MAX);
        this.obliquity = new Float32Array(SOLAR_BODY_MAX);
        this.drawMargin = new Float32Array(SOLAR_BODY_MAX);
        this.lodHidden = new Uint8Array(SOLAR_BODY_MAX);
        this.isSun = new Uint8Array(SOLAR_BODY_MAX);
        this.catalogIds = [];
        this.defs = [];
        this.currentCount = 0;
        this.dirty = DIRTY_CLEAN;
        this.systemId = null;
        this.systemX = 0;
        this.systemZ = 0;
        this.catalogId = null;
    }
    clearDirty() {
        this.dirty = DIRTY_CLEAN;
    }
    markFullDirty() {
        this.dirty = markDirtyFull();
    }
    clear() {
        this.currentCount = 0;
        this.catalogIds.length = 0;
        this.defs.length = 0;
        this.systemId = null;
        this.catalogId = null;
        this.systemX = 0;
        this.systemZ = 0;
        this.markFullDirty();
    }
    setSystemPosition(x, z) {
        this.systemX = x;
        this.systemZ = z;
        this.markFullDirty();
    }
    setLodHidden(idx, hidden) {
        if (idx < 0 || idx >= this.currentCount)
            return;
        const v = hidden ? 1 : 0;
        if (this.lodHidden[idx] === v)
            return;
        this.lodHidden[idx] = v;
        this.dirty = expandDirtyRange(this.dirty, idx, 1);
    }
    /**
     * Replace the SCENE set. At most 1 sun + 8 planets.
     */
    rebuild(set, systemId, systemX, systemZ) {
        const bodies = set.bodies;
        const n = Math.min(bodies.length, SOLAR_BODY_MAX);
        this.currentCount = n;
        this.catalogIds.length = n;
        this.defs.length = n;
        this.systemId = systemId;
        this.systemX = systemX;
        this.systemZ = systemZ;
        this.catalogId = set.catalogId;
        for (let i = 0; i < n; i++) {
            const d = bodies[i];
            this.phase0[i] = d.orbitPhase0;
            this.orbitRadius[i] = d.orbitRadius;
            this.orbitPeriod[i] = d.orbitPeriodSec;
            this.radius[i] = d.radius;
            this.spinRadPerSec[i] = d.spinRadPerSec;
            this.obliquity[i] = d.obliquity;
            this.drawMargin[i] = d.drawMargin;
            this.lodHidden[i] = 0;
            this.isSun[i] = d.kind === "sun" ? 1 : 0;
            this.catalogIds[i] = d.id;
            this.defs[i] = d;
        }
        this.markFullDirty();
    }
}
//# sourceMappingURL=solar-body-store.js.map