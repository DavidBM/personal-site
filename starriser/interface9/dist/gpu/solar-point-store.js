/**
 * CPU-side solar-system point packing for GPU layers.
 * No GPU API imports — unit-testable under Node.
 */
import { HIDDEN_COORDINATE, RENDER_PLANE_Y, } from "../contracts/render-constants.js";
import { hexToRgb } from "../utils/color.js";
import { DIRTY_CLEAN, expandDirtyRange, markDirtyFull, } from "../math/dirty-range.js";
const JUMP_GATE_RGB = [0, 1, 1];
function resolveRgb(source) {
    if (source.isJumpGate)
        return JUMP_GATE_RGB;
    const c = source.clusterColor;
    if (Array.isArray(c))
        return [c[0], c[1], c[2]];
    if (typeof c === "number")
        return hexToRgb(c);
    return [1, 1, 1];
}
export class SolarPointStore {
    constructor() {
        this.positions = new Float32Array(0);
        this.colors = new Float32Array(0);
        this.visibility = new Uint8Array(0);
        this.lodHidden = new Uint8Array(0);
        this.lodRestoreX = new Float32Array(0);
        this.lodRestoreZ = new Float32Array(0);
        this.maxCount = 0;
        this.currentCount = 0;
        this.positionDirty = DIRTY_CLEAN;
        this.colorDirty = DIRTY_CLEAN;
    }
    clearDirty() {
        this.positionDirty = DIRTY_CLEAN;
        this.colorDirty = DIRTY_CLEAN;
    }
    markFullDirty() {
        this.positionDirty = markDirtyFull();
        this.colorDirty = markDirtyFull();
    }
    initialize(maxSolarSystems) {
        this.positions = new Float32Array(maxSolarSystems * 3);
        this.colors = new Float32Array(maxSolarSystems * 3);
        this.visibility = new Uint8Array(maxSolarSystems);
        this.lodHidden = new Uint8Array(maxSolarSystems);
        this.lodRestoreX = new Float32Array(maxSolarSystems);
        this.lodRestoreZ = new Float32Array(maxSolarSystems);
        this.maxCount = maxSolarSystems;
        this.currentCount = 0;
        this.markFullDirty();
    }
    clear() {
        this.initialize(0);
    }
    /** Ensure capacity for `needed` live slots (doubles). */
    ensureCapacity(needed) {
        if (needed <= this.maxCount)
            return false;
        const newMax = Math.max(needed, Math.ceil(this.maxCount * 2) || 16);
        const newPositions = new Float32Array(newMax * 3);
        const newColors = new Float32Array(newMax * 3);
        const newVisibility = new Uint8Array(newMax);
        const newLodHidden = new Uint8Array(newMax);
        const newRestoreX = new Float32Array(newMax);
        const newRestoreZ = new Float32Array(newMax);
        newPositions.set(this.positions);
        newColors.set(this.colors);
        newVisibility.set(this.visibility);
        newLodHidden.set(this.lodHidden);
        newRestoreX.set(this.lodRestoreX);
        newRestoreZ.set(this.lodRestoreZ);
        this.positions = newPositions;
        this.colors = newColors;
        this.visibility = newVisibility;
        this.lodHidden = newLodHidden;
        this.lodRestoreX = newRestoreX;
        this.lodRestoreZ = newRestoreZ;
        this.maxCount = newMax;
        this.markFullDirty();
        return true;
    }
    /**
     * Append one point. Returns buffer index.
     */
    add(write) {
        this.ensureCapacity(this.currentCount + 1);
        const idx = this.currentCount++;
        this.writeAt(idx, write);
        return idx;
    }
    writeAt(idx, write) {
        const floatOffset = idx * 3;
        this.positions[floatOffset] = write.x;
        this.positions[floatOffset + 1] = RENDER_PLANE_Y;
        this.positions[floatOffset + 2] = write.z;
        const rgb = resolveRgb(write.color);
        this.colors[floatOffset] = rgb[0];
        this.colors[floatOffset + 1] = rgb[1];
        this.colors[floatOffset + 2] = rgb[2];
        this.visibility[idx] = 1;
        this.lodHidden[idx] = 0;
        this.lodRestoreX[idx] = write.x;
        this.lodRestoreZ[idx] = write.z;
        this.positionDirty = expandDirtyRange(this.positionDirty, floatOffset, 3);
        this.colorDirty = expandDirtyRange(this.colorDirty, floatOffset, 3);
    }
    updatePosition(idx, x, z) {
        if (idx < 0 || idx >= this.currentCount)
            return;
        // While LOD-hidden, keep GPU parked but remember logical xz for unhide.
        if (this.lodHidden[idx]) {
            this.lodRestoreX[idx] = x;
            this.lodRestoreZ[idx] = z;
            return;
        }
        const floatOffset = idx * 3;
        this.positions[floatOffset] = x;
        this.positions[floatOffset + 1] = RENDER_PLANE_Y;
        this.positions[floatOffset + 2] = z;
        this.lodRestoreX[idx] = x;
        this.lodRestoreZ[idx] = z;
        this.positionDirty = expandDirtyRange(this.positionDirty, floatOffset, 3);
    }
    /**
     * LOD visibility: park at HIDDEN without zeroing colors (unlike {@link hide}).
     * When unhiding, pass restoreX/restoreZ, or omit to use the internal cache
     * (filled on hide and kept current by {@link updatePosition} while hidden).
     */
    setLodHidden(idx, hidden, restoreX, restoreZ) {
        if (idx < 0 || idx >= this.currentCount)
            return;
        // Soft-deleted slots (hide) stay dead — do not revive via LOD.
        if (this.visibility[idx] === 0 && !this.lodHidden[idx])
            return;
        const floatOffset = idx * 3;
        if (hidden) {
            if (this.lodHidden[idx])
                return;
            this.lodRestoreX[idx] = this.positions[floatOffset];
            this.lodRestoreZ[idx] = this.positions[floatOffset + 2];
            this.positions[floatOffset] = HIDDEN_COORDINATE;
            this.positions[floatOffset + 1] = HIDDEN_COORDINATE;
            this.positions[floatOffset + 2] = HIDDEN_COORDINATE;
            this.lodHidden[idx] = 1;
            this.visibility[idx] = 0;
            this.positionDirty = expandDirtyRange(this.positionDirty, floatOffset, 3);
            return;
        }
        if (!this.lodHidden[idx])
            return;
        const x = restoreX !== undefined ? restoreX : this.lodRestoreX[idx];
        const z = restoreZ !== undefined ? restoreZ : this.lodRestoreZ[idx];
        this.positions[floatOffset] = x;
        this.positions[floatOffset + 1] = RENDER_PLANE_Y;
        this.positions[floatOffset + 2] = z;
        this.lodRestoreX[idx] = x;
        this.lodRestoreZ[idx] = z;
        this.lodHidden[idx] = 0;
        this.visibility[idx] = 1;
        this.positionDirty = expandDirtyRange(this.positionDirty, floatOffset, 3);
    }
    /** Soft-delete: hide far off-camera (no compact). Zeros colors permanently. */
    hide(idx) {
        if (idx < 0 || idx >= this.maxCount)
            return;
        const floatOffset = idx * 3;
        this.positions[floatOffset] = HIDDEN_COORDINATE;
        this.positions[floatOffset + 1] = HIDDEN_COORDINATE;
        this.positions[floatOffset + 2] = HIDDEN_COORDINATE;
        this.colors[floatOffset] = 0;
        this.colors[floatOffset + 1] = 0;
        this.colors[floatOffset + 2] = 0;
        this.visibility[idx] = 0;
        this.lodHidden[idx] = 0;
        this.positionDirty = expandDirtyRange(this.positionDirty, floatOffset, 3);
        this.colorDirty = expandDirtyRange(this.colorDirty, floatOffset, 3);
    }
    /**
     * Rebuild from a dense list (finalize path).
     * `writes[i]` maps to buffer index i.
     */
    rebuild(writes) {
        const n = writes.length;
        this.positions = new Float32Array(n * 3);
        this.colors = new Float32Array(n * 3);
        this.visibility = new Uint8Array(n);
        this.lodHidden = new Uint8Array(n);
        this.lodRestoreX = new Float32Array(n);
        this.lodRestoreZ = new Float32Array(n);
        this.maxCount = n;
        this.currentCount = n;
        for (let i = 0; i < n; i++) {
            const floatOffset = i * 3;
            const w = writes[i];
            this.positions[floatOffset] = w.x;
            this.positions[floatOffset + 1] = RENDER_PLANE_Y;
            this.positions[floatOffset + 2] = w.z;
            const rgb = resolveRgb(w.color);
            this.colors[floatOffset] = rgb[0];
            this.colors[floatOffset + 1] = rgb[1];
            this.colors[floatOffset + 2] = rgb[2];
            this.visibility[i] = 1;
            this.lodHidden[i] = 0;
            this.lodRestoreX[i] = w.x;
            this.lodRestoreZ[i] = w.z;
        }
        this.markFullDirty();
    }
}
/** Stride constants for interop / WebGPU vertex layouts. */
export const SOLAR_POINT_FLOATS_PER_VERTEX = 3;
export const SOLAR_POINT_POSITION_BYTES = 12;
export const SOLAR_POINT_COLOR_BYTES = 12;
//# sourceMappingURL=solar-point-store.js.map