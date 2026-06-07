import { makeGalaxyRenderSolarSystemKey, } from "./galaxy-render-buffers.js";
export const HIDDEN_SOLAR_SYSTEM_POSITION = 1e9;
export function calculateGrownSolarSystemIncrementalCapacity(maxSolarSystems) {
    return Math.ceil(maxSolarSystems * 2) || maxSolarSystems + 1000;
}
export function growSolarSystemIncrementalBuffers(state) {
    const maxSolarSystems = calculateGrownSolarSystemIncrementalCapacity(state.maxSolarSystems);
    const positions = new Float32Array(maxSolarSystems * 3);
    const colors = new Float32Array(maxSolarSystems * 3);
    const visibility = new Uint8Array(maxSolarSystems);
    positions.set(state.positions);
    colors.set(state.colors);
    visibility.set(state.visibility);
    return {
        ...state,
        positions,
        colors,
        visibility,
        maxSolarSystems,
    };
}
export function addSolarSystemToIncrementalBuffers(state, input, writeColor) {
    const key = makeGalaxyRenderSolarSystemKey(input.clusterId, input.solarSystemId);
    const existingIndex = state.keyToIndex.get(key);
    if (typeof existingIndex === "number") {
        writeSolarSystemIncrementalBufferPosition(state.positions, existingIndex, input.position);
        writeColor(state.colors, existingIndex * 3, resolveSolarSystemIncrementalColor(input));
        state.visibility[existingIndex] = 1;
        return {
            state,
            index: existingIndex,
            key,
            grew: false,
        };
    }
    let nextState = state;
    let grew = false;
    if (nextState.currentSolarSystemCount >= nextState.maxSolarSystems) {
        nextState = growSolarSystemIncrementalBuffers(nextState);
        grew = true;
    }
    const index = nextState.currentSolarSystemCount;
    nextState.keyToIndex.set(key, index);
    writeSolarSystemIncrementalBufferPosition(nextState.positions, index, input.position);
    writeColor(nextState.colors, index * 3, resolveSolarSystemIncrementalColor(input));
    nextState.visibility[index] = 1;
    return {
        state: {
            ...nextState,
            currentSolarSystemCount: index + 1,
        },
        index,
        key,
        grew,
    };
}
export function updateSolarSystemIncrementalBufferPositions(state, clusterId, solarSystems) {
    let changed = 0;
    for (const solarSystem of solarSystems) {
        const index = state.keyToIndex.get(makeGalaxyRenderSolarSystemKey(clusterId, solarSystem.id));
        if (typeof index !== "number")
            continue;
        writeSolarSystemIncrementalBufferPosition(state.positions, index, solarSystem.position);
        changed++;
    }
    return changed;
}
export function removeSolarSystemFromIncrementalBuffers(state, clusterId, solarSystemId, hiddenPosition = HIDDEN_SOLAR_SYSTEM_POSITION) {
    const key = makeGalaxyRenderSolarSystemKey(clusterId, solarSystemId);
    const index = state.keyToIndex.get(key);
    if (typeof index !== "number")
        return false;
    state.keyToIndex.delete(key);
    const offset = index * 3;
    state.positions[offset + 0] = hiddenPosition;
    state.positions[offset + 1] = hiddenPosition;
    state.positions[offset + 2] = hiddenPosition;
    state.colors[offset + 0] = 0;
    state.colors[offset + 1] = 0;
    state.colors[offset + 2] = 0;
    state.visibility[index] = 0;
    return true;
}
export function clearSolarSystemIncrementalBuffers(state, hiddenPosition = HIDDEN_SOLAR_SYSTEM_POSITION) {
    state.positions.fill(hiddenPosition);
    state.colors.fill(0);
    state.visibility.fill(0);
    state.keyToIndex.clear();
    state.currentSolarSystemCount = 0;
}
export function writeSolarSystemIncrementalBufferPosition(positions, index, position) {
    const offset = index * 3;
    positions[offset + 0] = position.x;
    positions[offset + 1] = position.y;
    positions[offset + 2] = position.z;
}
export function resolveSolarSystemIncrementalColor(input) {
    return input.isJumpGate ? 0x00ffff : input.clusterColor || 0xffffff;
}
//# sourceMappingURL=galaxy-render-incremental-buffers.js.map