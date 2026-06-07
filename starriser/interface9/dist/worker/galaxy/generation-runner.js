import { addOperationToBatch, createOperationBatcher, flushOperationBatch, } from "./flush/operation-batcher.js";
import { bellCurveRandomRadius } from "./galaxy-xz-math.js";
import { buildGeneratedClusterPlacementBatch, deriveGalaxyGenerationSizing, normalizeGalaxyGenerationParams, } from "./generation-cluster.js";
import { connectGeneratedClusters } from "./generation-connections.js";
import { removeUnconnectedGeneratedClusters } from "./generation-graph.js";
import { buildAddGeneratedClusterOps, buildRemoveGeneratedClusterOps, } from "./generation-ops.js";
import { applyGeneratedClusterSolarSystemUpdatesToClusters } from "./generation-solar-systems.js";
import { randomClusterColor, randomPointInDisk_PositiveY, } from "./galaxy-utils.js";
export function createGalaxyGenerationState(params) {
    const normalizedParams = normalizeGalaxyGenerationParams(params);
    const sizing = deriveGalaxyGenerationSizing(normalizedParams);
    return {
        params: normalizedParams,
        globalSystemCounter: 1,
        globalClusterCounter: 1,
        connectionSet: new Set(),
        clusters: [],
        galaxyRadius: sizing.galaxyRadius,
        heightVar: sizing.heightVariationRange,
        clusterPositions: [],
        opBatcher: createOperationBatcher({
            batchSize: normalizedParams.batchSize,
            onBatch: normalizedParams.onBatch,
        }),
    };
}
export function runGalaxyGeneration(params, sources = {}) {
    return runGalaxyGenerationState(createGalaxyGenerationState(params), sources);
}
export function runGalaxyGenerationState(state, sources = {}) {
    generateAllClustersForState(state, sources);
    connectClustersForState(state);
    removeEmptyClustersForState(state);
    generateAllSolarSystemsForState(state, sources);
    flushGalaxyGenerationState(state);
    return { clusters: state.clusters };
}
export function flushGalaxyGenerationState(state) {
    flushOperationBatch(state.opBatcher, true);
}
export function generateAllClustersForState(state, sources = {}) {
    const placement = buildGeneratedClusterPlacementBatch({
        attempts: state.params.numClusters,
        nextClusterId: state.globalClusterCounter,
        existingPositions: state.clusterPositions,
        minDistance: state.params.minDistance,
        createPosition: () => (sources.createClusterPosition ?? createRandomClusterPosition)(state),
        createColor: sources.createClusterColor ?? randomClusterColor,
        radius: 250,
    });
    state.globalClusterCounter = placement.nextClusterId;
    state.clusterPositions = placement.clusterPositions;
    state.clusters.push(...placement.clusters);
    addOpsToGalaxyGenerationBatcher(state, buildAddGeneratedClusterOps(placement.clusters));
}
export function connectClustersForState(state) {
    const result = connectGeneratedClusters({
        clusters: state.clusters,
        committedConnectionKeys: state.connectionSet,
        nextSystemId: state.globalSystemCounter,
        minDistance: state.params.minDistance,
        maxConnections: state.params.maxConnections,
        onConnectionOps: (ops) => {
            addOpsToGalaxyGenerationBatcher(state, ops);
            flushGalaxyGenerationState(state);
        },
    });
    state.globalSystemCounter = result.nextSystemId;
}
export function removeEmptyClustersForState(state) {
    const removal = removeUnconnectedGeneratedClusters(state.clusters);
    state.clusters = removal.remainingClusters;
    addOpsToGalaxyGenerationBatcher(state, buildRemoveGeneratedClusterOps(removal.removedClusterIds));
}
export function generateAllSolarSystemsForState(state, sources = {}) {
    const result = applyGeneratedClusterSolarSystemUpdatesToClusters({
        clusters: state.clusters,
        numSolarSystems: state.params.numSolarSystems,
        nextSystemId: state.globalSystemCounter,
        onMissingJumpGates: sources.onMissingJumpGates ??
            ((cluster) => {
                console.error("No jump gates found in cluster", cluster);
            }),
        onConnectivityFailure: sources.onConnectivityFailure ??
            ((cluster) => {
                console.warn("Failed to generate valid solar system connectivity in cluster", cluster.id);
            }),
        onClusterOps: (_cluster, ops) => {
            addOpsToGalaxyGenerationBatcher(state, ops);
        },
    });
    state.globalSystemCounter = result.nextSystemId;
}
export function addOpsToGalaxyGenerationBatcher(state, ops) {
    for (const op of ops) {
        addOperationToBatch(state.opBatcher, op);
    }
}
export function createRandomClusterPosition(state) {
    const radius = bellCurveRandomRadius(state.galaxyRadius, state.params.centerBias);
    return randomPointInDisk_PositiveY(radius, state.heightVar);
}
//# sourceMappingURL=generation-runner.js.map