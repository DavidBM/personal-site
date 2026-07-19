/**
 * CPU packing for connection line segments (cluster + solar edges).
 * No GPU API imports — unit-testable under Node.
 *
 * Separate pos/color arrays (6 floats position + 6 floats color per slot).
 */
import { HIDDEN_COORDINATE } from "../contracts/render-constants.js";
import { hexToRgb } from "../utils/color.js";
import { DIRTY_CLEAN, expandDirtyRange, markDirtyFull, } from "../math/dirty-range.js";
/** Floats per edge slot in the position buffer (2 verts × 3). */
export const CONNECTION_FLOATS_PER_SLOT = 6;
function resolveRgb(color) {
    if (Array.isArray(color))
        return [color[0], color[1], color[2]];
    return hexToRgb(color);
}
export class ConnectionLineStore {
    constructor(initialCapacity = 0) {
        this.capacity = 0;
        this.count = 0;
        this.positions = new Float32Array(0);
        this.colors = new Float32Array(0);
        this.lodHidden = new Uint8Array(0);
        this.lodRestore = new Float32Array(0);
        this.keyToIndex = new Map();
        this.indexToKey = new Map();
        this.positionDirty = DIRTY_CLEAN;
        this.colorDirty = DIRTY_CLEAN;
        if (initialCapacity > 0)
            this.ensureCapacity(initialCapacity);
    }
    clearDirty() {
        this.positionDirty = DIRTY_CLEAN;
        this.colorDirty = DIRTY_CLEAN;
    }
    markFullDirty() {
        this.positionDirty = markDirtyFull();
        this.colorDirty = markDirtyFull();
    }
    ensureCapacity(needed) {
        if (needed <= this.capacity)
            return false;
        const newCap = Math.max(needed, Math.ceil(this.capacity * 1.5) || 16);
        const newPos = new Float32Array(newCap * CONNECTION_FLOATS_PER_SLOT);
        const newCol = new Float32Array(newCap * CONNECTION_FLOATS_PER_SLOT);
        const newLodHidden = new Uint8Array(newCap);
        const newRestore = new Float32Array(newCap * CONNECTION_FLOATS_PER_SLOT);
        newPos.set(this.positions);
        newCol.set(this.colors);
        newLodHidden.set(this.lodHidden);
        newRestore.set(this.lodRestore);
        this.positions = newPos;
        this.colors = newCol;
        this.lodHidden = newLodHidden;
        this.lodRestore = newRestore;
        this.capacity = newCap;
        this.markFullDirty();
        return true;
    }
    /**
     * Add edge. Returns false if key already present.
     */
    add(key, a, b, color = 0x00ffff) {
        if (this.keyToIndex.has(key))
            return false;
        this.ensureCapacity(this.count + 1);
        const slot = this.count++;
        this.writeSlot(slot, a, b, color);
        this.keyToIndex.set(key, slot);
        this.indexToKey.set(slot, key);
        return true;
    }
    setColor(key, color) {
        const slot = this.keyToIndex.get(key);
        if (slot == null)
            return false;
        const rgb = resolveRgb(color);
        const i = slot * CONNECTION_FLOATS_PER_SLOT;
        for (let j = 0; j < 3; j++) {
            this.colors[i + j] = rgb[j];
            this.colors[i + 3 + j] = rgb[j];
        }
        this.colorDirty = expandDirtyRange(this.colorDirty, i, CONNECTION_FLOATS_PER_SLOT);
        return true;
    }
    /** Move both endpoints of an existing edge (cluster drag / gate move). */
    updateEndpoints(key, a, b) {
        const slot = this.keyToIndex.get(key);
        if (slot == null)
            return false;
        const i = slot * CONNECTION_FLOATS_PER_SLOT;
        // While LOD-hidden, keep GPU parked but remember logical ends for unhide.
        if (this.lodHidden[slot]) {
            this.lodRestore[i] = a.x;
            this.lodRestore[i + 1] = a.y;
            this.lodRestore[i + 2] = a.z;
            this.lodRestore[i + 3] = b.x;
            this.lodRestore[i + 4] = b.y;
            this.lodRestore[i + 5] = b.z;
            return true;
        }
        this.positions[i] = a.x;
        this.positions[i + 1] = a.y;
        this.positions[i + 2] = a.z;
        this.positions[i + 3] = b.x;
        this.positions[i + 4] = b.y;
        this.positions[i + 5] = b.z;
        this.lodRestore[i] = a.x;
        this.lodRestore[i + 1] = a.y;
        this.lodRestore[i + 2] = a.z;
        this.lodRestore[i + 3] = b.x;
        this.lodRestore[i + 4] = b.y;
        this.lodRestore[i + 5] = b.z;
        this.positionDirty = expandDirtyRange(this.positionDirty, i, CONNECTION_FLOATS_PER_SLOT);
        return true;
    }
    /**
     * LOD visibility: park both endpoints at HIDDEN without zeroing colors
     * (unlike {@link remove}). Unhide restores from the internal endpoint cache
     * (filled on hide and kept current by {@link updateEndpoints} while hidden).
     */
    setLodHidden(key, hidden) {
        const slot = this.keyToIndex.get(key);
        if (slot == null)
            return false;
        const i = slot * CONNECTION_FLOATS_PER_SLOT;
        if (hidden) {
            if (this.lodHidden[slot])
                return true;
            for (let j = 0; j < CONNECTION_FLOATS_PER_SLOT; j++) {
                this.lodRestore[i + j] = this.positions[i + j];
                this.positions[i + j] = HIDDEN_COORDINATE;
            }
            this.lodHidden[slot] = 1;
            this.positionDirty = expandDirtyRange(this.positionDirty, i, CONNECTION_FLOATS_PER_SLOT);
            return true;
        }
        if (!this.lodHidden[slot])
            return true;
        for (let j = 0; j < CONNECTION_FLOATS_PER_SLOT; j++) {
            this.positions[i + j] = this.lodRestore[i + j];
        }
        this.lodHidden[slot] = 0;
        this.positionDirty = expandDirtyRange(this.positionDirty, i, CONNECTION_FLOATS_PER_SLOT);
        return true;
    }
    /**
     * Soft-remove: hide geometry, free key. Slot not compacted (parity with points).
     */
    remove(key) {
        const slot = this.keyToIndex.get(key);
        if (slot == null)
            return false;
        const i = slot * CONNECTION_FLOATS_PER_SLOT;
        for (let j = 0; j < CONNECTION_FLOATS_PER_SLOT; j++) {
            this.positions[i + j] = HIDDEN_COORDINATE;
            this.colors[i + j] = 0;
        }
        this.lodHidden[slot] = 0;
        this.keyToIndex.delete(key);
        this.indexToKey.delete(slot);
        this.positionDirty = expandDirtyRange(this.positionDirty, i, CONNECTION_FLOATS_PER_SLOT);
        this.colorDirty = expandDirtyRange(this.colorDirty, i, CONNECTION_FLOATS_PER_SLOT);
        return true;
    }
    clear() {
        this.positions = new Float32Array(0);
        this.colors = new Float32Array(0);
        this.lodHidden = new Uint8Array(0);
        this.lodRestore = new Float32Array(0);
        this.capacity = 0;
        this.count = 0;
        this.keyToIndex.clear();
        this.indexToKey.clear();
        this.markFullDirty();
    }
    /**
     * Dense rebuild from edges (finalize).
     */
    rebuild(edges) {
        const n = edges.length;
        this.positions = new Float32Array(n * CONNECTION_FLOATS_PER_SLOT);
        this.colors = new Float32Array(n * CONNECTION_FLOATS_PER_SLOT);
        this.lodHidden = new Uint8Array(n);
        this.lodRestore = new Float32Array(n * CONNECTION_FLOATS_PER_SLOT);
        this.capacity = n;
        this.count = n;
        this.keyToIndex.clear();
        this.indexToKey.clear();
        for (let slot = 0; slot < n; slot++) {
            const e = edges[slot];
            this.writeSlot(slot, e.a, e.b, e.color ?? 0x00ffff, false);
            this.keyToIndex.set(e.key, slot);
            this.indexToKey.set(slot, e.key);
        }
        this.markFullDirty();
    }
    writeSlot(slot, a, b, color, dirty = true) {
        const i = slot * CONNECTION_FLOATS_PER_SLOT;
        this.positions[i] = a.x;
        this.positions[i + 1] = a.y;
        this.positions[i + 2] = a.z;
        this.positions[i + 3] = b.x;
        this.positions[i + 4] = b.y;
        this.positions[i + 5] = b.z;
        this.lodRestore[i] = a.x;
        this.lodRestore[i + 1] = a.y;
        this.lodRestore[i + 2] = a.z;
        this.lodRestore[i + 3] = b.x;
        this.lodRestore[i + 4] = b.y;
        this.lodRestore[i + 5] = b.z;
        this.lodHidden[slot] = 0;
        const rgb = resolveRgb(color);
        for (let j = 0; j < 3; j++) {
            this.colors[i + j] = rgb[j];
            this.colors[i + 3 + j] = rgb[j];
        }
        if (dirty) {
            this.positionDirty = expandDirtyRange(this.positionDirty, i, CONNECTION_FLOATS_PER_SLOT);
            this.colorDirty = expandDirtyRange(this.colorDirty, i, CONNECTION_FLOATS_PER_SLOT);
        }
    }
}
//# sourceMappingURL=connection-line-store.js.map