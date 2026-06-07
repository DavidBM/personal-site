import { commitMoveClusterInGalaxyData, previewMoveClusterInGalaxyData, } from "./worker/galaxy/galaxy-data-movement.js";
export function handleAppClusterDragUpdate({ worldData, galaxy, renderer, dragStarts, lastUIState, clusterId, position, }) {
    const cluster = galaxy.getClusterById(clusterId);
    if (!cluster)
        return false;
    if (!dragStarts.has(clusterId)) {
        dragStarts.set(clusterId, copyPosition(cluster.position));
    }
    previewMoveClusterInGalaxyData(worldData, clusterId, position);
    galaxy.previewMoveCluster(cluster, position);
    updateDragOverlaysAndSelection({
        galaxy,
        renderer,
        lastUIState,
        cluster,
        clusterId,
    });
    return true;
}
export function handleAppClusterDragCommit({ worldData, galaxy, renderer, dragStarts, lastUIState, clusterId, position, }) {
    const cluster = galaxy.getClusterById(clusterId);
    if (!cluster)
        return false;
    const startPosition = dragStarts.get(clusterId) ?? copyPosition(cluster.position);
    dragStarts.delete(clusterId);
    commitMoveClusterInGalaxyData(worldData, clusterId, startPosition, position);
    galaxy.commitMoveCluster(cluster, startPosition, position);
    renderer.updateEditOverlayPosition(clusterId, cluster.position);
    if (lastUIState.selectedId !== null) {
        renderer.refreshConnectionOverlays();
    }
    refreshDragSelection({
        galaxy,
        lastUIState,
        cluster,
        clusterId,
    });
    return true;
}
function updateDragOverlaysAndSelection({ galaxy, renderer, lastUIState, cluster, clusterId, }) {
    renderer.updateEditOverlayPosition(clusterId, cluster.position);
    refreshDragSelection({
        galaxy,
        lastUIState,
        cluster,
        clusterId,
    });
}
function refreshDragSelection({ galaxy, lastUIState, cluster, clusterId, }) {
    if (lastUIState.hoveredId === clusterId) {
        galaxy.setHoveredCluster(cluster);
    }
    if (lastUIState.selectedId === clusterId) {
        galaxy.setSelectedCluster(cluster);
    }
}
function copyPosition(position) {
    return {
        x: position.x,
        y: position.y,
        z: position.z,
    };
}
//# sourceMappingURL=app-cluster-drag.js.map