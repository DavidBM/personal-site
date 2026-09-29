export const GPU_BUDGETS = {
    standard: { ships: 10000, maxShips: 50000, fleets: 128, highPlanetTextures: true },
    compact: { ships: 2000, maxShips: 2000, fleets: 32, highPlanetTextures: false },
};
export function gpuBudgetMode(value) { return value === 'compact' ? 'compact' : 'standard'; }
export function needsGpuBudgetFallback(mode, message) {
    return mode === 'standard' && /GPUOutOfMemoryError/.test(message);
}
//# sourceMappingURL=gpu-budget.js.map