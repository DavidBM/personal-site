export const HIDDEN_CONNECTION_LINE_POSITION = 1e9;
export function calculateGrownConnectionLineCapacity(capacity) {
    return Math.ceil(capacity * 1.3) || capacity + 256;
}
export function resizeConnectionLineBuffers(state, newCapacity) {
    if (newCapacity <= state.capacity)
        return false;
    const positions = new Float32Array(newCapacity * 2 * 3);
    const colors = new Float32Array(newCapacity * 2 * 3);
    positions.set(state.positions);
    colors.set(state.colors);
    state.positions = positions;
    state.colors = colors;
    state.capacity = newCapacity;
    return true;
}
export function ensureConnectionLineBufferCapacity(state) {
    if (state.count < state.capacity)
        return false;
    return resizeConnectionLineBuffers(state, calculateGrownConnectionLineCapacity(state.capacity));
}
export function addConnectionLineBufferEntry(state, input) {
    if (!input.key)
        throw new Error("addConnection requires a unique key");
    const existingSlot = state.keyToIndex.get(input.key);
    if (typeof existingSlot === "number") {
        return {
            key: input.key,
            slot: existingSlot,
            added: false,
            grew: false,
        };
    }
    const grew = ensureConnectionLineBufferCapacity(state);
    const slot = state.count;
    writeConnectionLinePositionSlot(state.positions, slot, input.p1, input.p2);
    writeConnectionLineColorSlot(state.colors, slot, input.color);
    state.keyToIndex.set(input.key, slot);
    state.indexToKey.set(slot, input.key);
    state.count += 1;
    return {
        key: input.key,
        slot,
        added: true,
        grew,
    };
}
export function removeConnectionLineBufferEntry(state, key, hiddenPosition = HIDDEN_CONNECTION_LINE_POSITION) {
    const slot = state.keyToIndex.get(key);
    if (typeof slot !== "number")
        return false;
    const offset = slot * 2 * 3;
    for (let index = 0; index < 6; index++) {
        state.positions[offset + index] = hiddenPosition;
        state.colors[offset + index] = 0;
    }
    state.keyToIndex.delete(key);
    state.indexToKey.delete(slot);
    return true;
}
export function compactConnectionLineBuffers(state) {
    const positions = new Float32Array(state.capacity * 2 * 3);
    const colors = new Float32Array(state.capacity * 2 * 3);
    const keyToIndex = new Map();
    const indexToKey = new Map();
    let count = 0;
    for (let slot = 0; slot < state.count; slot++) {
        const key = state.indexToKey.get(slot);
        if (!key)
            continue;
        const oldOffset = slot * 2 * 3;
        const newOffset = count * 2 * 3;
        for (let index = 0; index < 6; index++) {
            positions[newOffset + index] = state.positions[oldOffset + index];
            colors[newOffset + index] = state.colors[oldOffset + index];
        }
        keyToIndex.set(key, count);
        indexToKey.set(count, key);
        count++;
    }
    state.positions = positions;
    state.colors = colors;
    state.keyToIndex = keyToIndex;
    state.indexToKey = indexToKey;
    state.count = count;
}
export function updateConnectionLineBufferEntry(state, key, p1, p2) {
    const slot = state.keyToIndex.get(key);
    if (typeof slot !== "number")
        return false;
    writeConnectionLinePositionSlot(state.positions, slot, p1, p2);
    return true;
}
export function setConnectionLineBufferColor(state, key, color) {
    const slot = state.keyToIndex.get(key);
    if (typeof slot !== "number")
        return false;
    writeConnectionLineColorSlot(state.colors, slot, color);
    return true;
}
export function clearConnectionLineBuffers(state) {
    state.keyToIndex.clear();
    state.indexToKey.clear();
    state.count = 0;
}
export function writeConnectionLinePositionSlot(positions, slot, p1, p2) {
    const offset = slot * 2 * 3;
    for (let index = 0; index < 3; index++) {
        positions[offset + index] = getConnectionLineVec3Component(p1, index);
        positions[offset + 3 + index] = getConnectionLineVec3Component(p2, index);
    }
}
export function writeConnectionLineColorSlot(colors, slot, color) {
    const colorTuple = connectionLineColorToTuple(color);
    const offset = slot * 2 * 3;
    for (let index = 0; index < 3; index++) {
        colors[offset + index] = colorTuple[index] ?? 0;
        colors[offset + 3 + index] = colorTuple[index] ?? 0;
    }
}
export function connectionLineColorToTuple(color) {
    if (Array.isArray(color))
        return color;
    if (typeof color === "number") {
        return [
            ((color >> 16) & 0xff) / 255,
            ((color >> 8) & 0xff) / 255,
            (color & 0xff) / 255,
        ];
    }
    if (isConnectionLineColorObject(color)) {
        return [color.r, color.g, color.b];
    }
    throw new Error("Color format not recognized");
}
function getConnectionLineVec3Component(value, index) {
    if (Array.isArray(value))
        return value[index];
    if (isConnectionLinePositionObject(value)) {
        return index === 0 ? value.x : index === 1 ? value.y : value.z;
    }
    return value.getComponent(index);
}
function isConnectionLinePositionObject(value) {
    return "x" in value && "y" in value && "z" in value;
}
function isConnectionLineColorObject(color) {
    return (typeof color === "object" &&
        color !== null &&
        "r" in color &&
        "g" in color &&
        "b" in color);
}
//# sourceMappingURL=connection-line-buffers.js.map