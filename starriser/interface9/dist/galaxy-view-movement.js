import { commitClusterMovement, previewClusterMovement, } from "./cluster-movement.js";
export function previewMoveClusterView(cluster, position) {
    const movedJumpGates = [];
    const changed = previewClusterMovement(cluster, position, movedJumpGates);
    return { changed, movedJumpGates };
}
export function previewMoveClusterInGalaxyView(cluster, position, renderer) {
    const result = previewMoveClusterView(cluster, position);
    if (result.movedJumpGates.length > 0) {
        renderer.updateSolarSystemPositions(cluster, result.movedJumpGates);
        renderer.updateClusterConnections(cluster.id);
    }
    return result;
}
export function commitMoveClusterView(cluster, startPosition, endPosition) {
    const movedSystems = [];
    const changed = commitClusterMovement(cluster, startPosition, endPosition, movedSystems);
    return { changed, movedSystems };
}
export function commitMoveClusterInGalaxyView(cluster, startPosition, endPosition, renderer) {
    const result = commitMoveClusterView(cluster, startPosition, endPosition);
    if (!result.changed)
        return result;
    if (result.movedSystems.length > 0) {
        renderer.updateSolarSystemPositions(cluster, result.movedSystems);
    }
    renderer.updateSolarSystemConnections(cluster);
    renderer.updateClusterConnections(cluster.id);
    return result;
}
//# sourceMappingURL=galaxy-view-movement.js.map