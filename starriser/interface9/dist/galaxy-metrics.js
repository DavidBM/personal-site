/**
 * GalaxyMetrics - Efficient statistics tracking for galaxy objects
 *
 * Instead of iterating through arrays on each statistics request,
 * this class maintains running counts that are updated incrementally
 * when objects are added or removed from the galaxy.
 */
export class GalaxyMetrics {
    constructor() {
        this.clusters = 0;
        this.solarSystems = 0;
        this.jumpGates = 0;
        this.clusterConnections = 0;
        this.solarSystemConnections = 0;
    }
    /**
     * Increment cluster count
     */
    incrementClusters() {
        this.clusters++;
    }
    /**
     * Decrement cluster count
     */
    decrementClusters() {
        this.clusters = Math.max(0, this.clusters - 1);
    }
    /**
     * Increment solar system count
     */
    incrementSolarSystems() {
        this.solarSystems++;
    }
    /**
     * Decrement solar system count
     */
    decrementSolarSystems() {
        this.solarSystems = Math.max(0, this.solarSystems - 1);
    }
    /**
     * Increment jump gate count
     */
    incrementJumpGates() {
        this.jumpGates++;
    }
    /**
     * Decrement jump gate count
     */
    decrementJumpGates() {
        this.jumpGates = Math.max(0, this.jumpGates - 1);
    }
    /**
     * Increment cluster connection count
     */
    incrementClusterConnections() {
        this.clusterConnections++;
    }
    /**
     * Decrement cluster connection count
     */
    decrementClusterConnections() {
        this.clusterConnections = Math.max(0, this.clusterConnections - 1);
    }
    /**
     * Increment solar system connection count
     */
    incrementSolarSystemConnections() {
        this.solarSystemConnections++;
    }
    /**
     * Decrement solar system connection count
     */
    decrementSolarSystemConnections() {
        this.solarSystemConnections = Math.max(0, this.solarSystemConnections - 1);
    }
    /**
     * Get current statistics in the same format as Galaxy.getStatistics()
     */
    getStatistics() {
        return {
            clusters: this.clusters,
            solarSystems: this.solarSystems,
            jumpGates: this.jumpGates,
            connections: this.clusterConnections,
            internalConnections: Math.floor(this.solarSystemConnections / 2),
        };
    }
    /**
     * Reset all counters to zero
     */
    reset() {
        this.clusters = 0;
        this.solarSystems = 0;
        this.jumpGates = 0;
        this.clusterConnections = 0;
        this.solarSystemConnections = 0;
    }
    /**
     * Set all counters to specific values (useful for initialization)
     */
    setCounters(stats) {
        this.clusters = stats.clusters ?? 0;
        this.solarSystems = stats.solarSystems ?? 0;
        this.jumpGates = stats.jumpGates ?? 0;
        this.clusterConnections = stats.clusterConnections ?? 0;
        this.solarSystemConnections = stats.solarSystemConnections ?? 0;
    }
}
//# sourceMappingURL=galaxy-metrics.js.map