import { commitClusterMovement, previewClusterMovement, } from "../../cluster-movement.js";
export function previewMoveClusterInGalaxyData(data, clusterId, position) {
    const cluster = data.clusters[clusterId];
    if (!cluster)
        return false;
    return previewClusterMovement(cluster, position);
}
export function commitMoveClusterInGalaxyData(data, clusterId, startPosition, endPosition) {
    const cluster = data.clusters[clusterId];
    if (!cluster)
        return false;
    return commitClusterMovement(cluster, startPosition, endPosition);
}
//# sourceMappingURL=galaxy-data-movement.js.map