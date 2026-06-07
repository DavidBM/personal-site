import { applyOpsToGalaxyData } from "./galaxy-data-reducer.js";
export function applyClusterRegenerationMetadataToGalaxyData(data, regeneration) {
    const cluster = data.clusters[regeneration.clusterId];
    if (!cluster)
        return false;
    cluster.maxSystemDistance = regeneration.maxSystemDistance;
    return true;
}
export function applyClusterRegenerationPlanToGalaxyData(data, regeneration) {
    applyOpsToGalaxyData(data, regeneration.ops);
    return applyClusterRegenerationMetadataToGalaxyData(data, regeneration);
}
//# sourceMappingURL=galaxy-data-regeneration.js.map