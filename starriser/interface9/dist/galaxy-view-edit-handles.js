export function showEditHandlesInGalaxyView(clusterId, handles, idToCluster, renderer) {
    if (!idToCluster.has(clusterId))
        return false;
    renderer.showEditHandles(clusterId, handles);
    return true;
}
export function hideEditHandlesInGalaxyView(clusterId, idToCluster, renderer) {
    if (!idToCluster.has(clusterId))
        return false;
    renderer.hideEditHandles();
    return true;
}
//# sourceMappingURL=galaxy-view-edit-handles.js.map