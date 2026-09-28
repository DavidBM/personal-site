/** GPU visual simulation cadence; zero means one update per rendered frame. */
export const SIMULATION_RATES = [15, 30, 60, 0];
export const DEFAULT_SIMULATION_RATE = 30;
export function simulationRate(value) {
    return SIMULATION_RATES.includes(value) ? value : DEFAULT_SIMULATION_RATE;
}
//# sourceMappingURL=simulation-rate.js.map