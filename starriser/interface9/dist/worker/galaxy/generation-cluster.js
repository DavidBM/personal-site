import { tooCloseZX } from "./galaxy-xz-math.js";
export function normalizeGalaxyGenerationParams({ numClusters = 1000, numSolarSystems = 100, minDistance = 300, galaxySize = 25, heightVariation = 1.3, maxConnections = 3, batchSize = 100, onBatch, centerBias = 0.6, }) {
    return {
        numClusters,
        numSolarSystems,
        minDistance,
        galaxySize,
        heightVariation,
        maxConnections,
        batchSize,
        onBatch,
        centerBias,
    };
}
export function deriveGalaxyGenerationSizing({ galaxySize, heightVariation, }) {
    return {
        galaxyRadius: galaxySize,
        heightVariationRange: (galaxySize * heightVariation) / 100,
    };
}
export function canPlaceGeneratedCluster(position, existingPositions, minDistance) {
    return !tooCloseZX(position, existingPositions, minDistance);
}
export function planGeneratedClusterPlacement({ nextClusterId, position, existingPositions, minDistance, createColor, radius, name, }) {
    if (!canPlaceGeneratedCluster(position, existingPositions, minDistance)) {
        return {
            cluster: null,
            nextClusterId,
        };
    }
    return {
        cluster: buildGeneratedClusterSeed({
            id: nextClusterId,
            position,
            color: createColor(),
            radius,
            name,
        }),
        nextClusterId: nextClusterId + 1,
    };
}
export function buildGeneratedClusterPlacementBatch({ attempts, nextClusterId, existingPositions, minDistance, createPosition, createColor, radius, name, }) {
    const clusters = [];
    const clusterPositions = existingPositions.slice();
    let nextId = nextClusterId;
    for (let attempt = 0; attempt < attempts; ++attempt) {
        const placement = planGeneratedClusterPlacement({
            nextClusterId: nextId,
            position: createPosition(),
            existingPositions: clusterPositions,
            minDistance,
            createColor,
            radius,
            name: name ? name(nextId) : undefined,
        });
        nextId = placement.nextClusterId;
        if (!placement.cluster) {
            continue;
        }
        clusters.push(placement.cluster);
        clusterPositions.push(placement.cluster.position);
    }
    return {
        clusters,
        clusterPositions,
        nextClusterId: nextId,
    };
}
export function buildGeneratedClusterSeed(input) {
    return {
        id: input.id,
        name: input.name ?? `Cluster ${input.id}`,
        position: copyPosition(input.position),
        color: input.color,
        radius: input.radius ?? 250,
        maxSystemDistance: 0,
        connectedTo: [],
        solarSystems: [],
    };
}
function copyPosition(position) {
    return {
        x: position.x,
        y: position.y,
        z: position.z,
    };
}
//# sourceMappingURL=generation-cluster.js.map